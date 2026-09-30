# SODAX connector

**Status:** implemented on `feat/sodax-integration` (stacked on `feat/workstation-shell`), not yet
run end-to-end with a signed mainnet transaction · **Decision:** ADR-025 · **Source:** the full
docs.sodax.com text (`https://docs.sodax.com/llms-full.txt`), read 2026-09-30, and the published
`@sodax/sdk@2.1.0` types.

## What SODAX is

Non-custodial cross-network execution. A signer locks the input on its network and declares an
**intent** (the outcome, not the route); a relayer carries it to the hub (Sonic); independent
solvers fill it on the destination network; the hub settles. 22 networks including Solana, 140
swap assets, 31 money-market reserves. **Mainnet only** — no testnet, devnet or test mode.

## Where it sits next to Jupiter

| Need | Connector |
|---|---|
| Swap between two Solana tokens | **Jupiter** (`mcp jupiter`) — best Solana routing |
| Swap into or out of another network | **SODAX** `sodax_build_swap` |
| Move the same asset to another network | **SODAX** `sodax_build_bridge` |
| Lend / borrow (collateral on any network) | **SODAX** `sodax_build_mm_action` |
| Leveraged LST yield (jitoSOL, weETH, wstETH) | **SODAX** `sodax_build_vault_action` |

Both follow the same shape: Rails pays a desk wallet through `execute_payment`, the connector
builds, the desk signs. Neither holds a key or touches the vault.

```
agent ──sodax_quote / sodax_vault_quote / sodax_bridge_info ─▶ (free reads)
agent ──agent_rails_execute_payment ─────────────────────────▶ vault → desk (policy + receipt)
agent ──sodax_build_* ───────────────────────────────────────▶ unsigned tx (+ approval) + relay_data
desk  ──sign + broadcast on src_chain_key
agent ──sodax_submit (swap, bridge) | sodax_relay (mm, vault, cancel, fallback)
agent ──sodax_status (poll) ─────────────────────────────────▶ solved | failed → cancel if needed
```

## Tools (`agent-rails-integrations mcp sodax`)

| Tool | Does | Moves funds |
|---|---|---|
| `sodax_supported` | chains; per chain: swap tokens, money-market tokens; vaults | no |
| `sodax_quote` | swap quote, protocol fee (0.1%), partner fee | no |
| `sodax_build_swap` | unsigned intent (+ EVM approval); `deadline_seconds: 0` = limit order | no |
| `sodax_build_cancel_swap` | unsigned cancel (non-split sources; see gaps) | no |
| `sodax_bridge_info` | bridgeable tokens, `isBridgeable`, current bridgeable limit | no |
| `sodax_build_bridge` | unsigned bridge deposit (+ EVM approval) | no |
| `sodax_mm_markets` / `sodax_mm_position` | reserves and rates / a spoke address's position | no |
| `sodax_build_mm_action` | unsigned supply / borrow / withdraw / repay | no |
| `sodax_vaults` / `sodax_vault_quote` | vault APR and TVL / vault-specific quote | no |
| `sodax_build_vault_action` | unsigned vault deposit or withdraw intent | no |
| `sodax_submit` | hands a broadcast swap/bridge to the SODAX backend (idempotent) | no — already signed |
| `sodax_relay` | relays a broadcast tx to the hub, optionally notifies solvers | no — already signed |
| `sodax_status` | status by source tx: solver (swap/vault), backend or relay (bridge), relay (mm) | no |

`min_output_amount` may be omitted on swap and vault builds: the tool quotes and applies
`slippage_bps` (default 100). Vault builds always quote with the vault quote — a swap quote
deducts a different fee and can leave the intent unfillable.

## Configuration (operator, never agent input)

| Variable | Meaning |
|---|---|
| `SODAX_ALLOWED_DESTINATIONS` | `<chainKey>:<address>` list. Every recipient other than the signing desk on its own chain must be here. Empty = fail closed. EVM addresses match case-insensitively; others exactly. |
| `SODAX_API_KEY` | Partner-portal key, sent as `x-api-key`. Not enforced yet; will be on `POST /swaps/*`. |
| `SODAX_PARTNER_FEE_ADDRESS` + `SODAX_PARTNER_FEE_BPS` | Optional revenue: a Sonic `0x` receiver and 1–1000 bps, applied to swaps, bridge, money market and vaults alike. |
| `SODAX_SOLANA_RPC_URL`, `SODAX_HUB_RPC_URL` | Override the public Solana and Sonic RPCs — the public Sonic RPC times out under load. |

## Verified (2026-09-30, mainnet, nothing signed)

Driving the built stdio server through an MCP client: 15 tools listed; quote 0.1 SOL → 11.80
USDC (Arbitrum); unsigned builds for a Solana→Arbitrum swap, a USDC Solana→Arbitrum bridge
(limit 12,189 USDC), a Solana USDC supply and a jitoSOL → `lsodaJITOSOL` deposit; from Arbitrum
the swap and bridge builds return the ERC-20 `approve` first; vault APRs (including a negative
net APR) and 31 reserves read; unlisted recipients refused before any SDK call.

Differential test against SODAX's own Builders MCP (`https://builders.sodax.com/mcp`, an
independent view of the same system), 14/14: chain list, Solana swap and money-market tokens, the
31 reserves; a built intent's relay chain ids and hub assets; our quote vs the solver's own quote
(0 bps apart); a token listed after the SDK release (PUMP) builds with the right hub asset; our
status for a filled and a cancelled real intent matches Builders' record. The relay-packet
comparison only covered a tx with no packets on either side.

Rerun it with `pnpm --filter @agent-rails/integrations check:sodax`
(`packages/integrations/scripts/sodax-builders-diff.mjs`) before bumping `@sodax/*`, or when the
connector starts refusing tokens or chains. Mainnet reads and unsigned builds only; it needs
network access, is not part of `pnpm test`, and exits non-zero on any mismatch.

Not yet verified: a signed transaction through submit/relay to `solved`. That needs a funded
mainnet desk and a person at the keys.

## Live token list

@sodax/sdk 2.1.0 validates tokens against the snapshot it shipped with, and its `initialize()`
fetches nothing — so tokens SODAX listed after the release (ten on Solana: PUMP, cbBTC, JLP, USD1,
PYUSD, USDG, JupUSD, USDe, ETH, USELESS) were refused. At startup the connector reads the live
list from the Swaps API (`/swaps/tokens`, which carries each token's `hubAsset` and `vault`) and
layers it over the snapshot; if that read fails it logs to stderr and keeps the snapshot. The
backend's `config/all` cannot be used for this: its token entries lack `hubAsset`/`vault`.

The connector also sets the relay endpoint to `https://api.sodax.com/v1/relay` — 2.1.0 still
defaults to the legacy `xcall-relay.nw.iconblockchain.xyz`, which answers the same today.

## Gaps against the docs

The docs describe a newer SDK than the published 2.1.0. Absent there, and so absent here:
`getCancelIntentRelayData` (raw cancels from Solana/Bitcoin — a timed intent can still be
cancelled by anyone after its deadline), `bridge.getDetailedStatus` and
`leverageYield.getDetailedStatus` (status is composed from the backend and relay instead), the
Leverage Yield HTTP client (vault intents go through `sodax_relay` + solver notify), the
top-level `apiKey` option (sent as an explicit header) and `getSwapSpeedTier`. Revisit on the
next `@sodax/*` release.

Staking SODA and ICX/BALN migration are SODAX-token specific and not wrapped.

## Operational rules

- Poll `sodax_status` until `solved` or `failed`; `failed` is real. A failed fill leaves the
  intent open — cancel to refund. A limit order never expires.
- Never re-sign to recover. `sodax_submit` is idempotent on `(tx_hash, src_chain_key)`;
  `sodax_relay` is idempotent too. Keep `intent` and `relay_data` until done — Solana and
  Bitcoin commit only a hash of the relay payload on-chain.
- Solana unsigned transactions carry a recent blockhash: sign within about a minute or rebuild.
