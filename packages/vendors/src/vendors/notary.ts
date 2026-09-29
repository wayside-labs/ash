import { z } from "zod";
import { newId, nowSeconds } from "../store.js";
import type { VendorModule } from "../vendor.js";

export type Certificate = {
  certificate_id: string;
  sha256: string;
  label: string;
  notarized_at: string;
  payer_session: string;
  /** The `IntentReceipt` that paid for it: anyone can check it on an explorer. */
  receipt: string;
  intent_id: string;
  invoice_id: string;
};

type NotaryState = { certificates: Record<string, Certificate> };

const sha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .transform((s) => s.toLowerCase());

const requestSchema = z.object({
  sha256: sha256Schema,
  label: z.string().max(80).default(""),
  session: z.string().optional(),
});

/**
 * A document hash timestamp service. Only the hash crosses the wire — the vendor never sees
 * the document — and a hash that is already notarised is answered for free instead of being
 * sold twice, which is the dedupe a skill should teach an agent to lean on.
 */
export const notary: VendorModule<NotaryState> = {
  id: "notary",
  title: "Rails Notary — timestamp a document hash",
  unit: "one notarised document hash",
  describe: () => ({ lookup: "GET /certificates/{sha256} is free" }),
  emptyState: () => ({ certificates: {} }),
  quote: (body, state) => {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return { kind: "error", status: 422, message: "expected {sha256: <64 hex>, label?}" };
    }
    const existing = state.certificates[parsed.data.sha256];
    if (existing) return { kind: "free", body: { already_notarized: true, certificate: existing } };
    return {
      kind: "invoice",
      units: 1,
      request: { sha256: parsed.data.sha256, label: parsed.data.label },
    };
  },
  deliver: async (invoice, payment, state) => {
    const { sha256, label } = invoice.request as { sha256: string; label: string };
    // Two invoices for one hash can both be paid; the second still gets the first
    // certificate, because a timestamp that moved later would be worth less, not more.
    const existing = state.certificates[sha256];
    if (existing) return { already_notarized: true, certificate: existing };
    const certificate: Certificate = {
      certificate_id: newId("cert"),
      sha256,
      label,
      notarized_at: new Date(nowSeconds() * 1000).toISOString(),
      payer_session: payment.session,
      receipt: payment.receipt,
      intent_id: payment.intentId,
      invoice_id: invoice.id,
    };
    state.certificates[sha256] = certificate;
    return { certificate };
  },
  routes: [
    {
      method: "GET",
      path: "/certificates/",
      handle: ({ param, state }) => {
        const hash = sha256Schema.safeParse(param);
        if (!hash.success) return { status: 422, body: { error: "expected a sha256 hex digest" } };
        const certificate = state.data.vendor.certificates[hash.data];
        return certificate
          ? { status: 200, body: { certificate } }
          : { status: 404, body: { error: "not notarised" } };
      },
    },
  ],
};
