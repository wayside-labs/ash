import { NATIVE_MINT } from "@agent-rails/contract";
import { createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildPaymentIntent, createIntentId } from "./payment-intent.js";

const TREASURY = "11111111111111111111111111111112" as const;
const POLICY = "11111111111111111111111111111113" as const;
const SESSION = "11111111111111111111111111111114" as const;
const DESTINATION = "11111111111111111111111111111115" as const;
const FEE_PAYER = "11111111111111111111111111111116" as const;
const SESSION_KEY = "11111111111111111111111111111117" as const;
const SPL_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;

const recentBlockhash = {
  blockhash: "EkSnNWid2cvwEVnVx9aBxgney8D4R9fKQ89KWkdHUjbv" as const,
  lastValidBlockHeight: 1_000_000n,
};

function baseParams(mint: string) {
  const intentId = createIntentId();
  return {
    intent_id: Array.from(intentId, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    mint,
    destination: DESTINATION,
    amount: 1_000n,
    expires_at: 1_900_000_000,
    treasury: TREASURY,
    policy: POLICY,
    session: SESSION,
    feePayer: createNoopSigner(FEE_PAYER),
    sessionKey: createNoopSigner(SESSION_KEY),
    recentBlockhash,
  };
}

describe("buildPaymentIntent", () => {
  it("routes native SOL to execute_payment_sol", async () => {
    const result = await buildPaymentIntent(baseParams(NATIVE_MINT));

    expect(result.path).toBe("sol");
    expect(result.pdas.receipt).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.pdas.eventAuthority).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.pdas.solVault).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.pdas.vaultAta).toBeUndefined();
    expect(result.instruction.programAddress).toBe(
      "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS",
    );
    expect(result.transactionMessage.instructions).toHaveLength(1);
  });

  it("routes SPL tokens to execute_payment", async () => {
    const result = await buildPaymentIntent(baseParams(SPL_MINT));

    expect(result.path).toBe("spl");
    expect(result.pdas.vaultAta).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.pdas.destinationAta).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.pdas.solVault).toBeUndefined();
    expect(result.instruction.programAddress).toBe(
      "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS",
    );
  });

  it("includes allowlist entry when provided", async () => {
    const allowlistEntry = "11111111111111111111111111111118";
    const result = await buildPaymentIntent({
      ...baseParams(NATIVE_MINT),
      allowlistEntry,
    });

    expect(result.pdas.allowlistEntry).toBe(allowlistEntry);
    const allowlistMeta = result.instruction.accounts.find(
      (account) => account.address === allowlistEntry,
    );
    expect(allowlistMeta).toBeDefined();
  });
});
