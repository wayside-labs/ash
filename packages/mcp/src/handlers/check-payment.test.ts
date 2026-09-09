import { fetchMaybeIntentReceipt } from "@agent-rails/client";
import { describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import { handleCheckPayment } from "./check-payment.js";

vi.mock("@agent-rails/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-rails/client")>();
  return {
    ...actual,
    fetchMaybeIntentReceipt: vi.fn(),
  };
});

const SESSION = "11111111111111111111111111111114";
const INTENT_ID = "0123456789abcdef0123456789abcdef";
const RECEIPT_PDA = "11111111111111111111111111111118";
const DESTINATION = "11111111111111111111111111111115";
const FEE_PAYER = "11111111111111111111111111111116";

const runtime = {
  config: { rpcUrl: "http://localhost:8899", signerKeypairPath: "/tmp/session.json" },
  rpc: {},
} as McpRuntime;

describe("handleCheckPayment", () => {
  it("returns receipt details when the IntentReceipt exists", async () => {
    vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
      exists: true,
      address: RECEIPT_PDA,
      data: {
        discriminator: new Uint8Array(8),
        version: 1,
        bump: 253,
        session: SESSION,
        intentId: Uint8Array.from(Buffer.from(INTENT_ID, "hex")),
        mint: "So11111111111111111111111111111111111111112",
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

    const result = await handleCheckPayment(runtime, {
      session: SESSION,
      intent_id: INTENT_ID,
    });

    expect(result.exists).toBe(true);
    expect(result.intent_id).toBe(INTENT_ID);
    expect(result.session).toBe(SESSION);
    expect(result.receipt_pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(result.receipt).toEqual({
      version: 1,
      session: SESSION,
      intent_id: INTENT_ID,
      mint: "So11111111111111111111111111111111111111112",
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

  it("returns exists=false when no receipt is on-chain", async () => {
    vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
      exists: false,
      address: RECEIPT_PDA,
    });

    const result = await handleCheckPayment(runtime, {
      session: SESSION,
      intent_id: INTENT_ID,
    });

    expect(result).toEqual({
      exists: false,
      receipt_pda: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
      intent_id: INTENT_ID,
      session: SESSION,
    });
  });
});
