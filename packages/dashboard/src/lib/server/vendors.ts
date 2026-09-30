import { z } from "zod";
import { addressSchema } from "@/lib/schema";

/**
 * The demo vendors the VPS serves (`deploy/vps/README.md`, `packages/vendors`). A fixed
 * list rather than a URL field: this is a server-side fetch, and a user-supplied host would
 * make the route a way to reach anything the server can.
 */
export const VENDOR_CATALOG_URLS = [
  "https://vendor-oracle.ash.app.br/catalog",
  "https://vendor-notary.ash.app.br/catalog",
  "https://vendor-compute.ash.app.br/catalog",
] as const;

const FETCH_TIMEOUT_MS = 4_000;

/** The subset of `packages/vendors/src/server.ts`'s `catalog()` the wizard needs. */
const catalogSchema = z.object({
  vendor: z.string().min(1),
  title: z.string().min(1),
  payment: z.object({
    destination_label: z.string().min(1).max(32),
    destination_owner: addressSchema,
    mint_ref: z.string().optional(),
  }),
});

export type VendorPreset = {
  vendor: string;
  title: string;
  label: string;
  owner: string;
  /** What the vendor charges in, for the wizard to say so — a SOL-only vault cannot pay USDC. */
  mintRef: string | null;
};

/**
 * Every catalog that answers in time and parses. A vendor that is down, slow, or returns
 * something else is left out rather than failing the list: the preset is a convenience,
 * and the wizard always offers the manual fields.
 */
export async function fetchVendorPresets(fetchImpl: typeof fetch = fetch): Promise<VendorPreset[]> {
  const settled = await Promise.all(
    VENDOR_CATALOG_URLS.map(async (url): Promise<VendorPreset | null> => {
      try {
        const res = await fetchImpl(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return null;
        const parsed = catalogSchema.safeParse(await res.json());
        if (!parsed.success) return null;
        return {
          vendor: parsed.data.vendor,
          title: parsed.data.title,
          label: parsed.data.payment.destination_label,
          owner: parsed.data.payment.destination_owner,
          mintRef: parsed.data.payment.mint_ref ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((preset): preset is VendorPreset => preset !== null);
}
