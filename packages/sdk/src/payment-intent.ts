import { INTENT_ID_LEN, MAX_MEMO_LEN, paymentIntentSchema } from "@agent-rails/contract";
import type { Address } from "@solana/kit";
import { randomBytes } from "node:crypto";

export type PaymentIntent = {
  intentId: Uint8Array;
  mint: Address;
  destination: Address;
  amount: bigint;
  expiresAt: number;
  memo?: string;
};

export type PaymentIntentInput = {
  mint: Address;
  destination: Address;
  amount: bigint;
  expiresAt: number;
  memo?: string;
  intentId?: Uint8Array;
};

export function createIntentId(bytes?: Uint8Array): Uint8Array {
  if (bytes) {
    if (bytes.byteLength !== INTENT_ID_LEN) {
      throw new RangeError(`intentId must be ${INTENT_ID_LEN} bytes`);
    }
    return bytes;
  }
  return randomBytes(INTENT_ID_LEN);
}

export function buildPaymentIntent(input: PaymentIntentInput): PaymentIntent {
  const intentId = createIntentId(input.intentId);
  const memo = input.memo ?? "";

  paymentIntentSchema.parse({
    intent_id: Array.from(intentId, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    mint: input.mint,
    destination: input.destination,
    amount: input.amount,
    expires_at: input.expiresAt,
    memo: memo.length > 0 ? memo : undefined,
  });

  if (memo.length > MAX_MEMO_LEN) {
    throw new RangeError(`memo exceeds ${MAX_MEMO_LEN} bytes`);
  }

  const intent: PaymentIntent = {
    intentId,
    mint: input.mint,
    destination: input.destination,
    amount: input.amount,
    expiresAt: input.expiresAt,
  };
  if (memo.length > 0) {
    intent.memo = memo;
  }
  return intent;
}
