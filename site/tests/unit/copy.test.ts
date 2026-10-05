import { describe, it, expect } from "vitest";
import { en } from "../../src/content/copy.en";
import { pt } from "../../src/content/copy.pt";

function keys(o: unknown, p = ""): string[] {
  if (Array.isArray(o)) return o.flatMap((v, i) => keys(v, `${p}[${i}]`));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k));
  return [p];
}
function leaves(o: unknown): unknown[] {
  if (Array.isArray(o)) return o.flatMap(leaves);
  if (o && typeof o === "object") return Object.values(o).flatMap(leaves);
  return [o];
}

describe("copy", () => {
  it("pt has exactly the keys en has", () => {
    expect(keys(pt).sort()).toEqual(keys(en).sort());
  });
  it("no empty strings in either language (stat suffixes may be empty)", () => {
    for (const d of [en, pt]) {
      const ks = keys(d);
      const vs = leaves(d);
      ks.forEach((k, i) => {
        const v = vs[i];
        if (typeof v === "string" && !k.endsWith(".s")) expect(v.trim(), k).not.toBe("");
      });
    }
  });
  it("never publishes a price or the word non-custodial", () => {
    for (const d of [en, pt])
      for (const v of leaves(d))
        if (typeof v === "string") expect(v).not.toMatch(/\$\s?\d|R\$\s?\d|non-custodial|não custodial/i);
  });
});
