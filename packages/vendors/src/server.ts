import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { fromBaseUnits } from "@ash/contract";
import { z } from "zod";
import type { VendorConfig } from "./config.js";
import { JsonFile, newId, nowSeconds } from "./store.js";
import {
  DeliveryUnavailable,
  type HttpResult,
  type Invoice,
  type VendorModule,
  type VendorState,
} from "./vendor.js";
import { type ReceiptReader, rpcReceiptReader, verifyPayment } from "./verify.js";

const MAX_BODY_BYTES = 64 * 1024;
/** Open invoices kept this long past expiry, so a late payment can still be redeemed. */
const PRUNE_AFTER_SECONDS = 86_400;
/** Invoices cost nothing to create, so an unauthenticated caller must not grow the file forever. */
const MAX_OPEN_INVOICES = 2_000;

const redeemSchema = z.object({
  session: z.string().min(32).max(44),
  intent_id: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
});

const sessionSchema = z.string().min(32).max(44);

class BodyError extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyError("body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BodyError("body is not JSON");
  }
}

/** The invoice as a buyer sees it: everything needed to pay it through ASH. */
export function presentInvoice(invoice: Invoice) {
  return {
    invoice_id: invoice.id,
    vendor: invoice.vendor,
    status: invoice.redeemed ? "redeemed" : invoice.expiresAt < nowSeconds() ? "expired" : "open",
    units: invoice.units,
    expires_at: new Date(invoice.expiresAt * 1000).toISOString(),
    payment: {
      destination_label: invoice.destinationLabel,
      destination_owner: invoice.payTo,
      amount: invoice.amountHuman,
      amount_base_units: invoice.amount,
      mint_ref: invoice.mintSymbol,
      mint: invoice.mint,
      reference: invoice.id,
    },
    payer_session: invoice.payerSession,
    ...(invoice.redeemed
      ? { receipt: invoice.redeemed.receipt, redeemed_at: invoice.redeemed.redeemedAt }
      : {}),
  };
}

function prune(state: VendorState<unknown>): void {
  const now = nowSeconds();
  const open = Object.values(state.invoices).filter((inv) => !inv.redeemed);
  for (const inv of open) {
    if (inv.expiresAt + PRUNE_AFTER_SECONDS < now) delete state.invoices[inv.id];
  }
}

export type VendorServerOptions<S> = {
  config: VendorConfig;
  module: VendorModule<S>;
  readReceipt?: ReceiptReader;
  statePath?: string;
};

export async function createVendorServer<S>(options: VendorServerOptions<S>): Promise<{
  server: Server;
  state: JsonFile<VendorState<S>>;
}> {
  const { config, module } = options;
  const readReceipt = options.readReceipt ?? rpcReceiptReader(config.rpcUrl);
  const state = await JsonFile.open<VendorState<S>>(
    options.statePath ?? join(config.dataDir, "state.json"),
    () => ({ invoices: {}, vendor: module.emptyState() }),
  );
  // A file written by an older build may lack keys a newer vendor expects.
  state.data.invoices ??= {};
  state.data.vendor = { ...module.emptyState(), ...state.data.vendor };
  const inflight = new Map<string, Promise<HttpResult>>();

  const catalog = () => ({
    vendor: module.id,
    title: module.title,
    unit: module.unit,
    price_per_unit: `${config.unitPriceHuman} ${config.mintSymbol}`,
    payment: {
      destination_label: config.destinationLabel,
      destination_owner: config.payTo,
      mint_ref: config.mintSymbol,
      mint: config.mint,
    },
    flow: [
      "POST /invoices with the purchase request (optionally `session` to pin the payer)",
      "pay it with ash_execute_payment: destination_ref=destination_label, " +
        "amount, mint_ref, reference=invoice_id",
      "POST /invoices/{id}/redeem with {session} to receive what was bought",
    ],
    ...module.describe(config),
  });

  async function createInvoice(body: unknown): Promise<HttpResult> {
    const record = (body ?? {}) as Record<string, unknown>;
    let payerSession: string | null = null;
    if (record.session !== undefined) {
      const parsed = sessionSchema.safeParse(record.session);
      if (!parsed.success) return { status: 422, body: { error: "session must be an address" } };
      payerSession = parsed.data;
    }
    const quote = await module.quote(body, state.data.vendor, config);
    if (quote.kind === "error") return { status: quote.status, body: { error: quote.message } };
    if (quote.kind === "free") return { status: 200, body: quote.body };

    prune(state.data as VendorState<unknown>);
    const open = Object.values(state.data.invoices).filter((inv) => !inv.redeemed).length;
    if (open >= MAX_OPEN_INVOICES) {
      return { status: 429, body: { error: "too many open invoices; pay or wait for expiry" } };
    }

    const amount = config.unitPrice * BigInt(quote.units);
    const now = nowSeconds();
    const invoice: Invoice = {
      id: newId(`inv_${module.id}`),
      vendor: module.id,
      createdAt: now,
      expiresAt: now + config.invoiceTtlSeconds,
      units: quote.units,
      amount: amount.toString(),
      amountHuman: fromBaseUnits(amount, config.decimals),
      mint: config.mint,
      mintSymbol: config.mintSymbol,
      payTo: config.payTo,
      destinationLabel: config.destinationLabel,
      payerSession,
      request: quote.request,
      redeemed: null,
    };
    state.data.invoices[invoice.id] = invoice;
    await state.save();
    return { status: 201, body: presentInvoice(invoice) };
  }

  async function redeem(invoice: Invoice, body: unknown): Promise<HttpResult> {
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      return { status: 422, body: { error: "expected {session, intent_id?}" } };
    }
    const { session, intent_id } = parsed.data;

    if (invoice.redeemed) {
      // Redeem is idempotent for the payer: a retry after a dropped response gets the same
      // delivery instead of a second charge or an error it cannot act on.
      if (invoice.redeemed.session === session) {
        return {
          status: 200,
          body: { ...presentInvoice(invoice), delivery: invoice.redeemed.delivery, replay: true },
        };
      }
      return { status: 409, body: { error: "invoice already redeemed by another session" } };
    }
    if (invoice.payerSession && invoice.payerSession !== session) {
      return { status: 403, body: { error: "invoice is pinned to a different session" } };
    }

    const verdict = await verifyPayment(
      readReceipt,
      {
        session,
        payTo: config.payTo,
        mint: config.mint,
        amount: BigInt(invoice.amount),
        reference: invoice.id,
      },
      intent_id,
    );
    if (!verdict.ok) {
      return { status: 402, body: { ...presentInvoice(invoice), payment_error: verdict } };
    }

    let delivery: unknown;
    try {
      delivery = await module.deliver(
        invoice,
        { session, receipt: verdict.receipt, intentId: verdict.intentId },
        state.data.vendor,
        config,
      );
    } catch (error) {
      if (!(error instanceof DeliveryUnavailable)) throw error;
      return {
        status: 503,
        body: {
          ...presentInvoice(invoice),
          paid: true,
          retryable: true,
          error: error.message,
        },
      };
    }
    invoice.redeemed = {
      session,
      intentId: verdict.intentId,
      receipt: verdict.receipt,
      redeemedAt: nowSeconds(),
      delivery,
    };
    await state.save();
    return { status: 200, body: { ...presentInvoice(invoice), delivery } };
  }

  async function route(req: IncomingMessage): Promise<HttpResult> {
    const url = new URL(req.url ?? "/", "http://vendor");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";

    if (method === "GET" && (path === "/" || path === "/catalog")) {
      return { status: 200, body: catalog() };
    }
    if (method === "GET" && path === "/health") {
      return { status: 200, body: { ok: true, vendor: module.id } };
    }
    if (method === "POST" && path === "/invoices") return createInvoice(await readJson(req));

    const match = /^\/invoices\/([A-Za-z0-9_-]{1,64})(\/redeem)?$/.exec(path);
    if (match?.[1]) {
      const invoice = state.data.invoices[match[1]];
      if (!invoice) return { status: 404, body: { error: "no such invoice" } };
      if (method === "GET" && !match[2]) return { status: 200, body: presentInvoice(invoice) };
      if (method === "POST" && match[2]) {
        const body = await readJson(req);
        // Two concurrent redeems of one invoice share one verification and one delivery.
        const running = inflight.get(invoice.id);
        if (running) return running;
        const pending = redeem(invoice, body).finally(() => inflight.delete(invoice.id));
        inflight.set(invoice.id, pending);
        return pending;
      }
    }

    for (const extra of module.routes ?? []) {
      if (extra.method !== method) continue;
      const exact = extra.path === path;
      const prefixed = extra.path.endsWith("/") && path.startsWith(extra.path);
      if (!exact && !prefixed) continue;
      const body = method === "POST" ? await readJson(req) : undefined;
      return extra.handle({
        param: prefixed ? decodeURIComponent(path.slice(extra.path.length)) : "",
        body,
        req,
        state,
        config,
      });
    }
    return { status: 404, body: { error: "not found" } };
  }

  const server = createServer((req, res) => {
    const started = Date.now();
    route(req)
      .catch((error: unknown): HttpResult => {
        if (error instanceof BodyError) return { status: 400, body: { error: error.message } };
        console.error(`[vendor:${module.id}]`, error);
        return { status: 500, body: { error: "internal error" } };
      })
      .then(({ status, body }) => {
        res.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(`${JSON.stringify(body, null, 2)}\n`);
        console.log(
          `[vendor:${module.id}] ${req.method} ${req.url} ${status} ${Date.now() - started}ms`,
        );
      });
  });

  return { server, state };
}
