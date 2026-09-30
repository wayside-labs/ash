import { describe, expect, it } from "vitest";
import { fetchVendorPresets, VENDOR_CATALOG_URLS } from "@/lib/server/vendors";

const OWNER = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";

/** The shape `packages/vendors/src/server.ts` serves at `/catalog`, trimmed. */
const catalog = (vendor: string) => ({
  vendor,
  title: `${vendor} title`,
  unit: "query",
  payment: {
    destination_label: vendor,
    destination_owner: OWNER,
    mint_ref: "USDC",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
});

describe("fetchVendorPresets", () => {
  it("keeps the catalogs that answer and drops the rest", async () => {
    const [oracle, notary] = VENDOR_CATALOG_URLS;
    const fake = (async (url: string) => {
      if (url === oracle) return Response.json(catalog("oracle"));
      if (url === notary) return new Response("down", { status: 502 });
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    await expect(fetchVendorPresets(fake)).resolves.toEqual([
      { vendor: "oracle", title: "oracle title", label: "oracle", owner: OWNER, mintRef: "USDC" },
    ]);
  });

  it("drops a catalog whose destination is not an address", async () => {
    const fake = (async () =>
      Response.json({
        ...catalog("oracle"),
        payment: { destination_label: "x", destination_owner: "not-an-address" },
      })) as unknown as typeof fetch;
    await expect(fetchVendorPresets(fake)).resolves.toEqual([]);
  });
});
