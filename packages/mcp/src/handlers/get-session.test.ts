import { fetchMaybeAgentSession } from "@agent-rails/client";
import { describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import { handleGetSession } from "./get-session.js";

vi.mock("@agent-rails/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-rails/client")>();
  return {
    ...actual,
    fetchMaybeAgentSession: vi.fn(),
  };
});

const SESSION = "11111111111111111111111111111114";
const TREASURY = "11111111111111111111111111111112";
const POLICY = "11111111111111111111111111111113";
const SESSION_KEY = "11111111111111111111111111111117";

const runtime = {
  config: { rpcUrl: "http://localhost:8899", signerKeypairPath: "/tmp/session.json" },
  rpc: {},
} as McpRuntime;

function paddedLabel(text: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(text));
  return bytes;
}

describe("handleGetSession", () => {
  it("returns decoded session state when the account exists", async () => {
    vi.mocked(fetchMaybeAgentSession).mockResolvedValue({
      exists: true,
      address: SESSION,
      data: {
        discriminator: new Uint8Array(8),
        version: 1,
        bump: 255,
        treasury: TREASURY,
        policy: POLICY,
        sessionKey: SESSION_KEY,
        authMode: 0,
        label: paddedLabel("billing-agent"),
        createdAt: 1_700_000_000n,
        expiresAt: 1_900_000_000n,
        revoked: false,
        revokedAt: 0n,
        seq: 3n,
        auditHead: new Uint8Array(32).fill(0xab),
        spend: [
          {
            mint: "So11111111111111111111111111111111111111112",
            shortWindowStart: 1_700_000_000n,
            shortSpent: 500n,
            longWindowStart: 1_700_000_000n,
            longSpent: 1_500n,
            lifetimeSpent: 10_000n,
            lastPaymentAt: 1_800_000_000n,
          },
        ],
        reserved: new Uint8Array(64),
      },
    });

    const result = await handleGetSession(runtime, { session: SESSION });

    expect(result).toEqual({
      found: true,
      address: SESSION,
      version: 1,
      treasury: TREASURY,
      policy: POLICY,
      session_key: SESSION_KEY,
      auth_mode: 0,
      label: "billing-agent",
      created_at: "1700000000",
      expires_at: "1900000000",
      revoked: false,
      revoked_at: "0",
      seq: "3",
      audit_head: "ab".repeat(32),
      spend: [
        {
          mint: "So11111111111111111111111111111111111111112",
          short_window_start: "1700000000",
          short_spent: "500",
          long_window_start: "1700000000",
          long_spent: "1500",
          lifetime_spent: "10000",
          last_payment_at: "1800000000",
        },
      ],
    });
  });

  it("returns found=false when the session account is missing", async () => {
    vi.mocked(fetchMaybeAgentSession).mockResolvedValue({
      exists: false,
      address: SESSION,
    });

    const result = await handleGetSession(runtime, { session: SESSION });

    expect(result).toEqual({ found: false, address: SESSION });
  });
});
