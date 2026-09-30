import { describe, expect, it } from "vitest";
import { isActiveHref, isAdvancedPath, navTierDefs } from "./nav-items";

const hrefs = (groups: ReturnType<typeof navTierDefs>["simple"]) =>
  groups.flatMap((g) => g.items.map((i) => i.href));

describe("navTierDefs", () => {
  it("keeps every privileged surface out of the simple tier", () => {
    const simple = hrefs(navTierDefs("simple").simple);
    expect(simple).toEqual(["/", "/balance", "/account"]);
  });

  it("lists no route twice across tiers", () => {
    for (const mode of ["simple", "operator"] as const) {
      const tiers = navTierDefs(mode);
      const all = [...hrefs(tiers.simple), ...hrefs(tiers.advanced)];
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("offers the operator overview only where / is not already it", () => {
    expect(hrefs(navTierDefs("simple").advanced)).toContain("/advanced");
    expect(hrefs(navTierDefs("operator").advanced)).not.toContain("/advanced");
  });
});

describe("isActiveHref", () => {
  it("matches / exactly and nested routes by segment", () => {
    expect(isActiveHref("/", "/balance")).toBe(false);
    expect(isActiveHref("/workflows", "/workflows/abc/canvas")).toBe(true);
    // A shared prefix is not a shared segment.
    expect(isActiveHref("/balance", "/balances")).toBe(false);
  });
});

describe("isAdvancedPath", () => {
  const tiers = navTierDefs("simple");

  it("opens the advanced section for an operator route", () => {
    expect(isAdvancedPath("/treasury", tiers)).toBe(true);
    expect(isAdvancedPath("/workflows/abc/canvas", tiers)).toBe(true);
  });

  it("keeps it closed on the simple routes", () => {
    for (const path of ["/", "/balance", "/account"]) {
      expect(isAdvancedPath(path, tiers)).toBe(false);
    }
  });
});
