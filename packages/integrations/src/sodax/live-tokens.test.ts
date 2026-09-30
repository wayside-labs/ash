import type { XToken } from "@sodax/sdk";
import { describe, expect, it } from "vitest";
import { liveTokenOverrides } from "./live-tokens.js";

const token = (symbol: string, address: string, extra: Partial<XToken> = {}) =>
  ({ symbol, name: symbol, decimals: 6, address, chainKey: "solana", ...extra }) as XToken;

const SOL = token("SOL", "11111111111111111111111111111111", { hubAsset: "0xsol", vault: "0xv1" });
const PUMP = token("PUMP", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", {
  hubAsset: "0x02722baa016f5369c91b6533330315ec884458a4",
  vault: "0x02722baa016f5369c91b6533330315ec884458a4",
});

describe("liveTokenOverrides", () => {
  it("adds tokens listed since the SDK release and counts them", () => {
    const out = liveTokenOverrides(
      { solana: { supportedTokens: { SOL } } },
      { solana: [SOL, PUMP] },
    );
    expect(Object.keys(out.chains.solana?.supportedTokens ?? {})).toEqual(["SOL", "PUMP"]);
    expect(out.swapTokens.solana).toHaveLength(2);
    expect(out.added).toBe(1);
  });

  it("skips live entries the SDK cannot route (no hub asset or vault)", () => {
    const bare = token("NEW", "newMint111111111111111111111111111111111111");
    const out = liveTokenOverrides(
      { solana: { supportedTokens: { SOL } } },
      { solana: [SOL, bare] },
    );
    expect(out.chains.solana?.supportedTokens.NEW).toBeUndefined();
    expect(out.added).toBe(0);
  });

  it("leaves chains the packaged config does not know alone", () => {
    const out = liveTokenOverrides({ solana: { supportedTokens: { SOL } } }, { newchain: [PUMP] });
    expect(out.chains).toEqual({});
  });

  it("keeps packaged-only tokens when the live list omits them", () => {
    const out = liveTokenOverrides(
      { solana: { supportedTokens: { SOL, PUMP } } },
      { solana: [SOL] },
    );
    expect(out.chains.solana?.supportedTokens.PUMP).toBeDefined();
  });
});
