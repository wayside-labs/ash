import { describe, expect, it } from "vitest";
import { checkRunPolicy, parseAllowedWallets, parseContacts } from "./policy.js";
import { addr, FUNDER, proposalOf } from "./test-support.js";

const ALLOWED = [FUNDER];
const CONTACTS = new Map([
  ["Payee 1", addr(1)],
  ["Payee 2", addr(2)],
  ["Supplier A", addr(3)],
]);

describe("parseAllowedWallets", () => {
  it("reads commas, spaces and newlines", () => {
    expect(parseAllowedWallets(`${addr(1)}, ${addr(2)}\n${addr(3)}  ${addr(4)}`)).toEqual([
      addr(1),
      addr(2),
      addr(3),
      addr(4),
    ]);
  });

  it("drops anything that is not an address, so a typo shrinks the list", () => {
    expect(parseAllowedWallets(`${addr(1)},not-an-address,${addr(2).slice(0, 10)}`)).toEqual([
      addr(1),
    ]);
  });

  it("is empty for nothing at all", () => {
    for (const raw of [undefined, "", "   ", ",,,"]) expect(parseAllowedWallets(raw)).toEqual([]);
  });
});

describe("parseContacts", () => {
  it("reads a JSON object of label to address", () => {
    const raw = JSON.stringify({ "Supplier A": addr(1), "Contributor B": addr(2) });
    expect(parseContacts(raw)).toEqual(
      new Map([
        ["Supplier A", addr(1)],
        ["Contributor B", addr(2)],
      ]),
    );
  });

  it("drops an entry that is not a valid label or address, and keeps the rest", () => {
    const raw = JSON.stringify({
      "Supplier A": addr(1),
      "Bad (label)": addr(2),
      "Short address": addr(3).slice(0, 10),
      "Not text": 42,
    });
    expect([...parseContacts(raw).keys()]).toEqual(["Supplier A"]);
  });

  it("is empty for anything that is not a JSON object", () => {
    for (const raw of [undefined, "", "not json", "[]", "null", `"${addr(1)}"`]) {
      expect(parseContacts(raw).size, String(raw)).toBe(0);
    }
  });
});

describe("checkRunPolicy", () => {
  const proposal = proposalOf([
    { label: "Payee 1", address: addr(1), deliver: "SOL" },
    { label: "Payee 2", address: addr(2), deliver: "ZEC" },
  ]);
  const ctx = { funder: FUNDER, mainnetEnabled: true, allowedWallets: ALLOWED, contacts: CONTACTS };

  it("lets an allowed wallet run on an install that turned mainnet on", () => {
    expect(checkRunPolicy(proposal, ctx)).toEqual({ ok: true });
  });

  it("refuses everything while mainnet is off", () => {
    expect(checkRunPolicy(proposal, { ...ctx, mainnetEnabled: false })).toMatchObject({
      ok: false,
      code: "mainnet_disabled",
    });
  });

  it("needs a connected wallet", () => {
    expect(checkRunPolicy(proposal, { ...ctx, funder: null })).toMatchObject({
      ok: false,
      code: "wallet_missing",
    });
  });

  it("fails closed: an empty wallet list allows nobody", () => {
    expect(checkRunPolicy(proposal, { ...ctx, allowedWallets: [] })).toMatchObject({
      ok: false,
      code: "wallet_not_allowed",
    });
  });

  it("refuses a wallet that is not on the list", () => {
    expect(checkRunPolicy(proposal, { ...ctx, funder: addr(5) })).toMatchObject({
      ok: false,
      code: "wallet_not_allowed",
    });
  });

  it("refuses a payout to the funder: it would re-create the link the template hides", () => {
    const self = proposalOf([{ label: "Payee 1", address: FUNDER, deliver: "SOL" }]);
    expect(
      checkRunPolicy(self, { ...ctx, contacts: new Map([["Payee 1", FUNDER]]) }),
    ).toMatchObject({ ok: false, code: "payee_invalid" });
  });

  describe("payees come from the operator's contacts only", () => {
    it("refuses a label that is not on the list", () => {
      const unknown = proposalOf([{ label: "Stranger", address: addr(1), deliver: "SOL" }]);
      expect(checkRunPolicy(unknown, ctx)).toMatchObject({ ok: false, code: "payee_invalid" });
    });

    it("refuses a known label paired with an address that is not its contact", () => {
      const swapped = proposalOf([{ label: "Supplier A", address: addr(9), deliver: "SOL" }]);
      expect(checkRunPolicy(swapped, ctx)).toMatchObject({ ok: false, code: "payee_invalid" });
    });

    it("refuses every payee when the contact list is empty", () => {
      expect(checkRunPolicy(proposal, { ...ctx, contacts: new Map() })).toMatchObject({
        ok: false,
        code: "payee_invalid",
      });
    });
  });

  describe("a ZEC payout must leave Cloak's swap floor after the exit fee", () => {
    const run = (amountSol: string) =>
      checkRunPolicy(
        proposalOf([{ label: "Payee 2", address: addr(2), deliver: "ZEC", amountSol }]),
        {
          ...ctx,
          contacts: CONTACTS,
        },
      );

    it("turns away a swap that would be refused after the deposit moved", () => {
      // 0.015 SOL less the 0.005 + 0.3% fee leaves 0.009955: under the 0.01 floor.
      expect(run("0.015")).toMatchObject({ ok: false, code: "below_minimum" });
      expect(run("0.01")).toMatchObject({ ok: false, code: "below_minimum" });
    });

    it("lets one through that clears it, up to the template's own cap", () => {
      expect(run("0.016")).toEqual({ ok: true });
      expect(run("0.02")).toEqual({ ok: true });
      expect(run("0.05")).toEqual({ ok: true });
    });

    it("does not hold a SOL payout to it: a withdrawal only has to exceed its fee", () => {
      const sol = proposalOf([{ label: "Payee 1", deliver: "SOL", amountSol: "0.01" }]);
      expect(checkRunPolicy(sol, ctx)).toEqual({ ok: true });
    });

    it("checks every ZEC payee, not only the first", () => {
      const mixed = proposalOf([
        { label: "Payee 1", address: addr(1), deliver: "ZEC", amountSol: "0.02" },
        { label: "Supplier A", address: addr(3), deliver: "ZEC", amountSol: "0.012" },
      ]);
      expect(checkRunPolicy(mixed, ctx)).toMatchObject({ ok: false, code: "below_minimum" });
    });
  });

  it("checks the switch before the wallet, so a disabled install reveals nothing about the list", () => {
    expect(
      checkRunPolicy(proposal, { ...ctx, funder: addr(5), mainnetEnabled: false }),
    ).toMatchObject({ ok: false, code: "mainnet_disabled" });
  });
});
