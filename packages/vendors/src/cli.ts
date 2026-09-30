#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { createSolanaRpc } from "@solana/kit";
import {
  DEFAULT_PORTS,
  isVendorId,
  loadVendorConfig,
  VENDOR_IDS,
  type VendorConfig,
  type VendorId,
} from "./config.js";
import { startVendorMcp } from "./mcp.js";
import { createVendorServer } from "./server.js";
import { VENDORS } from "./vendors/index.js";

const USAGE = `agent-rails-vendor — demo counterparties for Agent Rails

  serve <oracle|notary|compute|all> [--port N]
      HTTP vendor. Needs <VENDOR>_PAY_TO (receiving wallet, public key only).
  mcp <oracle|notary|compute>
      stdio MCP for one vendor. Needs <VENDOR>_URL and AGENT_RAILS_SESSION.
  buy <oracle|notary|compute> [--symbols SOL,BTC] [--text "..."] [--packs N]
      [--url http://127.0.0.1:4101] [--session PDA] -- <agent-rails pay flags>
      Scripted buyer, no model: invoice → \`agent-rails pay\` → redeem.
`;

function fail(message: string): never {
  console.error(`agent-rails-vendor: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function vendorArg(value: string | undefined): VendorId {
  if (!value || !isVendorId(value)) fail(`expected one of ${VENDOR_IDS.join(", ")}`);
  return value;
}

/**
 * A system account below the rent-exempt minimum cannot receive a small SOL transfer: the
 * runtime rejects the payment and the agent sees a failure that has nothing to do with its
 * policy. Warn at start rather than let the first buyer find out.
 */
async function checkWallet(config: VendorConfig): Promise<void> {
  if (config.mint !== NATIVE_MINT) return;
  try {
    const rpc = createSolanaRpc(config.rpcUrl);
    const { value } = await rpc.getBalance(config.payTo).send();
    const floor = 890_880n;
    const tag = `[vendor:${config.id}]`;
    if (value < floor) {
      console.error(
        `${tag} WARNING: ${config.payTo} holds ${value} lamports, below the rent-exempt ` +
          `minimum (${floor}). Payments smaller than that to it will fail. Fund it first: ` +
          `solana airdrop 0.01 ${config.payTo} --url devnet`,
      );
    } else {
      console.log(`${tag} pay_to ${config.payTo} holds ${value} lamports`);
    }
  } catch (error) {
    console.error(`[vendor:${config.id}] could not read pay_to balance:`, error);
  }
}

async function serve(which: string, port: number | undefined): Promise<void> {
  const ids = which === "all" ? [...VENDOR_IDS] : [vendorArg(which)];
  for (const id of ids) {
    const config = loadVendorConfig(id, process.env, port && ids.length === 1 ? { port } : {});
    const { server } = await createVendorServer({ config, module: VENDORS[id] });
    await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
    console.log(
      `[vendor:${id}] listening on http://${config.host}:${config.port} — ` +
        `${config.unitPriceHuman} ${config.mintSymbol} per ${VENDORS[id].unit}, ` +
        `pay ${config.destinationLabel} (${config.payTo}) on ${config.rpcUrl}`,
    );
    void checkWallet(config);
  }
}

function defaultCliEntry(): string {
  const local = fileURLToPath(new URL("../../cli/dist/cli.js", import.meta.url));
  return process.env.AGENT_RAILS_CLI ?? local;
}

function runPay(args: string[]): Promise<{ code: number; stdout: string }> {
  const entry = defaultCliEntry();
  if (!existsSync(entry)) {
    fail(`agent-rails CLI not found at ${entry}; run pnpm build or set AGENT_RAILS_CLI`);
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function buy(
  vendor: VendorId,
  opts: { url?: string; session?: string; symbols?: string; text?: string; packs?: string },
  payFlags: string[],
): Promise<number> {
  const url = (opts.url ?? `http://127.0.0.1:${DEFAULT_PORTS[vendor]}`).replace(/\/+$/, "");
  const session = opts.session ?? process.env.AGENT_RAILS_SESSION;
  if (!session) fail("--session or AGENT_RAILS_SESSION is required");

  const request: Record<string, unknown> = { session };
  if (vendor === "oracle") request.symbols = (opts.symbols ?? "SOL").split(",");
  if (vendor === "notary") {
    const { createHash } = await import("node:crypto");
    const text = opts.text ?? `agent-rails vendor smoke ${new Date().toISOString()}`;
    request.sha256 = createHash("sha256").update(text).digest("hex");
    request.label = "buy-smoke";
  }
  if (vendor === "compute") request.packs = Number(opts.packs ?? 1);

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const invoice = await post("/invoices", request);
  console.log(JSON.stringify({ step: "invoice", ...invoice }, null, 2));
  if (invoice.status === 200) return 0; // free answer, e.g. already notarised
  if (invoice.status !== 201) return 1;

  const payment = invoice.body.payment as {
    destination_label: string;
    amount: string;
    mint_ref: string;
    reference: string;
  };
  const paid = await runPay([
    "pay",
    "--to",
    payment.destination_label,
    "--amount",
    payment.amount,
    "--mint",
    payment.mint_ref,
    "--reference",
    payment.reference,
    "--session",
    session,
    "--json",
    ...payFlags,
  ]);
  console.log(JSON.stringify({ step: "pay", exit: paid.code, out: paid.stdout.trim() }, null, 2));
  if (paid.code !== 0) return paid.code;

  // `pay` returns once the transaction is confirmed, but the vendor's RPC may lag a slot.
  for (let attempt = 0; attempt < 10; attempt++) {
    const redeemed = await post(`/invoices/${payment.reference}/redeem`, { session });
    if (redeemed.status !== 402) {
      console.log(JSON.stringify({ step: "redeem", ...redeemed }, null, 2));
      return redeemed.status === 200 ? 0 : 1;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.error("redeem still unpaid after 20s");
  return 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dashdash = argv.indexOf("--");
  const own = dashdash === -1 ? argv : argv.slice(0, dashdash);
  const payFlags = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  const { positionals, values } = parseArgs({
    args: own,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      url: { type: "string" },
      session: { type: "string" },
      symbols: { type: "string" },
      text: { type: "string" },
      packs: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, target] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  switch (command) {
    case "serve":
      await serve(target ?? "all", values.port ? Number(values.port) : undefined);
      return;
    case "mcp":
      await startVendorMcp(vendorArg(target));
      return;
    case "buy": {
      const { port: _port, help: _help, ...opts } = values;
      process.exitCode = await buy(vendorArg(target), opts, payFlags);
      return;
    }
    default:
      fail(`unknown command ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(`agent-rails-vendor: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
