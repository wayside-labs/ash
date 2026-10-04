import { describe, expect, it } from "vitest";
import { checkRunPolicy, parseAllowedWallets } from "./policy.js";
import { addr, FUNDER, proposalOf } from "./test-support.js";

const ALLOWED = [FUNDER];

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

describe("checkRunPolicy", () => {
  const proposal = proposalOf();

  it("lets an allowed wallet run on an install that turned mainnet on", () => {
    expect(
      checkRunPolicy(proposal, { funder: FUNDER, mainnetEnabled: true, allowedWallets: ALLOWED }),
    ).toEqual({ ok: true });
  });

  it("refuses everything while mainnet is off", () => {
    const result = checkRunPolicy(proposal, {
      funder: FUNDER,
      mainnetEnabled: false,
      allowedWallets: ALLOWED,
    });
    expect(result).toMatchObject({ ok: false, code: "mainnet_disabled" });
  });

  it("needs a connected wallet", () => {
    expect(
      checkRunPolicy(proposal, { funder: null, mainnetEnabled: true, allowedWallets: ALLOWED }),
    ).toMatchObject({ ok: false, code: "wallet_missing" });
  });

  it("fails closed: an empty list allows nobody", () => {
    expect(
      checkRunPolicy(proposal, { funder: FUNDER, mainnetEnabled: true, allowedWallets: [] }),
    ).toMatchObject({ ok: false, code: "wallet_not_allowed" });
  });

  it("refuses a wallet that is not on the list", () => {
    expect(
      checkRunPolicy(proposal, {
        funder: addr(5),
        mainnetEnabled: true,
        allowedWallets: ALLOWED,
      }),
    ).toMatchObject({ ok: false, code: "wallet_not_allowed" });
  });

  it("refuses a payout to the funder: it would re-create the link the template hides", () => {
    const self = proposalOf([{ address: FUNDER, deliver: "SOL" }]);
    expect(
      checkRunPolicy(self, { funder: FUNDER, mainnetEnabled: true, allowedWallets: ALLOWED }),
    ).toMatchObject({ ok: false, code: "payee_invalid" });
  });

  describe("a ZEC payout must leave Cloak's swap floor after the exit fee", () => {
    const run = (amountSol: string) =>
      checkRunPolicy(proposalOf([{ deliver: "ZEC", amountSol }]), {
        funder: FUNDER,
        mainnetEnabled: true,
        allowedWallets: ALLOWED,
      });

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
      const sol = proposalOf([{ deliver: "SOL", amountSol: "0.01" }]);
      expect(
        checkRunPolicy(sol, { funder: FUNDER, mainnetEnabled: true, allowedWallets: ALLOWED }),
      ).toEqual({ ok: true });
    });

    it("checks every ZEC payee, not only the first", () => {
      const mixed = proposalOf([
        { deliver: "ZEC", amountSol: "0.02" },
        { deliver: "ZEC", amountSol: "0.012", address: addr(3) },
      ]);
      expect(
        checkRunPolicy(mixed, { funder: FUNDER, mainnetEnabled: true, allowedWallets: ALLOWED }),
      ).toMatchObject({ ok: false, code: "below_minimum" });
    });
  });

  it("checks the switch before the wallet, so a disabled install reveals nothing about the list", () => {
    const result = checkRunPolicy(proposal, {
      funder: addr(5),
      mainnetEnabled: false,
      allowedWallets: ALLOWED,
    });
    expect(result).toMatchObject({ ok: false, code: "mainnet_disabled" });
  });
});
