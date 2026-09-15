import { deriveIntentId } from "@agent-rails/contract";
import {
  buildPaymentIntent,
  executePayment,
  findReceiptPda,
  isAgentRailsError,
} from "@agent-rails/sdk";
import { createSolanaRpc } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindSession } from "../src/bound-context.js";
import type { McpRuntime, McpServerConfig } from "../src/config.js";
import type { ServerContext } from "../src/context.js";
import { PaymentGovernor } from "../src/governor.js";
import { handleExecutePayment } from "../src/handlers/execute-payment.js";
import { handleGetPaymentStatus } from "../src/handlers/get-payment-status.js";
import { createPaymentSink } from "../src/sink.js";
import { type BlindingProxy, startBlindingProxy } from "./harness/blinding-proxy.js";
import { createFixture, type Fixture, lamportsOf, VENDOR_LABEL } from "./harness/fixture.js";
import { type Surfnet, startSurfnet, surfnetIsRunning } from "./harness/surfnet.js";

/**
 * The double-spend, against a real ledger.
 *
 * The unit regression in `src/handlers/execute-payment.double-spend.test.ts` proves the
 * client's logic with a fake RPC. This proves the same property where it actually matters:
 * real slots, a real `IntentReceipt`, and a vault whose balance can be counted afterwards.
 * Every assertion about "paid once" here is a balance read, not a mock call count.
 */

/**
 * Assert an outcome, and say why when it is wrong.
 *
 * A bare `expect(result.outcome).toBe(...)` reports "denied, expected settled" and hides the
 * reason code and message, which is the only part that tells you what to fix.
 */
function expectOutcome(
  result: { outcome: string; reason_code?: string; message: string },
  expected: string,
): void {
  if (result.outcome !== expected) {
    throw new Error(
      `expected outcome "${expected}", got "${result.outcome}" ` +
        `[${result.reason_code ?? "no reason_code"}]: ${result.message}`,
    );
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000n;
const PAYMENT_SOL = "0.25";
const PAYMENT_LAMPORTS = 250_000_000n;

let surfnet: Surfnet | undefined;
let fixture: Fixture;
let proxy: BlindingProxy;
let directRpcUrl: string;

function createContext(overrides: Partial<McpServerConfig> = {}): ServerContext {
  const config: McpServerConfig = {
    rpcUrl: proxy.url,
    session: fixture.session,
    signerKeypairPath: "",
    intentTtlSeconds: 90,
    // Short, so a blinded confirmation reaches the indeterminate branch in seconds
    // rather than the production minute.
    confirmTimeoutMs: 4_000,
    resolveAttempts: 3,
    resolveIntervalMs: 250,
    maxPaymentsPerMinute: 60,
    mintAliases: { SOL: "So11111111111111111111111111111111111111112" },
    ...overrides,
  };

  const runtime: McpRuntime = { config, rpc: createSolanaRpc(proxy.url) };

  return {
    runtime,
    signers: { sessionKey: fixture.sessionKey, feePayer: fixture.feePayer },
    bound: boundContext,
    governor: new PaymentGovernor({ maxPaymentsPerMinute: 60 }),
    sink: createPaymentSink(undefined),
  };
}

let boundContext: Awaited<ReturnType<typeof bindSession>>;

beforeAll(async () => {
  const repoRoot = new URL("../../..", import.meta.url).pathname;
  const existing = process.env.AGENT_RAILS_E2E_RPC;

  if (existing && (await surfnetIsRunning(existing))) {
    directRpcUrl = existing;
  } else {
    surfnet = await startSurfnet({ repoRoot });
    directRpcUrl = surfnet.rpcUrl;
  }

  const payerKeypairPath = surfnet?.payerKeypairPath ?? process.env.AGENT_RAILS_E2E_PAYER ?? "";
  if (!payerKeypairPath) {
    throw new Error("AGENT_RAILS_E2E_PAYER is required when reusing an external surfnet");
  }

  fixture = await createFixture({ rpcUrl: directRpcUrl, payerKeypairPath });
  proxy = await startBlindingProxy(directRpcUrl);

  // Binding runs against the real chain: this is also a test that startup validation
  // accepts a correctly configured session.
  boundContext = await bindSession(
    {
      config: { ...createContextConfigStub(), session: fixture.session },
      rpc: createSolanaRpc(proxy.url),
    } as McpRuntime,
    { sessionKey: fixture.sessionKey, feePayer: fixture.feePayer },
  );
}, 300_000);

function createContextConfigStub(): McpServerConfig {
  return {
    rpcUrl: proxy.url,
    session: fixture.session,
    signerKeypairPath: "",
    intentTtlSeconds: 90,
    confirmTimeoutMs: 4_000,
    resolveAttempts: 3,
    resolveIntervalMs: 250,
    maxPaymentsPerMinute: 60,
    mintAliases: { SOL: "So11111111111111111111111111111111111111112" },
  };
}

afterAll(async () => {
  await proxy?.close();
  await surfnet?.stop();
});

describe("payments against a live surfnet", () => {
  it("binds the session, policy and allowlist from chain state", () => {
    expect(boundContext.treasury).toBe(fixture.treasury);
    expect(boundContext.policy).toBe(fixture.policy);
    expect(boundContext.destinationMode).toBe(1);
    expect(boundContext.destinations.entries.map((entry) => entry.label)).toContain(VENDOR_LABEL);
  });

  it("settles a payment and moves exactly the resolved amount", async () => {
    const context = createContext();
    const before = await lamportsOf(directRpcUrl, fixture.solVault);

    const result = await handleExecutePayment(context, {
      destination_ref: VENDOR_LABEL,
      amount: PAYMENT_SOL,
      mint_ref: "SOL",
      reference: "E2E-HAPPY-1",
    });

    expectOutcome(result, "settled");
    const after = await lamportsOf(directRpcUrl, fixture.solVault);
    expect(before - after).toBe(PAYMENT_LAMPORTS);
  }, 60_000);

  it("recovers a blinded confirmation by reading the receipt", async () => {
    const context = createContext();
    const before = await lamportsOf(directRpcUrl, fixture.solVault);

    // The node has the transaction and will not say so before the deadline. This is the
    // ordinary case the original defect needed, and resolution should rescue it.
    proxy.blindSignatureStatuses = true;
    let result: Awaited<ReturnType<typeof handleExecutePayment>>;
    try {
      result = await handleExecutePayment(context, {
        destination_ref: VENDOR_LABEL,
        amount: PAYMENT_SOL,
        mint_ref: "SOL",
        reference: "E2E-BLIND-1",
      });
    } finally {
      proxy.blindSignatureStatuses = false;
    }

    expectOutcome(result, "settled");
    const after = await lamportsOf(directRpcUrl, fixture.solVault);
    expect(before - after).toBe(PAYMENT_LAMPORTS);
  }, 60_000);

  it("reports indeterminate, quiesces, and still pays once", async () => {
    const context = createContext();
    const before = await lamportsOf(directRpcUrl, fixture.solVault);

    const reference = "E2E-UNRESOLVED-1";
    const intentId = deriveIntentId({
      session: String(fixture.session),
      destination: String(fixture.vendor),
      mint: "So11111111111111111111111111111111111111112",
      amount: PAYMENT_LAMPORTS,
      reference,
    });
    const [receiptPda] = await findReceiptPda({ session: fixture.session, intentId });
    const intentIdHex = Array.from(intentId, (b) => b.toString(16).padStart(2, "0")).join("");

    // Blind both the confirmation and the receipt read, so resolution cannot succeed
    // either. This is the worst case, and the one that used to pay twice.
    proxy.blindSignatureStatuses = true;
    proxy.blindAccounts.add(receiptPda);

    const request = {
      destination_ref: VENDOR_LABEL,
      amount: PAYMENT_SOL,
      mint_ref: "SOL",
      reference,
    };

    let first: Awaited<ReturnType<typeof handleExecutePayment>>;
    let retry: Awaited<ReturnType<typeof handleExecutePayment>>;
    try {
      first = await handleExecutePayment(context, request);
      // The agent reads the result and tries again, which is what an agent does.
      retry = await handleExecutePayment(context, request);
    } finally {
      proxy.blindSignatureStatuses = false;
      proxy.blindAccounts.delete(receiptPda);
    }

    expectOutcome(first, "indeterminate");
    expect(first.intent_id).toBe(intentIdHex);
    expect(first.receipt).toBe(receiptPda);

    expect(retry.outcome).toBe("denied");
    expect(retry.reason_code).toBe("SESSION_QUIESCED");

    // The decisive assertion: one payment left the vault, not two.
    const after = await lamportsOf(directRpcUrl, fixture.solVault);
    expect(before - after).toBe(PAYMENT_LAMPORTS);

    // Resolving the outcome is what lets the session pay again.
    const status = await handleGetPaymentStatus(context, { intent_id: intentIdHex });
    expect(status.settled).toBe(true);
    expect(status.session_resumed).toBe(true);
    expect(context.governor.quiesced).toBeUndefined();
  }, 90_000);

  it("is refused on-chain even with every off-chain guard removed", async () => {
    // The governor and the receipt precheck both live in this process, so neither is a
    // guarantee. This goes around both — straight to the SDK, no precheck, no quiesce —
    // to confirm the program itself refuses the duplicate, which is the property ADR-004
    // actually promises.
    const rpc = createSolanaRpc(directRpcUrl);
    const reference = "E2E-BACKSTOP-1";
    const intentId = deriveIntentId({
      session: String(fixture.session),
      destination: String(fixture.vendor),
      mint: "So11111111111111111111111111111111111111112",
      amount: PAYMENT_LAMPORTS,
      reference,
    });
    const intentIdHex = Array.from(intentId, (b) => b.toString(16).padStart(2, "0")).join("");

    const before = await lamportsOf(directRpcUrl, fixture.solVault);

    const pay = async () => {
      const { value: blockhash } = await rpc.getLatestBlockhash().send();
      const payment = await buildPaymentIntent({
        intent_id: intentIdHex,
        mint: "So11111111111111111111111111111111111111112",
        destination: fixture.vendor,
        amount: PAYMENT_LAMPORTS,
        expires_at: Math.floor(Date.now() / 1000) + 90,
        treasury: fixture.treasury,
        policy: fixture.policy,
        session: fixture.session,
        allowlistEntry: fixture.allowlistEntry,
        feePayer: fixture.feePayer,
        sessionKey: fixture.sessionKey,
        recentBlockhash: blockhash,
      });
      return executePayment({
        rpc,
        transactionMessage: payment.transactionMessage,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        session: fixture.session,
        intentId,
        confirmTimeoutMs: 30_000,
      });
    };

    const settled = await pay();
    expect(settled.outcome).toBe("settled");

    // Same payment, same derived id, same receipt PDA. The program has to refuse it.
    await expect(pay()).rejects.toSatisfy(
      (error: unknown) => isAgentRailsError(error) && error.outcome !== "settled",
    );

    const after = await lamportsOf(directRpcUrl, fixture.solVault);
    expect(before - after).toBe(PAYMENT_LAMPORTS);
  }, 120_000);

  it("keeps the vault arithmetic consistent across the whole suite", async () => {
    const vault = await lamportsOf(directRpcUrl, fixture.solVault);

    // Four payments were attempted across this suite — happy, blinded, unresolved,
    // backstop — and three of them were retried. Exactly four left the vault.
    expect(fixture.initialVaultLamports - vault).toBe(4n * PAYMENT_LAMPORTS);

    // The rent-exempt floor is unspendable by construction, so the vault can never be
    // emptied into a closed account (ARCHITECTURE section 6).
    expect(vault).toBeGreaterThan(fixture.rentExemptFloor);
    expect(PAYMENT_LAMPORTS * 4n).toBeLessThan(10n * LAMPORTS_PER_SOL);
  });
});
