import { z } from "zod";

const DEFAULT_BASE = "https://quote-api.jup.ag";

const quoteResponseSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    otherAmountThreshold: z.string().optional(),
    swapMode: z.string().optional(),
    slippageBps: z.number().optional(),
    priceImpactPct: z.string().optional(),
    routePlan: z.array(z.unknown()).optional(),
  })
  .passthrough();

const swapResponseSchema = z
  .object({
    swapTransaction: z.string(),
    lastValidBlockHeight: z.number().optional(),
  })
  .passthrough();

export type JupiterQuote = z.infer<typeof quoteResponseSchema>;

export type JupiterClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class JupiterClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JupiterClientOptions = {}) {
    this.base = (options.baseUrl ?? process.env.JUPITER_API_BASE ?? DEFAULT_BASE).replace(
      /\/+$/,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async quote(input: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
  }): Promise<JupiterQuote> {
    const params = new URLSearchParams({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amount,
      slippageBps: String(input.slippageBps ?? 50),
    });
    const res = await this.fetchImpl(`${this.base}/v6/quote?${params}`, {
      signal: AbortSignal.timeout(25_000),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof json === "object" && json && "error" in json
          ? String((json as { error: unknown }).error)
          : `Jupiter quote failed (${res.status})`,
      );
    }
    return quoteResponseSchema.parse(json);
  }

  async swapTransaction(input: {
    quote: JupiterQuote;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    dynamicComputeUnitLimit?: boolean;
  }): Promise<{ swapTransaction: string; lastValidBlockHeight?: number }> {
    const res = await this.fetchImpl(`${this.base}/v6/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: input.quote,
        userPublicKey: input.userPublicKey,
        wrapAndUnwrapSol: input.wrapAndUnwrapSol ?? true,
        dynamicComputeUnitLimit: input.dynamicComputeUnitLimit ?? true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof json === "object" && json && "error" in json
          ? String((json as { error: unknown }).error)
          : `Jupiter swap failed (${res.status})`,
      );
    }
    const parsed = swapResponseSchema.parse(json);
    return {
      swapTransaction: parsed.swapTransaction,
      ...(parsed.lastValidBlockHeight === undefined
        ? {}
        : { lastValidBlockHeight: parsed.lastValidBlockHeight }),
    };
  }
}
