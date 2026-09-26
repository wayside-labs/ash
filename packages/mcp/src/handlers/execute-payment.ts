import {
  type McpExecutePaymentInput,
  mcpExecutePaymentSchema,
  type PaymentOutcome,
} from "@agent-rails/contract";
import {
  type AgentRailsError,
  buildPaymentIntent,
  executePayment,
  isAgentRailsError,
  precheckReceipt,
  runPolicyHooks,
} from "@agent-rails/sdk";
import { notifyPaymentDeniedWebhook } from "../alert-webhook.js";
import type { ServerContext } from "../context.js";
import { type PreparedPayment, preparePayment } from "./prepare.js";

/**
 * The agent-facing result of a payment attempt.
 *
 * Every field here is one a developer named in advance. In particular there are no program
 * logs: they used to be returned verbatim, which put text an attacker can influence back
 * into a model's context on every success (blueprint I-5). They go to the operator's sink
 * instead.
 *
 * `intent_id` and `receipt` are present on every outcome including denials, because the
 * moment they are missing from a failure the caller has no way to find out what happened.
 */
export type ExecutePaymentResponse = {
  outcome: PaymentOutcome;
  intent_id: string;
  receipt: string;
  message: string;
  /** What the caller should do next. Absent when there is nothing to do. */
  next_step?: string;
  reason_code?: string;
  signature?: string;
  destination?: string;
  destination_label?: string;
  mint?: string;
  amount?: string;
  amount_base_units?: string;
  reference?: string;
  /** True when this call changed nothing because the payment had already settled. */
  already_settled?: boolean;
  /** Only present when `disclosure.includeSimulationLogs` is on. Development only. */
  simulation_logs?: string[];
};

const UNKNOWN_INTENT = "0".repeat(32);

function describe(prepared: PreparedPayment) {
  return {
    destination: String(prepared.destination.owner),
    ...(prepared.destination.label ? { destination_label: prepared.destination.label } : {}),
    mint: String(prepared.mint.mint),
    amount: prepared.amountHuman,
    amount_base_units: prepared.amount.toString(),
    reference: prepared.reference,
  };
}

export async function handleExecutePayment(
  context: ServerContext,
  rawInput: unknown,
): Promise<ExecutePaymentResponse> {
  const parsed = mcpExecutePaymentSchema.safeParse(rawInput);
  if (!parsed.success) {
    // Unknown keys land here too. A caller trying to pass `treasury` or `session` is not
    // making a typo; those stopped being parameters for a reason.
    notifyPaymentDeniedWebhook(context, {
      session: String(context.bound.session),
      intent: UNKNOWN_INTENT,
      reason_code: "INVALID_REQUEST",
      source: "schema",
    });
    return {
      outcome: "denied",
      intent_id: UNKNOWN_INTENT,
      receipt: "",
      reason_code: "INVALID_REQUEST",
      message: `Invalid payment request: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  const input: McpExecutePaymentInput = parsed.data;

  let release: (() => void) | undefined;
  try {
    release = context.governor.acquire();
  } catch (error) {
    return denialResponse(context, error, UNKNOWN_INTENT, "");
  }

  try {
    const prepared = await preparePayment(context, input);

    // Cheaper than letting the program refuse the duplicate, and it returns the original
    // receipt instead of a failed transaction and a spent fee.
    const precheck = await precheckReceipt({
      rpc: context.runtime.rpc,
      session: context.bound.session,
      intentId: prepared.intentId,
    });
    if (precheck.settled) {
      context.governor.clearQuiesce(prepared.intentIdHex);
      recordPayment(context, prepared, "settled", { already_settled: true });
      return {
        outcome: "settled",
        intent_id: prepared.intentIdHex,
        receipt: precheck.receipt,
        already_settled: true,
        message:
          `This payment already settled (sequence ${precheck.receiptData.seq}). ` +
          "Nothing was sent.",
        ...describe(prepared),
      };
    }

    // `dry-run-first`: satisfied only by a dry run of *this* payment, since the intent id
    // is derived from the payment itself.
    if (prepared.requirements.has("dry-run-first") && !context.dryRuns.has(prepared.intentIdHex)) {
      notifyPaymentDeniedWebhook(context, {
        session: String(context.bound.session),
        intent: prepared.intentIdHex,
        reason_code: "DRY_RUN_REQUIRED",
        source: "governor",
      });
      return {
        outcome: "denied",
        intent_id: prepared.intentIdHex,
        receipt: prepared.receipt,
        reason_code: "DRY_RUN_REQUIRED",
        message:
          "Payments of this size must be checked before they are sent. " +
          "Call agent_rails_check_payment with the same arguments first.",
        next_step: "agent_rails_check_payment",
        ...describe(prepared),
      };
    }

    if (prepared.requirements.has("human-review")) {
      recordPayment(context, prepared, "review_required");
      return {
        outcome: "review_required",
        intent_id: prepared.intentIdHex,
        receipt: prepared.receipt,
        reason_code: "REVIEW_REQUIRED",
        message:
          "This payment exceeds the value a person has to approve. It has been recorded " +
          "for review and was not sent.",
        ...describe(prepared),
      };
    }

    // A `hooks` requirement overrides a fail-open posture for this payment: above the
    // threshold, an unavailable hook denies whatever the global setting says.
    const hooks = prepared.requirements.has("hooks")
      ? context.security.hooks.map((hook) => ({ ...hook, failOpen: false }))
      : context.security.hooks;

    await runPolicyHooks(hooks, {
      session: context.bound.session,
      policy: context.bound.policy,
      intentId: prepared.intentIdHex,
      destination: prepared.destination.owner,
      ...(prepared.destination.label ? { destinationLabel: prepared.destination.label } : {}),
      mint: prepared.mint.mint,
      amount: prepared.amount,
      reference: prepared.reference,
      ...(prepared.memo ? { memo: prepared.memo } : {}),
    });

    // `getLatestBlockhash` answers with an RPC envelope, not the value. Destructuring the
    // envelope yields `undefined` for both fields and the transaction is built against no
    // blockhash at all, which simulation rejects as `BlockhashNotFound`.
    const {
      value: { blockhash, lastValidBlockHeight },
    } = await context.runtime.rpc.getLatestBlockhash().send();

    const payment = await buildPaymentIntent({
      intent_id: prepared.intentIdHex,
      mint: prepared.mint.mint,
      destination: prepared.destination.owner,
      amount: prepared.amount,
      expires_at: prepared.expiresAt,
      ...(prepared.memo ? { memo: prepared.memo } : {}),
      treasury: context.bound.treasury,
      policy: context.bound.policy,
      session: context.bound.session,
      ...(prepared.destination.entry ? { allowlistEntry: prepared.destination.entry } : {}),
      ...(prepared.mint.isNative ? {} : { tokenProgram: prepared.mint.tokenProgram }),
      feePayer: context.signers.feePayer,
      sessionKey: context.signers.sessionKey,
      recentBlockhash: { blockhash, lastValidBlockHeight },
    });

    const executed = await executePayment({
      rpc: context.runtime.rpc,
      transactionMessage: payment.transactionMessage,
      lastValidBlockHeight,
      session: context.bound.session,
      intentId: prepared.intentId,
      confirmTimeoutMs: context.runtime.config.confirmTimeoutMs,
      resolveAttempts: context.security.posture.outcomes.resolveAttempts,
      resolveIntervalMs: context.security.posture.outcomes.resolveIntervalMs,
    });

    recordPayment(context, prepared, "settled", {
      signature: executed.signature,
      logs: [...executed.simulation.logs],
      units_consumed: executed.simulation.unitsConsumed.toString(),
    });

    return {
      outcome: "settled",
      intent_id: prepared.intentIdHex,
      receipt: prepared.receipt,
      signature: executed.signature,
      message: `Payment settled. Signature ${executed.signature}.`,
      // Logs are attacker-influenceable text on the way back into a model's context, so
      // they travel only when a developer has explicitly asked for them locally.
      ...(context.security.posture.disclosure.includeSimulationLogs
        ? { simulation_logs: [...executed.simulation.logs] }
        : {}),
      ...describe(prepared),
    };
  } catch (error) {
    if (!isAgentRailsError(error)) {
      throw error;
    }

    const intentId = error.intentId ?? UNKNOWN_INTENT;
    const receipt = error.receipt ?? "";

    if (error.outcome === "indeterminate") {
      // The transfer may exist. Stopping the session is the belt to the receipt's braces:
      // a retry of the same payment is refused on-chain anyway, because the intent id is
      // derived, which is exactly why a posture is allowed to turn this off.
      if (error.receipt && context.security.posture.outcomes.quiesceOnIndeterminate) {
        context.governor.quiesce({
          intentId,
          receipt: error.receipt,
          reason: error.message,
        });
      }
      recordUnresolved(context, error);
      return {
        outcome: "indeterminate",
        intent_id: intentId,
        receipt,
        reason_code: error.reasonCode,
        ...(error.signature ? { signature: error.signature } : {}),
        message: `The outcome of this payment is not known. ${error.message}`,
        next_step:
          `Call agent_rails_get_payment_status with intent_id ${intentId}. ` +
          "Do not retry the payment: if the receipt exists, the money has already moved.",
      };
    }

    return denialResponse(context, error, intentId, receipt);
  } finally {
    release?.();
  }
}

function denialResponse(
  context: ServerContext,
  error: unknown,
  intentId: string,
  receipt: string,
): ExecutePaymentResponse {
  if (!isAgentRailsError(error)) {
    throw error;
  }
  notifyPaymentDeniedWebhook(context, {
    session: String(context.bound.session),
    intent: error.intentId ?? intentId,
    reason_code: error.reasonCode,
    source: error.source ?? "program",
  });
  return {
    outcome: error.outcome,
    intent_id: error.intentId ?? intentId,
    receipt: error.receipt ?? receipt,
    reason_code: error.reasonCode,
    message: error.message,
    ...(error.signature ? { signature: error.signature } : {}),
  };
}

function recordPayment(
  context: ServerContext,
  prepared: PreparedPayment,
  outcome: PaymentOutcome,
  extra: Record<string, unknown> = {},
): void {
  context.sink.record({
    ts: new Date().toISOString(),
    treasury: context.bound.treasury,
    session: context.bound.session,
    policy: context.bound.policy,
    intent: prepared.intentIdHex,
    outcome,
    destination: prepared.destination.owner,
    ...(prepared.destination.label ? { destination_label: prepared.destination.label } : {}),
    mint: prepared.mint.mint,
    amount: prepared.amount.toString(),
    reference: prepared.reference,
    receipt: prepared.receipt,
    ...extra,
  } as never);
}

function recordUnresolved(context: ServerContext, error: AgentRailsError): void {
  context.sink.record({
    ts: new Date().toISOString(),
    treasury: context.bound.treasury,
    session: context.bound.session,
    policy: context.bound.policy,
    intent: error.intentId ?? UNKNOWN_INTENT,
    outcome: "indeterminate",
    reason_code: error.reasonCode,
    source: error.source ?? "program",
    ...(error.signature ? { signature: error.signature } : {}),
    ...(error.receipt ? { receipt: error.receipt } : {}),
    detail: error.message,
  } as never);
}
