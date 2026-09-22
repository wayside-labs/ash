import { describe, expect, it } from "vitest";
import {
  buildDeFiIntentProposal,
  DEFI_REASON_CODES,
  detectBlockedPatterns,
  findProtocolInText,
  formatDeFiCatalogForPrompt,
  listDeFiProtocols,
  parseDeFiIntentRequest,
  preflightDeFiIntent,
} from "./defi-intents.js";

describe("Solana DeFi catalog", () => {
  it("ships the major ecosystem protocols", () => {
    const names = listDeFiProtocols().map((p) => p.id);
    expect(names).toEqual(
      expect.arrayContaining([
        "jupiter",
        "meteora",
        "kamino",
        "marginfi",
        "raydium",
        "orca",
        "drift",
        "phoenix",
        "marinade",
        "jito",
        "sanctum",
      ]),
    );
  });

  it("formats a prompt-safe catalog without APY numbers", () => {
    const text = formatDeFiCatalogForPrompt();
    expect(text).toContain("Jupiter");
    expect(text).toContain("Guaranteed yield");
    expect(text).not.toMatch(/\d+\.\d+%/);
  });
});

describe("parseDeFiIntentRequest", () => {
  it("detects Kamino lend intent with USDC", () => {
    const parsed = parseDeFiIntentRequest("Check Kamino USDC yield and deposit $5000 if APY > 8%");
    expect(parsed.protocol?.id).toBe("kamino");
    expect(parsed.kind).toBe("lend");
    expect(parsed.assetSymbol).toBe("USDC");
    expect(parsed.apyThresholdPct).toBe(8);
  });

  it("detects Jupiter swap", () => {
    const parsed = parseDeFiIntentRequest("Swap 2 SOL to USDC on Jupiter");
    expect(parsed.protocol?.id).toBe("jupiter");
    expect(parsed.kind).toBe("swap");
  });

  it("finds protocol aliases case-insensitively", () => {
    expect(findProtocolInText("Use jup.ag for routing")?.id).toBe("jupiter");
    expect(findProtocolInText("DLMM on meteora")?.id).toBe("meteora");
  });
});

describe("blocked patterns", () => {
  it("flags guaranteed yield and 50% in 48h", () => {
    const text = "Make 50% profit in 48h guaranteed risk-free";
    const blocks = detectBlockedPatterns(text);
    expect(blocks.some((b) => b.code === DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST)).toBe(true);
    const proposal = buildDeFiIntentProposal(text);
    expect(proposal.autonomousExecutionAllowed).toBe(false);
  });

  it("blocks autonomous execution when treasury paused", () => {
    const parsed = parseDeFiIntentRequest("Deposit USDC on Kamino");
    const checks = preflightDeFiIntent(parsed, {
      paused: true,
      mintBalances: {},
      perTxMaxByMint: {},
      allowlistLabels: [],
      activeSessions: 0,
    });
    expect(checks.some((c) => c.code === DEFI_REASON_CODES.TREASURY_PAUSED)).toBe(true);
  });

  it("quarantines high-risk Drift perps", () => {
    const proposal = buildDeFiIntentProposal("Open a 5x long on Drift perp");
    expect(proposal.quarantineRecommended).toBe(true);
    expect(proposal.parsed.protocol?.id).toBe("drift");
  });
});
