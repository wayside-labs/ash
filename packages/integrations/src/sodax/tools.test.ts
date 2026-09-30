import type { Sodax } from "@sodax/sdk";
import { describe, expect, it, vi } from "vitest";
import { parseAllowlist } from "./policy.js";
import { createSodaxTools, ToolError } from "./tools.js";

const DESK = "AnCCJjheynmGqPp6Vgat9DTirGKD4CtQzP8cwTYV8qKH";
const ARB = "0xa4b1.arbitrum";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

function fakeSodax() {
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
  return {
    config: { getSupportedSpokeChains: () => ["solana", ARB, "sonic"] },
    leverageYield: { listVaults: () => [{ name: "lsodaJITOSOL", vault: "0xvault" }] },
    swaps: {
      getQuote: vi.fn(() => ok({ quoted_amount: 1_000_000n })),
      getSwapDeadline: vi.fn(() => ok(1_786_500_000n)),
      isAllowanceValid: vi.fn(() => ok(true)),
      buildApproveTxs: vi.fn(),
      createIntent: vi.fn(() =>
        ok({
          tx: { data: "base64tx" },
          intent: { intentId: 1n },
          relayData: { address: "0x1", payload: "0x2" },
        }),
      ),
    },
    api: {
      swaps: { submitTx: vi.fn(() => ok({ success: true, data: { status: "inserted" } })) },
      bridge: { submitTx: vi.fn(() => ok({ success: true })) },
    },
  };
}

function tool(sodax: ReturnType<typeof fakeSodax>, name: string, allowlist = "") {
  const found = createSodaxTools(sodax as unknown as Sodax, {
    allowlist: parseAllowlist(allowlist),
  }).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

const swapInput = {
  src_chain_key: "solana",
  src_address: DESK,
  src_token: "11111111111111111111111111111111",
  amount: "100000000",
  dst_chain_key: ARB,
  dst_token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  dst_address: RECIPIENT,
};

describe("sodax tools", () => {
  it("refuses an unlisted recipient before touching the SDK", async () => {
    const sodax = fakeSodax();
    await expect(tool(sodax, "sodax_build_swap").handler(swapInput)).rejects.toThrow(
      /SODAX_ALLOWED_DESTINATIONS/,
    );
    expect(sodax.swaps.createIntent).not.toHaveBeenCalled();
    expect(sodax.swaps.getQuote).not.toHaveBeenCalled();
  });

  it("builds an unsigned intent for a listed recipient, applying slippage to a fresh quote", async () => {
    const sodax = fakeSodax();
    const out = (await tool(sodax, "sodax_build_swap", `${ARB}:${RECIPIENT}`).handler({
      ...swapInput,
      slippage_bps: 50,
    })) as { approval: unknown; tx: unknown };
    const { params, raw } = (sodax.swaps.createIntent.mock.calls[0] as unknown[])[0] as {
      params: { minOutputAmount: bigint; deadline: bigint };
      raw: boolean;
    };
    expect(raw).toBe(true);
    expect(params.minOutputAmount).toBe(995_000n);
    expect(params.deadline).toBe(1_786_500_000n);
    expect(out.approval).toBeUndefined();
    expect(out.tx).toEqual({ data: "base64tx" });
  });

  it("builds a limit order with deadline 0 without asking the hub for one", async () => {
    const sodax = fakeSodax();
    await tool(sodax, "sodax_build_swap", `${ARB}:${RECIPIENT}`).handler({
      ...swapInput,
      min_output_amount: "1",
      deadline_seconds: 0,
    });
    const { params } = (sodax.swaps.createIntent.mock.calls[0] as unknown[])[0] as {
      params: { deadline: bigint };
    };
    expect(params.deadline).toBe(0n);
    expect(sodax.swaps.getSwapDeadline).not.toHaveBeenCalled();
  });

  it("rejects chain keys SODAX does not serve", async () => {
    await expect(
      tool(fakeSodax(), "sodax_quote").handler({ ...swapInput, src_chain_key: "solana-devnet" }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it("submits a swap with the intent's bigints restored and only the relay payload", async () => {
    const sodax = fakeSodax();
    await tool(sodax, "sodax_submit").handler({
      kind: "swap",
      src_chain_key: "solana",
      tx_hash: "sig",
      wallet_address: DESK,
      relay_data: { address: "0x1", payload: "0x2" },
      intent: { intentId: "1", inputAmount: "100000000" },
    });
    const body = (sodax.api.swaps.submitTx.mock.calls[0] as unknown[])[0] as {
      intent: { intentId: bigint; inputAmount: bigint };
      relayData: string;
    };
    expect(body.intent.intentId).toBe(1n);
    expect(body.intent.inputAmount).toBe(100_000_000n);
    expect(body.relayData).toBe("0x2");
  });

  it("sends the full relay envelope for a bridge submit", async () => {
    const sodax = fakeSodax();
    await tool(sodax, "sodax_submit").handler({
      kind: "bridge",
      src_chain_key: "solana",
      tx_hash: "sig",
      wallet_address: DESK,
      relay_data: { address: "0x1", payload: "0x2" },
    });
    const body = (sodax.api.bridge.submitTx.mock.calls[0] as unknown[])[0] as {
      relayData: unknown;
    };
    expect(body.relayData).toEqual({ address: "0x1", payload: "0x2" });
  });

  it("refuses to relay a Solana tx without its relay data", async () => {
    await expect(
      tool(fakeSodax(), "sodax_relay").handler({
        src_chain_key: "solana",
        tx_hash: "sig",
        notify: "none",
      }),
    ).rejects.toThrow(/relay_data/);
  });
});
