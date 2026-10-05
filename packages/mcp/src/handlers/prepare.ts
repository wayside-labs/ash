import {
  AmountConversionError,
  deriveIntentId,
  fromBaseUnits,
  intentIdToHex,
  type McpExecutePaymentInput,
  type Requirement,
  toBaseUnits,
} from "@ash/contract";
import {
  AshError,
  findReceiptPda,
  nearMisses,
  type ResolvedDestination,
  requirementsFor,
  resolveDestination,
} from "@ash/sdk";
import type { Address } from "@solana/kit";
import {
  assertSessionLive,
  type BoundMint,
  DESTINATION_MODE_ANY,
  resolveMint,
} from "../bound-context.js";
import type { ServerContext } from "../context.js";

/**
 * Turn a tool request into a payment the program can be asked to make (blueprint L1 to L2).
 *
 * This is the boundary where references become literals, and it is the only place in the
 * server where that happens. A caller names a destination label and a human amount; trusted
 * code turns those into a wallet owner from the on-chain allowlist and a base-unit integer
 * scaled by the mint's own `decimals`. Nothing a caller wrote reaches the instruction
 * unmodified except the memo and the reference.
 */

export type PreparedPayment = {
  /** Requirements this payment's size triggers under the configured posture. */
  requirements: Set<Requirement>;
  intentId: Uint8Array;
  intentIdHex: string;
  receipt: Address;
  destination: ResolvedDestination;
  mint: BoundMint;
  amount: bigint;
  amountHuman: string;
  expiresAt: number;
  memo?: string;
  reference: string;
};

function convertAmount(human: string, mint: BoundMint): bigint {
  try {
    return toBaseUnits(human, mint.decimals);
  } catch (error) {
    if (error instanceof AmountConversionError) {
      throw new AshError({
        reasonCode: error.reason,
        message: error.message,
        outcome: "denied",
        source: "resolver",
      });
    }
    throw error;
  }
}

export async function preparePayment(
  context: ServerContext,
  input: McpExecutePaymentInput,
): Promise<PreparedPayment> {
  await assertSessionLive(context.runtime, context.bound);

  const mint = resolveMint(context.bound, input.mint_ref);
  const amount = convertAmount(input.amount, mint);

  if (amount <= 0n) {
    throw new AshError({
      reasonCode: "AMOUNT_ZERO",
      message: "Payment amount must be greater than zero.",
      outcome: "denied",
      source: "resolver",
    });
  }

  // Value bands are evaluated against the resolved base-unit amount, so "above 100" is
  // unambiguous about which token it means.
  const requirements = requirementsFor(context.security, amount, {
    ref: input.mint_ref,
    address: String(mint.mint),
    decimals: mint.decimals,
  });

  // The on-chain `require_memo` flag and a configured `memo` band are independent: either
  // one alone is enough, and the program enforces its own regardless of this.
  if ((context.bound.requireMemo || requirements.has("memo")) && !input.memo) {
    throw new AshError({
      reasonCode: "MEMO_REQUIRED",
      message: context.bound.requireMemo
        ? "This policy requires a memo on every payment."
        : `Payments of this size require a memo under the ${context.security.preset} posture.`,
      outcome: "denied",
      source: "resolver",
    });
  }

  // Two authorities, and the stricter one wins. The chain refuses an unregistered payee
  // whenever the policy is in Allowlist mode; `labels-only` refuses it here as well, which
  // costs no fee and produces a message that says what to do instead.
  const chainAllowsRaw = context.bound.destinationMode === DESTINATION_MODE_ANY;
  const postureAllowsRaw = context.security.posture.destinations.policy !== "labels-only";

  let destination: ResolvedDestination;
  try {
    destination = resolveDestination({
      index: context.bound.destinations,
      ref: input.destination_ref,
      allowRawAddress: chainAllowsRaw && postureAllowsRaw,
    });
  } catch (error) {
    // A miss one or two edits from a registered label is more likely an impersonation
    // attempt than a typo. The caller still gets a plain denial; the near miss goes to the
    // operator's record, because naming it in the response would hand over the real label.
    if (error instanceof AshError) {
      const distance = context.security.posture.destinations.nearMissDistance;
      const near =
        distance > 0 ? nearMisses(context.bound.destinations, input.destination_ref, distance) : [];
      if (near.length > 0) {
        context.sink.record({
          ts: new Date().toISOString(),
          treasury: context.bound.treasury,
          session: context.bound.session,
          policy: context.bound.policy,
          intent: "0".repeat(32),
          outcome: "denied",
          reason_code: error.reasonCode,
          source: "resolver",
          reference: input.reference,
          detail: `Near-miss destination "${input.destination_ref}" close to: ${near.join(", ")}`,
        });
        // A label one or two edits from a registered one is more often impersonation than a
        // typo. The caller still learns nothing it did not already know — naming the real
        // label would hand it over — but the reason code distinguishes the two cases for
        // whoever reads the record.
        throw new AshError({
          reasonCode: "AMBIGUOUS_DESTINATION",
          message:
            `No destination is registered under "${input.destination_ref}", and it is ` +
            "suspiciously close to one that is. Payment refused.",
          outcome: "denied",
          source: "resolver",
        });
      }
    }
    throw error;
  }

  const intentId = deriveIntentId({
    session: String(context.bound.session),
    destination: String(destination.owner),
    mint: String(mint.mint),
    amount,
    reference: input.reference,
  });
  const intentIdHex = intentIdToHex(intentId);
  const [receipt] = await findReceiptPda({ session: context.bound.session, intentId });

  return {
    requirements,
    intentId,
    intentIdHex,
    receipt,
    destination,
    mint,
    amount,
    amountHuman: fromBaseUnits(amount, mint.decimals),
    expiresAt: Math.floor(Date.now() / 1000) + context.runtime.config.intentTtlSeconds,
    ...(input.memo ? { memo: input.memo } : {}),
    reference: input.reference,
  };
}
