import { describe, it, expect } from "vitest";
import { pitchEn } from "../../src/content/pitch.en";
import { pitchPt } from "../../src/content/pitch.pt";
import { total } from "../../src/lib/deck-model";

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

describe("pitch", () => {
  it("pt has exactly the keys en has", () => {
    expect(keys(pitchPt).sort()).toEqual(keys(pitchEn).sort());
  });
  it("has eighteen slides that read aloud in three minutes, identical in both languages", () => {
    for (const p of [pitchEn, pitchPt]) {
      expect(p.slides).toHaveLength(18);
      expect(total(p.slides.map((s) => s.dur))).toBe(180);
    }
    expect(pitchPt.slides.map((s) => [s.id, s.kind, s.dur])).toEqual(pitchEn.slides.map((s) => [s.id, s.kind, s.dur]));
  });
  it("never ships an empty string, a price, a TODO or non-custodial", () => {
    for (const p of [pitchEn, pitchPt])
      for (const v of leaves(p))
        if (typeof v === "string") {
          expect(v.trim()).not.toBe("");
          expect(v).not.toMatch(/\$\s?\d|R\$\s?\d|non-custodial|não custodial/i);
          // Case-sensitive: the marker is always upper-case, and Portuguese "todo" is a real word.
          expect(v).not.toMatch(/TODO/);
        }
  });
  it("personalizes with a {name} slot where the welcome needs one", () => {
    for (const p of [pitchEn, pitchPt]) {
      expect(p.welcome.hi).toContain("{name}");
      expect(p.welcome.back).toContain("{name}");
      expect(p.welcome.treasury).toContain("{name}");
    }
  });
});
