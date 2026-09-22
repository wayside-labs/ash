import type { Address } from "@solana/kit";
import { generateKeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { makeTreasury, SYSTEM_PROGRAM } from "./fixtures.js";
import {
  hasRole,
  requireOperatorOrOwner,
  requireOwner,
  requirePauseAuthority,
  walletRoles,
} from "./roles.js";

let owner: Address;
let operator: Address;
let guardian: Address;
let stranger: Address;

beforeAll(async () => {
  const signers = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  [owner, operator, guardian, stranger] = signers.map((s) => s.address) as [
    Address,
    Address,
    Address,
    Address,
  ];
});

function treasuryWithGuardian() {
  return makeTreasury({
    owner,
    operator,
    guardians: [guardian, SYSTEM_PROGRAM, SYSTEM_PROGRAM, SYSTEM_PROGRAM, SYSTEM_PROGRAM],
    guardianCount: 1,
  });
}

describe("walletRoles", () => {
  it("names every role one wallet holds", () => {
    const treasury = makeTreasury({ owner, operator: owner });
    expect(walletRoles(owner, treasury)).toEqual(["owner", "operator"]);
  });

  it("returns nothing for an unrelated wallet", () => {
    expect(walletRoles(stranger, treasuryWithGuardian())).toEqual([]);
  });

  // The unused guardian slots hold `Pubkey::default()`, so a wallet that happens to be the
  // system program must not inherit guardianship from them.
  it("ignores guardian slots past guardianCount", () => {
    const treasury = makeTreasury({
      owner,
      operator,
      guardians: [guardian, SYSTEM_PROGRAM, SYSTEM_PROGRAM, SYSTEM_PROGRAM, SYSTEM_PROGRAM],
      guardianCount: 1,
    });
    expect(walletRoles(SYSTEM_PROGRAM, treasury)).toEqual([]);
    expect(walletRoles(guardian, treasury)).toEqual(["guardian"]);
  });
});

describe("hasRole", () => {
  it("answers per role", () => {
    const treasury = treasuryWithGuardian();
    expect(hasRole(owner, treasury, "owner")).toBe(true);
    expect(hasRole(owner, treasury, "operator")).toBe(false);
    expect(hasRole(guardian, treasury, "guardian")).toBe(true);
  });
});

describe("requireOwner", () => {
  it("admits the owner", () => {
    expect(() => requireOwner(owner, treasuryWithGuardian(), "withdraw")).not.toThrow();
  });

  // Privilege flows downhill only: the operator sets policy under the owner's ceiling and
  // never stands in for the owner.
  it("rejects the operator", () => {
    expect(() => requireOwner(operator, treasuryWithGuardian(), "withdraw")).toThrow(
      /Only the treasury owner/,
    );
  });

  it("rejects a guardian", () => {
    expect(() => requireOwner(guardian, treasuryWithGuardian(), "withdraw")).toThrow();
  });
});

describe("requireOperatorOrOwner", () => {
  it("admits both the owner and the operator", () => {
    const treasury = treasuryWithGuardian();
    expect(() => requireOperatorOrOwner(owner, treasury, "set policy")).not.toThrow();
    expect(() => requireOperatorOrOwner(operator, treasury, "set policy")).not.toThrow();
  });

  it("rejects a guardian and a stranger", () => {
    const treasury = treasuryWithGuardian();
    expect(() => requireOperatorOrOwner(guardian, treasury, "set policy")).toThrow(
      /owner or operator/,
    );
    expect(() => requireOperatorOrOwner(stranger, treasury, "set policy")).toThrow();
  });
});

describe("requirePauseAuthority", () => {
  it("admits the owner and a guardian", () => {
    const treasury = treasuryWithGuardian();
    expect(() => requirePauseAuthority(owner, treasury)).not.toThrow();
    expect(() => requirePauseAuthority(guardian, treasury)).not.toThrow();
  });

  // Pause is a kill switch, and the operator is the role the switch exists to stop.
  it("rejects the operator", () => {
    expect(() => requirePauseAuthority(operator, treasuryWithGuardian())).toThrow(
      /owner or a guardian/,
    );
  });
});
