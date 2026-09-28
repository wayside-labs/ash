#!/usr/bin/env bash
#
# Read-only rate scout for the capped yield rebalance template. Prints a Markdown table of
# stablecoin lending rates on the venues the operator allowlisted. No keys, no RPC, no writes
# anywhere but stdout (and $OUT if set).
#
#   scout-rates.sh                    # table on stdout
#   OUT=rates.json scout-rates.sh     # also write the filtered rows as JSON for the planner
#
# Environment:
#   VENUES      comma-separated DefiLlama project slugs      (default: kamino-lend,save)
#   SYMBOLS     comma-separated stablecoin symbols            (default: USDC)
#   MIN_TVL     pools under this TVL in USD are dropped       (default: 1000000)
#   YIELDS_URL  data source                                   (default: DefiLlama yields API)
#
# The venue list is the allowlist that matters here. The API returns every pool on Solana,
# including strategies advertising tens of percent; filtering by venue *before* the planner
# sees anything is what keeps "highest number wins" out of the loop.

set -euo pipefail

VENUES=${VENUES:-kamino-lend,save}
SYMBOLS=${SYMBOLS:-USDC}
MIN_TVL=${MIN_TVL:-1000000}
YIELDS_URL=${YIELDS_URL:-https://yields.llama.fi/pools}

curl -fsS -m 30 "$YIELDS_URL" | node -e '
  const [venues, symbols, minTvl, out] = process.argv.slice(1);
  const venueSet = new Set(venues.split(",").map((v) => v.trim()).filter(Boolean));
  const symbolSet = new Set(symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    const rows = JSON.parse(raw).data
      .filter((p) => p.chain === "Solana" && venueSet.has(p.project))
      .filter((p) => symbolSet.has(String(p.symbol).toUpperCase()) && p.exposure === "single")
      .filter((p) => p.tvlUsd >= Number(minTvl))
      .map((p) => {
        const flags = [];
        // Incentive APY ends when the program ends; the planner should weigh base APY.
        if ((p.apyReward ?? 0) > (p.apyBase ?? 0)) flags.push("reward-heavy");
        if (p.apyMean30d && p.apy > 2 * p.apyMean30d) flags.push("spike-vs-30d");
        if (p.outlier) flags.push("outlier");
        return {
          venue: p.project,
          market: p.poolMeta ?? "",
          symbol: p.symbol,
          apy: p.apy,
          apyBase: p.apyBase ?? 0,
          apyReward: p.apyReward ?? 0,
          apyMean30d: p.apyMean30d ?? null,
          tvlUsd: Math.round(p.tvlUsd),
          pool: p.pool,
          flags,
        };
      })
      .sort((a, b) => b.apyBase - a.apyBase);

    const pct = (n) => (n == null ? "–" : `${n.toFixed(2)}%`);
    const usd = (n) => `$${(n / 1e6).toFixed(1)}M`;
    console.log(`Rates as of ${new Date().toISOString()} — venues: ${[...venueSet].join(", ")}`);
    console.log("");
    console.log("| venue | market | symbol | base APY | reward APY | 30d mean | TVL | flags |");
    console.log("|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.venue} | ${r.market} | ${r.symbol} | ${pct(r.apyBase)} | ${pct(r.apyReward)} | ` +
          `${pct(r.apyMean30d)} | ${usd(r.tvlUsd)} | ${r.flags.join(", ")} |`,
      );
    }
    if (rows.length === 0) console.log("| (no pools matched) | | | | | | | |");
    if (out) require("node:fs").writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  });
' "$VENUES" "$SYMBOLS" "$MIN_TVL" "${OUT:-}"
