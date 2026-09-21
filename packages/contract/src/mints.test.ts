import { describe, expect, it } from "vitest";
import { NATIVE_MINT } from "./constants.js";
import {
  isNativeMint,
  knownMint,
  knownMintSymbol,
  USDC_DECIMALS,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  usdcMintFor,
} from "./mints.js";

describe("known mints", () => {
  it("names the two USDC mints and the native sentinel", () => {
    expect(knownMintSymbol(USDC_MINT_DEVNET)).toBe("USDC");
    expect(knownMintSymbol(USDC_MINT_MAINNET)).toBe("USDC");
    expect(knownMintSymbol(NATIVE_MINT)).toBe("SOL");
  });

  it("returns null for a mint it does not ship, rather than guessing", () => {
    expect(knownMintSymbol("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS")).toBeNull();
    expect(knownMint("4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS")).toBeNull();
  });

  it("carries USDC's six decimals", () => {
    expect(knownMint(USDC_MINT_DEVNET)?.decimals).toBe(USDC_DECIMALS);
    expect(USDC_DECIMALS).toBe(6);
  });

  it("keeps the two USDC mints distinct, so an address implies its cluster", () => {
    expect(USDC_MINT_DEVNET).not.toBe(USDC_MINT_MAINNET);
    expect(knownMint(USDC_MINT_DEVNET)?.cluster).toBe("devnet");
    expect(knownMint(USDC_MINT_MAINNET)?.cluster).toBe("mainnet-beta");
  });
});

describe("usdcMintFor", () => {
  it("maps each cluster to Circle's mint", () => {
    expect(usdcMintFor("devnet")).toBe(USDC_MINT_DEVNET);
    expect(usdcMintFor("mainnet-beta")).toBe(USDC_MINT_MAINNET);
  });

  it("has no answer for testnet, where Circle issues nothing", () => {
    expect(usdcMintFor("testnet")).toBeNull();
  });
});

describe("isNativeMint", () => {
  it("only matches the sentinel", () => {
    expect(isNativeMint(NATIVE_MINT)).toBe(true);
    expect(isNativeMint(USDC_MINT_DEVNET)).toBe(false);
  });
});
