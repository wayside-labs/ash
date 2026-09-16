import { AGENT_RAILS_PROGRAM_ADDRESS, fetchMaybeIntentReceipt } from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import { address, lamports } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import type { ServerContext } from "../context.js";
import { PaymentGovernor } from "../governor.js";
import { testBoundContext, testConfig } from "../testing.js";
import { handleGetPaymentStatus } from "./get-payment-status.js";

vi.mock("@agent-rails/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-rails/client")>();
  return {
    ...actual,
    fetchMaybeIntentReceipt: vi.fn(),
  };
});

const SESSION = address("11111111111111111111111111111114");
const INTENT_ID = "0123456789abcdef0123456789abcdef";
const RECEIPT_PDA = address("11111111111111111111111111111118");
const DESTINATION = address("11111111111111111111111111111115");
const FEE_PAYER = address("11111111111111111111111111111116");

function createContext(): ServerContext {
  return {
    runtime: { config: testConfig(), rpc: {} },
    bound: testBoundContext(),
    governor: new PaymentGovernor({ maxPaymentsPerMinute: 60 }),
  } as unknown as ServerContext;
}

describe("handleGetPaymentStatus", () => {
  it("returns receipt details when the IntentReceipt exists", async () => {
    vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
      exists: true,
      address: RECEIPT_PDA,
      executable: false,
      lamports: lamports(0n),
      programAddress: AGENT_RAILS_PROGRAM_ADDRESS,
      space: 0n,
      data: {
        discriminator: new Uint8Array(8),
        version: 1,
        bump: 253,
        session: SESSION,
        intentId: Uint8Array.from(Buffer.from(INTENT_ID, "hex")),
        mint: address(NATIVE_MINT),
        destinationOwner: DESTINATION,
        amount: 1_000n,
        seq: 4n,
        slot: 250_000_000n,
        timestamp: 1_800_000_000n,
        expiresAt: 1_800_003_600n,
        status: 1,
        feePayer: FEE_PAYER,
        memoHash: new Uint8Array(32),
        reserved: new Uint8Array(32),
      },
    });

    const result = await handleGetPaymentStatus(createContext(), { intent_id: INTENT_ID });

    expect(result.settled).toBe(true);
    expect(result.intent_id).toBe(INTENT_ID);
    expect(result.session).toBe(SESSION);
    expect(result.receipt_pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.receipt).toEqual({
      version: 1,
      session: SESSION,
      intent_id: INTENT_ID,
      mint: address(NATIVE_MINT),
      destination_owner: DESTINATION,
      amount: "1000",
      seq: "4",
      slot: "250000000",
      timestamp: "1800000000",
      expires_at: "1800003600",
      status: 1,
      fee_payer: FEE_PAYER,
      memo_hash: "00".repeat(32),
    });
  });

  it("clears a session quiesce once the receipt is observed", async () => {
    vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
      exists: true,
      address: RECEIPT_PDA,
      executable: false,
      lamports: lamports(0n),
      programAddress: AGENT_RAILS_PROGRAM_ADDRESS,
      space: 0n,
      data: {
        discriminator: new Uint8Array(8),
        version: 1,
        bump: 253,
        session: SESSION,
        intentId: Uint8Array.from(Buffer.from(INTENT_ID, "hex")),
        mint: address(NATIVE_MINT),
        destinationOwner: DESTINATION,
        amount: 1_000n,
        seq: 4n,
        slot: 250_000_000n,
        timestamp: 1_800_000_000n,
        expiresAt: 1_800_003_600n,
        status: 1,
        feePayer: FEE_PAYER,
        memoHash: new Uint8Array(32),
        reserved: new Uint8Array(32),
      },
    });

    const context = createContext();
    context.governor.quiesce({
      intentId: INTENT_ID,
      receipt: RECEIPT_PDA as never,
      reason: "confirmation timed out",
    });
    expect(context.governor.quiesced).toBeDefined();

    // Resolving the outcome is what lets the session pay again. Nothing else does.
    const result = await handleGetPaymentStatus(context, { intent_id: INTENT_ID });

    expect(result.settled).toBe(true);
    expect(result.session_resumed).toBe(true);
    expect(context.governor.quiesced).toBeUndefined();
  });

  it("reports an absent receipt without inviting a retry", async () => {
    vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
      exists: false,
      address: RECEIPT_PDA,
    });

    const result = await handleGetPaymentStatus(createContext(), { intent_id: INTENT_ID });

    expect(result.settled).toBe(false);
    expect(result.intent_id).toBe(INTENT_ID);
    expect(result.session).toBe(SESSION);
    expect(result.receipt_pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    // An absent receipt is not proof the payment did not happen.
    expect(result.message).toContain("still be");
  });
});
