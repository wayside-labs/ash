import { createHash } from "node:crypto";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { agentRailsHome, type VendorId } from "./config.js";
import { JsonFile } from "./store.js";

/**
 * One stdio MCP server per vendor: the shape a real vendor would ship.
 *
 * It holds no key and cannot pay. Buying is three calls across two servers — this one
 * issues the invoice, `agent-rails-mcp` pays it under the policy, this one redeems — so
 * the spend decision always passes through the rails and never through a vendor's code.
 * That split is the thing under test, and a vendor MCP that could pay on its own would
 * hide exactly the failures the platform exists to catch.
 *
 * The session is process identity, as in `agent-rails-mcp`: read from AGENT_RAILS_SESSION,
 * never a tool argument, so the model cannot redeem as someone else.
 */

type Http = { status: number; body: Record<string, unknown> };

function client(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  return async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Http> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  };
}

function result(http: Http, hint?: string) {
  const payload = { http_status: http.status, ...http.body, ...(hint ? { next_step: hint } : {}) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(http.status >= 400 ? { isError: true } : {}),
  };
}

const PAY_HINT =
  "Pay this invoice with agent_rails_execute_payment using payment.destination_label as " +
  "destination_ref, payment.amount as amount, payment.mint_ref as mint_ref and " +
  "payment.reference as reference — exactly, or the vendor cannot match it. Then call the " +
  "redeem tool with invoice_id.";

const REDEEM_402_HINT =
  "Not paid yet (see payment_error). If execute_payment returned settled, wait a few " +
  "seconds and redeem again; if it was indeterminate, resolve it with " +
  "agent_rails_get_payment_status first. Never pay the same invoice with a different reference.";

const REDEEM_503_HINT =
  "Paid, but the vendor cannot deliver right now. Do not pay again: redeem the same " +
  "invoice_id again in a minute.";

const invoiceIdSchema = z
  .string()
  .regex(/^inv_[a-z]+_[A-Za-z0-9_-]+$/)
  .describe("invoice_id returned by the request tool");

export async function startVendorMcp(vendor: VendorId, env: NodeJS.ProcessEnv = process.env) {
  const prefix = vendor.toUpperCase();
  const url = env[`${prefix}_URL`] ?? env.VENDOR_URL;
  if (!url) throw new Error(`${prefix}_URL (or VENDOR_URL) is required`);
  const session = env.AGENT_RAILS_SESSION;
  if (!session) throw new Error("AGENT_RAILS_SESSION (the paying AgentSession PDA) is required");

  const call = client(url);
  const server = new McpServer(
    { name: `agent-rails-vendor-${vendor}`, version: "0.1.0" },
    {
      instructions:
        `Buys from the ${vendor} vendor. Every purchase is: request (invoice) → ` +
        "agent_rails_execute_payment (on the agent-rails server) → redeem. This server " +
        "cannot pay; check the catalog first, and dry-run with agent_rails_check_payment " +
        "when unsure the policy allows the amount.",
    },
  );

  server.registerTool(
    `${vendor}_catalog`,
    {
      description: `Free. What the ${vendor} vendor sells, its price, and the destination to pay.`,
      inputSchema: z.strictObject({}),
    },
    async () => result(await call("GET", "/catalog")),
  );

  server.registerTool(
    `${vendor}_get_invoice`,
    {
      description: "Free. Current status of an invoice (open, expired, redeemed).",
      inputSchema: z.strictObject({ invoice_id: invoiceIdSchema }),
    },
    async ({ invoice_id }) => result(await call("GET", `/invoices/${invoice_id}`)),
  );

  let computeAccount: JsonFile<{ account_id: string | null; token: string | null }> | null = null;
  if (vendor === "compute") {
    // Credits outlive one agent run, so the account token is kept on disk per session.
    computeAccount = await JsonFile.open(
      join(agentRailsHome(env), "vendors", `compute-account-${session.slice(0, 8)}.json`),
      () => ({ account_id: null, token: null }),
    );
  }

  server.registerTool(
    `${vendor}_redeem`,
    {
      description:
        "After paying an invoice through agent_rails_execute_payment, collect what it bought. " +
        "Safe to repeat: a redeemed invoice returns the same delivery again.",
      inputSchema: z.strictObject({
        invoice_id: invoiceIdSchema,
        intent_id: z
          .string()
          .regex(/^[0-9a-f]{32}$/)
          .optional()
          .describe("intent_id from execute_payment, if you have it; used to explain a mismatch"),
      }),
    },
    async ({ invoice_id, intent_id }) => {
      const http = await call("POST", `/invoices/${invoice_id}/redeem`, {
        session,
        ...(intent_id ? { intent_id } : {}),
      });
      const delivery = http.body.delivery as { account_id?: string; token?: string } | undefined;
      if (computeAccount && http.status === 200 && delivery?.account_id) {
        computeAccount.data.account_id = delivery.account_id;
        if (delivery.token) computeAccount.data.token = delivery.token;
        await computeAccount.save();
        // The model has no use for the bearer token; this server holds it.
        http.body.delivery = {
          ...delivery,
          token: delivery.token ? "(stored by the MCP)" : undefined,
        };
      }
      return result(
        http,
        http.status === 402 ? REDEEM_402_HINT : http.status === 503 ? REDEEM_503_HINT : undefined,
      );
    },
  );

  if (vendor === "oracle") {
    server.registerTool(
      "oracle_request_quote",
      {
        description:
          "Get an invoice for a USD price quote. Price is per symbol, so ask only for what you need.",
        inputSchema: z.strictObject({
          symbols: z.array(z.string()).min(1).max(10).describe('e.g. ["SOL", "BTC"]'),
        }),
      },
      async ({ symbols }) =>
        result(await call("POST", "/invoices", { symbols, session }), PAY_HINT),
    );
  }

  if (vendor === "notary") {
    const docSchema = z.strictObject({
      text: z.string().min(1).max(200_000).optional().describe("Document text; hashed locally"),
      sha256: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional()
        .describe("Or the document's sha256, if you already have it"),
      label: z.string().max(80).optional(),
    });
    const digest = (input: { text?: string | undefined; sha256?: string | undefined }) =>
      input.sha256?.toLowerCase() ??
      (input.text === undefined ? null : createHash("sha256").update(input.text).digest("hex"));

    server.registerTool(
      "notary_lookup",
      {
        description: "Free. Whether a document (by text or sha256) is already notarised.",
        inputSchema: docSchema,
      },
      async (input) => {
        const hash = digest(input);
        if (!hash) return result({ status: 422, body: { error: "give text or sha256" } });
        return result(await call("GET", `/certificates/${hash}`));
      },
    );
    server.registerTool(
      "notary_request",
      {
        description:
          "Get an invoice to notarise a document. Only its sha256 leaves this machine. If the " +
          "hash is already notarised the certificate comes back free and there is nothing to pay.",
        inputSchema: docSchema,
      },
      async (input) => {
        const hash = digest(input);
        if (!hash) return result({ status: 422, body: { error: "give text or sha256" } });
        const http = await call("POST", "/invoices", {
          sha256: hash,
          label: input.label ?? "",
          session,
        });
        return result(http, http.status === 201 ? PAY_HINT : undefined);
      },
    );
  }

  if (vendor === "compute" && computeAccount) {
    const account = computeAccount;
    const bearer = (): Record<string, string> =>
      account.data.token ? { authorization: `Bearer ${account.data.token}` } : {};

    server.registerTool(
      "compute_buy_credits",
      {
        description:
          "Get an invoice for credit packs. Jobs cost 1–2 credits; buy what the task needs.",
        inputSchema: z.strictObject({ packs: z.number().int().min(1).max(20) }),
      },
      async ({ packs }) =>
        result(
          await call("POST", "/invoices", {
            packs,
            session,
            ...(account.data.account_id ? { account_id: account.data.account_id } : {}),
          }),
          PAY_HINT,
        ),
    );
    server.registerTool(
      "compute_balance",
      {
        description: "Free. Remaining credits on this agent's compute account.",
        inputSchema: z.strictObject({}),
      },
      async () =>
        account.data.token
          ? result(await call("GET", "/account", undefined, bearer()))
          : result({ status: 404, body: { error: "no account yet: buy credits first" } }),
    );
    server.registerTool(
      "compute_run_job",
      {
        description:
          "Run a text job against prepaid credits: keywords (1), summarize (2), sha256 (1).",
        inputSchema: z.strictObject({
          kind: z.enum(["keywords", "summarize", "sha256"]),
          input: z.string().min(1).max(20_000),
        }),
      },
      async ({ kind, input }) =>
        account.data.token
          ? result(await call("POST", "/jobs", { kind, input }, bearer()))
          : result({ status: 402, body: { error: "no account yet: buy credits first" } }),
    );
  }

  await server.connect(new StdioServerTransport());
  console.error(`[agent-rails-vendor-mcp:${vendor}] ${url} as session ${session}`);
}
