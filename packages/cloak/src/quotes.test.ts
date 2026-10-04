import { ZEC_MINT } from "@agent-rails/contract/template-run";
import { describe, expect, it, vi } from "vitest";
import { JUPITER_QUOTE_URL, WSOL_MINT } from "./constants.js";
import { quoteDrifted, quoteZecOut, quoteZecPayouts } from "./quotes.js";

function answering(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("quoteZecOut", () => {
  it("asks for SOL to the verified ZEC mint and returns the output as a bigint", async () => {
    const fetchImpl = answering({ outputMint: ZEC_MINT, outAmount: "182837" });
    await expect(quoteZecOut(20_000_000n, { fetchImpl })).resolves.toBe(182_837n);
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url.startsWith(JUPITER_QUOTE_URL)).toBe(true);
    expect(url).toContain(`inputMint=${WSOL_MINT}`);
    expect(url).toContain(`outputMint=${ZEC_MINT}`);
    expect(url).toContain("amount=20000000");
  });

  it("treats the aggregator's answer as data: the mint must be the one asked for", async () => {
    const fetchImpl = answering({
      outputMint: "So11111111111111111111111111111111111111112",
      outAmount: "5",
    });
    await expect(quoteZecOut(20_000_000n, { fetchImpl })).rejects.toMatchObject({
      code: "swap_quote_unavailable",
    });
  });

  it("refuses an output that is not a plain positive integer", async () => {
    for (const outAmount of ["0", "-5", "1e3", "12.5", "", 5, null, undefined, "9".repeat(21)]) {
      const fetchImpl = answering({ outputMint: ZEC_MINT, outAmount });
      await expect(quoteZecOut(1_000n, { fetchImpl }), String(outAmount)).rejects.toMatchObject({
        code: "swap_quote_unavailable",
      });
    }
  });

  it("maps an error status, a thrown fetch and a malformed body to the same code", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const failing = answering({}, { ok: false, status: 429 });
    const notJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    })) as unknown as typeof fetch;
    for (const fetchImpl of [down, failing, notJson]) {
      await expect(quoteZecOut(1_000n, { fetchImpl })).rejects.toMatchObject({
        code: "swap_quote_unavailable",
      });
    }
  });

  it("will not quote nothing", async () => {
    const fetchImpl = answering({ outputMint: ZEC_MINT, outAmount: "1" });
    await expect(quoteZecOut(0n, { fetchImpl })).rejects.toMatchObject({
      code: "swap_quote_unavailable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("quoteZecPayouts", () => {
  it("quotes only the ZEC payouts, by index, on their net amount", async () => {
    const fetchImpl = answering({ outputMint: ZEC_MINT, outAmount: "100" });
    const quotes = await quoteZecPayouts(
      [
        { index: 0, deliver: "SOL", netLamports: 14_940_000n },
        { index: 1, deliver: "ZEC", netLamports: 14_940_000n },
        { index: 2, deliver: "ZEC", netLamports: 24_940_000n },
      ],
      { fetchImpl },
    );
    expect([...quotes.keys()]).toEqual([1, 2]);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.[0])).toContain("amount=14940000");
    expect(String(calls[1]?.[0])).toContain("amount=24940000");
  });

  it("makes no request when nothing is swapped", async () => {
    const fetchImpl = answering({});
    const quotes = await quoteZecPayouts([{ index: 0, deliver: "SOL", netLamports: 1n }], {
      fetchImpl,
    });
    expect(quotes.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("quoteDrifted", () => {
  const at = (...pairs: [number, bigint][]) => new Map(pairs);

  it("lets a quote that moved by 1% or less stand", () => {
    expect(quoteDrifted(at([1, 183_000n]), at([1, 183_000n]), [1])).toBe(false);
    expect(quoteDrifted(at([1, 183_000n]), at([1, 184_830n]), [1])).toBe(false); // +1.00%
    expect(quoteDrifted(at([1, 183_000n]), at([1, 181_170n]), [1])).toBe(false); // -1.00%
  });

  it("asks for a new approval past 1%, in either direction", () => {
    expect(quoteDrifted(at([1, 183_000n]), at([1, 184_831n]), [1])).toBe(true);
    expect(quoteDrifted(at([1, 183_000n]), at([1, 181_169n]), [1])).toBe(true);
  });

  it("looks only at the payouts it is asked about", () => {
    const approved = at([1, 100_000n], [3, 100_000n]);
    const fresh = at([1, 100_000n], [3, 150_000n]);
    expect(quoteDrifted(approved, fresh, [1])).toBe(false);
    expect(quoteDrifted(approved, fresh, [1, 3])).toBe(true);
    expect(quoteDrifted(approved, fresh, [])).toBe(false);
  });

  it("cannot compare what is missing on either side, so it counts as moved", () => {
    expect(quoteDrifted(at(), at([1, 5n]), [1])).toBe(true);
    expect(quoteDrifted(at([1, 5n]), at(), [1])).toBe(true);
    expect(quoteDrifted(at([1, 0n]), at([1, 5n]), [1])).toBe(true);
  });

  it("takes the tolerance as an argument", () => {
    expect(quoteDrifted(at([1, 1_000n]), at([1, 1_030n]), [1], 5n)).toBe(false);
    expect(quoteDrifted(at([1, 1_000n]), at([1, 1_060n]), [1], 5n)).toBe(true);
  });
});
