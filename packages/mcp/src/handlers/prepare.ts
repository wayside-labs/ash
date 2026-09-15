import {
  AmountConversionError,
  deriveIntentId,
  fromBaseUnits,
  intentIdToHex,
  type McpExecutePaymentInput,
  toBaseUnits,
} from "@agent-rails/contract";
import {
  AgentRailsError,
  findReceiptPda,
  nearMisses,
  type ResolvedDestination,
  resolveDestination,
} from "@agent-rails/sdk";
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
      throw new AgentRailsError({
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
    throw new AgentRailsError({
      reasonCode: "AMOUNT_ZERO",
      message: "Payment amount must be greater than zero.",
      outcome: "denied",
      source: "resolver",
    });
  }

  if (context.bound.requireMemo && !input.memo) {
    throw new AgentRailsError({
      reasonCode: "MEMO_REQUIRED",
      message: "This policy requires a memo on every payment.",
      outcome: "denied",
      source: "resolver",
    });
  }

  let destination: ResolvedDestination;
  try {
    destination = resolveDestination({
      index: context.bound.destinations,
      ref: input.destination_ref,
      allowRawAddress: context.bound.destinationMode === DESTINATION_MODE_ANY,
    });
  } catch (error) {
    // A miss one or two edits from a registered label is more likely an impersonation
    // attempt than a typo. The caller still gets a plain denial; the near miss goes to the
    // operator's record, because naming it in the response would hand over the real label.
    if (error instanceof AgentRailsError) {
      const near = nearMisses(context.bound.destinations, input.destination_ref);
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
