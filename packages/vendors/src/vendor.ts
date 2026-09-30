import type { IncomingMessage } from "node:http";
import type { VendorConfig, VendorId } from "./config.js";
import type { JsonFile } from "./store.js";

export type Invoice = {
  id: string;
  vendor: VendorId;
  createdAt: number;
  /** Pay before this. A payment that lands later is still honoured: the money moved. */
  expiresAt: number;
  units: number;
  /** Base units, as a string — JSON has no bigint. */
  amount: string;
  amountHuman: string;
  mint: string;
  mintSymbol: string;
  payTo: string;
  destinationLabel: string;
  /** Pinned at creation when the buyer names itself, so nobody else can redeem it. */
  payerSession: string | null;
  request: unknown;
  redeemed: {
    session: string;
    intentId: string;
    receipt: string;
    redeemedAt: number;
    delivery: unknown;
  } | null;
};

export type VendorState<S> = {
  invoices: Record<string, Invoice>;
  vendor: S;
};

export type HttpResult = { status: number; body: unknown };

export type QuoteResult =
  | { kind: "invoice"; units: number; request: unknown }
  /** Nothing to sell: the answer already exists and is given away (e.g. a notarised hash). */
  | { kind: "free"; body: unknown }
  | { kind: "error"; status: number; message: string };

export type Route<S> = {
  method: "GET" | "POST";
  /** Exact path, or a prefix ending in `/` whose remainder is passed as `param`. */
  path: string;
  handle: (input: {
    param: string;
    body: unknown;
    req: IncomingMessage;
    state: JsonFile<VendorState<S>>;
    config: VendorConfig;
  }) => Promise<HttpResult> | HttpResult;
};

export type VendorModule<S> = {
  id: VendorId;
  title: string;
  /** What one unit buys, for the catalog: "price quote per symbol", "notarised document". */
  unit: string;
  describe: (config: VendorConfig) => Record<string, unknown>;
  emptyState: () => S;
  quote: (body: unknown, state: S, config: VendorConfig) => QuoteResult | Promise<QuoteResult>;
  deliver: (
    invoice: Invoice,
    payment: { session: string; receipt: string; intentId: string },
    state: S,
    config: VendorConfig,
  ) => Promise<unknown>;
  routes?: Route<S>[];
};

/**
 * Thrown by `deliver` when the thing sold cannot be produced right now. The invoice stays
 * open and paid, and the buyer's redeem answers 503 — redeem is idempotent, so a retry once
 * the upstream is back delivers the real thing. Never a substitute for what was bought.
 */
export class DeliveryUnavailable extends Error {}
