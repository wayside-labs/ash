import { describe, expect, it } from "vitest";
import { readSodaxConfig } from "./config.js";
import { checkDestination, parseAllowlist } from "./policy.js";
import { parseIntent, toJsonSafe } from "./serialize.js";

const DESK_SOL = { chainKey: "solana", address: "AnCCJjheynmGqPp6Vgat9DTirGKD4CtQzP8cwTYV8qKH" };
const ARB = "0xa4b1.arbitrum";

describe("destination policy", () => {
  it("allows returning funds to the signing desk on its own chain with an empty allowlist", () => {
    expect(checkDestination([], DESK_SOL, DESK_SOL)).toEqual({ ok: true });
  });

  it("refuses an unlisted cross-chain recipient", () => {
    const res = checkDestination([], DESK_SOL, { chainKey: ARB, address: "0xabc" });
    expect(res.ok).toBe(false);
  });

  it("does not treat the same address on another chain as the desk", () => {
    const evm = { chainKey: "0x2105.base", address: "0x000000000000000000000000000000000000dEaD" };
    expect(checkDestination([], evm, { ...evm, chainKey: ARB }).ok).toBe(false);
  });

  it("matches EVM addresses case-insensitively but only on the listed chain", () => {
    const allow = parseAllowlist(`${ARB}:0x000000000000000000000000000000000000dEaD`);
    const lower = { chainKey: ARB, address: "0x000000000000000000000000000000000000dead" };
    expect(checkDestination(allow, DESK_SOL, lower)).toEqual({ ok: true });
    expect(checkDestination(allow, DESK_SOL, { ...lower, chainKey: "0x2105.base" }).ok).toBe(false);
  });

  it("keeps base58 addresses case-sensitive", () => {
    const allow = parseAllowlist(`solana:${DESK_SOL.address}`);
    const other = { chainKey: "sui", address: "0x1" };
    expect(checkDestination(allow, other, DESK_SOL)).toEqual({ ok: true });
    expect(
      checkDestination(allow, other, {
        chainKey: "solana",
        address: DESK_SOL.address.toLowerCase(),
      }).ok,
    ).toBe(false);
  });

  it("rejects malformed allowlist entries instead of ignoring them", () => {
    expect(() => parseAllowlist("0xabc")).toThrow(/chainKey/);
    expect(() => parseAllowlist("solana:")).toThrow();
  });
});

describe("readSodaxConfig", () => {
  it("defaults to no key, no fee and an empty allowlist", () => {
    expect(readSodaxConfig({})).toEqual({ allowlist: [] });
  });

  it("requires the partner fee address and bps together, within 0.01%–10%", () => {
    expect(() => readSodaxConfig({ SODAX_PARTNER_FEE_BPS: "10" })).toThrow(/together/);
    const address = "0x000000000000000000000000000000000000dEaD";
    expect(() =>
      readSodaxConfig({ SODAX_PARTNER_FEE_ADDRESS: address, SODAX_PARTNER_FEE_BPS: "5000" }),
    ).toThrow(/1 to 1000/);
    expect(
      readSodaxConfig({ SODAX_PARTNER_FEE_ADDRESS: address, SODAX_PARTNER_FEE_BPS: "25" })
        .partnerFee,
    ).toEqual({ address, percentage: 25 });
  });

  it("refuses a non-EVM fee receiver, since fees accrue on the Sonic hub", () => {
    expect(() =>
      readSodaxConfig({
        SODAX_PARTNER_FEE_ADDRESS: DESK_SOL.address,
        SODAX_PARTNER_FEE_BPS: "10",
      }),
    ).toThrow(/Sonic/);
  });
});

describe("intent serialization", () => {
  it("round-trips an intent through JSON with bigints restored", () => {
    const intent = {
      intentId: 7n,
      creator: "0xabc",
      inputAmount: 100_000_000n,
      minOutputAmount: 11_000_000n,
      deadline: 1_786_500_000n,
      allowPartialFill: false,
      srcChain: 1n,
      dstChain: 23n,
      srcAddress: "0x01",
      dstAddress: "0x02",
      solver: "0x0000000000000000000000000000000000000000",
      data: "0x",
    };
    const wire = JSON.parse(JSON.stringify(toJsonSafe(intent)));
    expect(wire.inputAmount).toBe("100000000");
    expect(parseIntent(wire)).toEqual(intent);
  });
});
