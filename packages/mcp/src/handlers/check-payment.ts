import { mcpCheckPaymentSchema } from "@agent-rails/contract";
import {
  buildPaymentIntent,
  isAgentRailsError,
  precheckReceipt,
  runPolicyHooks,
  simulatePayment,
} from "@agent-rails/sdk";
import type { ServerContext } from "../context.js";
import { preparePayment } from "./prepare.js";

/**
 * A payment proposal that changes nothing (ARCHITECTURE section 10; blueprint L7).
 *
 * Same resolution, same hooks, same instruction, same simulation as the real thing — and no
 * broadcast, no signature, no fee. It exists so an agent can find out that a payment would
 * be refused without attempting it, which is both better behaviour and less noise in the
 * audit trail.
 *
 * The answer is a preview, not a permit. Between this call and a send, a guardian can pause,
 * an operator can revoke, the window can roll, and another payment can consume the budget.
 * The program re-checks everything, which is what makes it safe for this to be approximate.
 */
export type CheckPaymentResponse = {
  allowed: boolean;
  intent_id: string;
  receipt: string;
  reason_code?: string;
  message: string;
  already_settled?: boolean;
  destination?: string;
  destination_label?: string;
  mint?: string;
  amount?: string;
  amount_base_units?: string;
  units_consumed?: string;
};

const UNKNOWN_INTENT = "0".repeat(32);

export async function handleCheckPayment(
  context: ServerContext,
  rawInput: unknown,
): Promise<CheckPaymentResponse> {
  const parsed = mcpCheckPaymentSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      allowed: false,
      intent_id: UNKNOWN_INTENT,
      receipt: "",
      reason_code: "INVALID_REQUEST",
      message: `Invalid payment request: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  try {
    const prepared = await preparePayment(context, parsed.data);
    const describe = {
      destination: String(prepared.destination.owner),
      ...(prepared.destination.label ? { destination_label: prepared.destination.label } : {}),
      mint: String(prepared.mint.mint),
      amount: prepared.amountHuman,
      amount_base_units: prepared.amount.toString(),
    };

    const precheck = await precheckReceipt({
      rpc: context.runtime.rpc,
      session: context.bound.session,
      intentId: prepared.intentId,
    });
    if (precheck.settled) {
      return {
        allowed: false,
        intent_id: prepared.intentIdHex,
        receipt: precheck.receipt,
        reason_code: "DUPLICATE_INTENT",
        already_settled: true,
        message:
          `This payment already settled (sequence ${precheck.receiptData.seq}). ` +
          "Executing it would be refused on-chain.",
        ...describe,
      };
    }

    await runPolicyHooks(context.security.hooks, {
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

    const simulation = await simulatePayment({
      rpc: context.runtime.rpc,
      transactionMessage: payment.transactionMessage,
    });

    // Recorded only on a clean dry run: a proposal that was refused has not shown that this
    // payment is sound, so it must not satisfy `dry-run-first`.
    context.dryRuns.record(prepared.intentIdHex);

    return {
      allowed: true,
      intent_id: prepared.intentIdHex,
      receipt: prepared.receipt,
      message:
        "This payment would be accepted now. Policy is re-checked on-chain when you send it.",
      units_consumed: simulation.unitsConsumed.toString(),
      ...describe,
    };
  } catch (error) {
    if (!isAgentRailsError(error)) {
      throw error;
    }
    return {
      allowed: false,
      intent_id: error.intentId ?? UNKNOWN_INTENT,
      receipt: error.receipt ?? "",
      reason_code: error.reasonCode,
      message: error.message,
    };
  }
}
