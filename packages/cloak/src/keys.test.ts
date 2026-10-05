import { describe, expect, it } from "vitest";
import { RunError } from "./errors.js";
import {
  deriveMasterSeed,
  KEY_DERIVATION_DOMAIN,
  keyDerivationMessage,
  obtainMasterSeed,
} from "./keys.js";
import { addr, FUNDER } from "./test-support.js";
import { createFakeWallet } from "./testing.js";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("keyDerivationMessage", () => {
  it("names the wallet and says what the signature is worth", () => {
    const message = text(keyDerivationMessage(FUNDER));
    expect(message).toContain(`Wallet: ${FUNDER}`);
    expect(message).toContain("does NOT authorize a transaction");
    expect(message).toContain("anyone who gets this signature can spend those notes");
  });

  it("differs per wallet, so one wallet's signature is not another's seed", () => {
    expect(text(keyDerivationMessage(addr(1)))).not.toBe(text(keyDerivationMessage(addr(2))));
  });

  it("is stable: changing it would strand every earlier deposit", () => {
    expect(text(keyDerivationMessage("W")).split("\n")).toEqual([
      "ASH x Cloak: private payout keys (v1)",
      "",
      "Signing derives the keys that control your private payout notes, here and on any device with this wallet.",
      "It does NOT authorize a transaction or move funds.",
      "Only sign this on a site you trust: anyone who gets this signature can spend those notes.",
      "",
      "Wallet: W",
    ]);
    expect(KEY_DERIVATION_DOMAIN).toBe("ash/cloak-private-payout/v1");
  });
});

describe("deriveMasterSeed", () => {
  const signature = (fill: number) => new Uint8Array(64).fill(fill);

  it("is 32 bytes and deterministic", () => {
    const a = deriveMasterSeed(signature(7));
    const b = deriveMasterSeed(signature(7));
    expect(a).toHaveLength(32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("changes with the signature", () => {
    expect(Array.from(deriveMasterSeed(signature(1)))).not.toEqual(
      Array.from(deriveMasterSeed(signature(2))),
    );
  });

  it("is not the signature itself, nor a prefix of it", () => {
    const sig = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
    const seed = deriveMasterSeed(sig);
    expect(Array.from(seed)).not.toEqual(Array.from(sig.slice(0, 32)));
    expect(Array.from(seed)).not.toEqual(Array.from(sig.slice(32)));
  });

  it("refuses anything that is not a 64-byte signature", () => {
    for (const length of [0, 32, 63, 65, 128]) {
      expect(() => deriveMasterSeed(new Uint8Array(length))).toThrow(RunError);
    }
  });
});

describe("obtainMasterSeed", () => {
  it("asks once when the keys were checked before", async () => {
    const wallet = createFakeWallet({ address: FUNDER });
    const seed = await obtainMasterSeed(wallet, { verifyDeterminism: false });
    expect(seed).toHaveLength(32);
    expect(wallet.prompts()).toBe(1);
  });

  it("asks twice the first time, and the seed is the same either way", async () => {
    const first = createFakeWallet({ address: FUNDER });
    const checked = await obtainMasterSeed(first, { verifyDeterminism: true });
    expect(first.prompts()).toBe(2);
    const second = createFakeWallet({ address: FUNDER });
    const unchecked = await obtainMasterSeed(second, { verifyDeterminism: false });
    expect(Array.from(checked)).toEqual(Array.from(unchecked));
  });

  it("refuses a wallet that signs differently each time, before any funds move", async () => {
    const wallet = createFakeWallet({ address: FUNDER, mode: "random" });
    await expect(obtainMasterSeed(wallet, { verifyDeterminism: true })).rejects.toMatchObject({
      code: "keys_not_deterministic",
    });
  });

  it("lets a wallet's own rejection through untouched", async () => {
    const wallet = createFakeWallet({ address: FUNDER, mode: "reject" });
    await expect(obtainMasterSeed(wallet, { verifyDeterminism: true })).rejects.toMatchObject({
      code: 4001,
    });
  });
});
