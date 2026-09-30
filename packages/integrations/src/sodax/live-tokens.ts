import type { XToken } from "@sodax/sdk";

type ChainTokens = { supportedTokens: Record<string, XToken> };

export type LiveTokenOverrides = {
  chains: Record<string, ChainTokens>;
  swapTokens: Record<string, XToken[]>;
  /** Tokens the live list adds on top of the SDK's packaged snapshot. */
  added: number;
};

/**
 * @sodax/sdk 2.1.0 validates every token against the snapshot it shipped with, and its
 * `initialize()` fetches nothing, so assets SODAX listed since the release (ten on Solana at the
 * time of writing: PUMP, cbBTC, JLP, …) are refused as "unsupported token". The Swaps API's
 * `/swaps/tokens` is the live list and carries the `hubAsset`/`vault` the SDK needs; the backend's
 * `config/all` does not, so it cannot be used here.
 *
 * Only chains already in the packaged config are touched: a new chain needs its full chain config
 * (contracts, RPC), which a token list cannot supply.
 */
export function liveTokenOverrides(
  packagedChains: Readonly<Record<string, ChainTokens>>,
  live: Readonly<Record<string, readonly XToken[]>>,
): LiveTokenOverrides {
  const chains: Record<string, ChainTokens> = {};
  const swapTokens: Record<string, XToken[]> = {};
  let added = 0;
  for (const [chainKey, tokens] of Object.entries(live)) {
    const packaged = packagedChains[chainKey]?.supportedTokens;
    if (!packaged) continue;
    const usable = tokens.filter((t) => t.hubAsset && t.vault && t.address);
    if (usable.length === 0) continue;
    const known = new Set(Object.values(packaged).map((t) => t.address.toLowerCase()));
    const merged: Record<string, XToken> = { ...packaged };
    for (const token of usable) {
      if (!known.has(token.address.toLowerCase())) added += 1;
      merged[token.symbol] = { ...merged[token.symbol], ...token, chainKey } as XToken;
    }
    chains[chainKey] = { supportedTokens: merged };
    swapTokens[chainKey] = usable.map((t) => ({ ...t, chainKey }) as XToken);
  }
  return { chains, swapTokens, added };
}
