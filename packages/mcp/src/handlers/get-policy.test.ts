import { fetchMaybePolicy } from "@agent-rails/client";
import { describe, expect, it, vi } from "vitest";
import type { ServerContext } from "../context.js";
import { testBoundContext, testConfig } from "../testing.js";
import { handleGetPolicy } from "./get-policy.js";

vi.mock("@agent-rails/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-rails/client")>();
  return {
    ...actual,
    fetchMaybePolicy: vi.fn(),
  };
});

const POLICY = "11111111111111111111111111111113";
const TREASURY = "11111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// The policy address comes from the binding, never from a tool argument.
const context = {
  runtime: { config: testConfig(), rpc: {} },
  bound: testBoundContext(),
} as unknown as ServerContext;

function paddedName(text: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(text));
  return bytes;
}

function emptyMintLimit() {
  return {
    mint: "11111111111111111111111111111111",
    perTxMax: 0n,
    shortWindowMax: 0n,
    shortWindowSeconds: 0,
    longWindowMax: 0n,
    longWindowSeconds: 0,
    lifetimeMax: 0n,
    approvalThreshold: 0n,
    cooldownSeconds: 0,
    reserved: new Uint8Array(12),
  };
}

describe("handleGetPolicy", () => {
  it("returns decoded policy constraints when the account exists", async () => {
    vi.mocked(fetchMaybePolicy).mockResolvedValue({
      exists: true,
      address: POLICY,
      data: {
        discriminator: new Uint8Array(8),
        version: 1,
        bump: 254,
        treasury: TREASURY,
        name: paddedName("ops-policy"),
        mintLimits: [
          {
            mint: USDC,
            perTxMax: 1_000_000n,
            shortWindowMax: 5_000_000n,
            shortWindowSeconds: 3_600,
            longWindowMax: 50_000_000n,
            longWindowSeconds: 86_400,
            lifetimeMax: 100_000_000n,
            approvalThreshold: 0n,
            cooldownSeconds: 0,
            reserved: new Uint8Array(12),
          },
          emptyMintLimit(),
          emptyMintLimit(),
          emptyMintLimit(),
        ],
        mintCount: 1,
        destinationMode: 1,
        requireMemo: true,
        createDestinationAta: false,
        activeSessions: 2,
        createdAt: 1_700_000_000n,
        updatedAt: 1_750_000_000n,
        reserved: new Uint8Array(64),
      },
    });

    const result = await handleGetPolicy(context);

    expect(result).toEqual({
      found: true,
      address: POLICY,
      version: 1,
      treasury: TREASURY,
      name: "ops-policy",
      mint_limits: [
        {
          mint: USDC,
          per_tx_max: "1000000",
          short_window_max: "5000000",
          short_window_seconds: 3_600,
          long_window_max: "50000000",
          long_window_seconds: 86_400,
          lifetime_max: "100000000",
          approval_threshold: "0",
          cooldown_seconds: 0,
        },
      ],
      mint_count: 1,
      destination_mode: 1,
      destination_mode_label: "allowlist",
      require_memo: true,
      create_destination_ata: false,
      active_sessions: 2,
      created_at: "1700000000",
      updated_at: "1750000000",
    });
  });

  it("returns found=false when the policy account is missing", async () => {
    vi.mocked(fetchMaybePolicy).mockResolvedValue({
      exists: false,
      address: POLICY,
    });

    const result = await handleGetPolicy(context);

    expect(result).toEqual({ found: false, address: POLICY });
  });
});
