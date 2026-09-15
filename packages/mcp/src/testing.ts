import { type Address, generateKeyPairSigner } from "@solana/kit";
import type { BoundContext } from "./bound-context.js";
import type { McpRuntime, McpServerConfig } from "./config.js";
import type { ServerContext } from "./context.js";
import { PaymentGovernor } from "./governor.js";
import { createPaymentSink } from "./sink.js";

/**
 * Test scaffolding. Not part of the published surface — `tsdown` only bundles `cli.ts` and
 * `server.ts`, so nothing here reaches `dist`.
 */

export const TEST_TREASURY = "11111111111111111111111111111112" as Address;
export const TEST_POLICY = "11111111111111111111111111111113" as Address;
export const TEST_SESSION = "11111111111111111111111111111114" as Address;
export const TEST_VENDOR = "11111111111111111111111111111115" as Address;
export const TEST_ALLOWLIST_ENTRY = "11111111111111111111111111111116" as Address;
export const NATIVE_MINT_ADDRESS = "So11111111111111111111111111111111111111112" as Address;
export const TEST_BLOCKHASH = "EkSnNWid2cvwEVnVx9aBxgney8D4R9fKQ89KWkdHUjbv";
export const TEST_LAST_VALID_BLOCK_HEIGHT = 1_000_000n;

export function testConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    rpcUrl: "http://localhost:8899",
    session: TEST_SESSION,
    signerKeypairPath: "/dev/null",
    intentTtlSeconds: 90,
    confirmTimeoutMs: 1_000,
    resolveAttempts: 2,
    resolveIntervalMs: 1,
    maxPaymentsPerMinute: 60,
    mintAliases: { SOL: NATIVE_MINT_ADDRESS },
    ...overrides,
  };
}

export function testBoundContext(overrides: Partial<BoundContext> = {}): BoundContext {
  return {
    treasury: TEST_TREASURY,
    policy: TEST_POLICY,
    session: TEST_SESSION,
    sessionKey: TEST_SESSION,
    destinationMode: 1,
    requireMemo: false,
    mints: [
      {
        symbol: "SOL",
        mint: NATIVE_MINT_ADDRESS,
        decimals: 9,
        tokenProgram: "11111111111111111111111111111111" as Address,
        isNative: true,
        inPolicy: true,
      },
    ],
    destinations: {
      policy: TEST_POLICY,
      loadedAt: Date.now(),
      entries: [
        {
          label: "acme-hosting",
          normalizedLabel: "acme-hosting",
          owner: TEST_VENDOR,
          entry: TEST_ALLOWLIST_ENTRY,
          perTxMaxOverride: 0n,
        },
      ],
    },
    boundAt: Date.now(),
    ...overrides,
  };
}

/**
 * A live, unpaused treasury and session, as `assertSessionLive` reads them.
 *
 * Returned by the fake RPC's account fetches so handler tests exercise the real liveness
 * path rather than stubbing past it.
 */
export function liveAccountFixtures() {
  const farFuture = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  return {
    treasury: { paused: false },
    session: { revoked: false, expiresAt: farFuture },
  };
}

export type FakeRpcOptions = {
  /** Called for every broadcast; push the wire transaction somewhere to inspect it. */
  onSend?: (wireTransaction: string) => void;
  /** Statuses returned by `getSignatureStatuses`. Default: never confirms. */
  signatureStatus?: unknown;
  /** Block height relative to the blockhash lifetime. */
  blockHeight?: bigint;
  /** Base64 account data by address; absent means the account does not exist. */
  accounts?: Map<string, string>;
  simulationError?: unknown;
};

export async function testServerContext(
  runtime: McpRuntime,
  overrides: Partial<ServerContext> = {},
): Promise<ServerContext> {
  return {
    runtime,
    signers: {
      feePayer: await generateKeyPairSigner(),
      sessionKey: await generateKeyPairSigner(),
    },
    bound: testBoundContext(),
    governor: new PaymentGovernor({ maxPaymentsPerMinute: 60 }),
    sink: createPaymentSink(undefined),
    ...overrides,
  };
}
