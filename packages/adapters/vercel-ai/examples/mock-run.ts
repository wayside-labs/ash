/**
 * Runnable mock: exercises `createAshTools` without RPC or a model provider.
 * Run (from repo root, after build): node --experimental-strip-types packages/adapters/vercel-ai/examples/mock-run.ts
 */
import { createAshTools } from "../dist/index.js";

const tools = createAshTools({
  getSession: async () => ({
    session: "demo-session",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    revoked: false,
  }),
  getPolicy: async () => ({
    perTxMax: "100.00",
    destinationMode: "allowlist",
  }),
  listDestinations: async () => ({
    destinations: [{ label: "acme-hosting" }],
  }),
  getPaymentStatus: async ({ intent_id }) => ({
    intent_id,
    status: "settled",
  }),
  checkPayment: async (input) => ({
    wouldAccept: true,
    resolved: input,
  }),
  executePayment: async (input) => ({
    outcome: "settled",
    intent_id: "a".repeat(32),
    reference: input.reference,
  }),
});

const check = tools.ash_check_payment;
if (!check?.execute) {
  throw new Error("check_payment tool missing execute");
}

const dryRun = await check.execute(
  {
    destination_ref: "acme-hosting",
    amount: "1.25",
    mint_ref: "USDC",
    reference: "demo-invoice-1",
  },
  { toolCallId: "mock-1", messages: [], context: {} },
);

console.log(JSON.stringify({ dryRun }, null, 2));
