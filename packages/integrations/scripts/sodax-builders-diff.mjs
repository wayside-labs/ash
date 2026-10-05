#!/usr/bin/env node
// Differential check of the SODAX connector against SODAX's own Builders MCP, on mainnet.
//
// Builders (https://builders.sodax.com/mcp) is an independent view of the same system, so
// disagreement means the connector — or the @sodax/sdk it wraps — drifted from what SODAX serves
// today. Run it before bumping @sodax/*, and whenever sodax tools start refusing tokens or chains.
//
//   pnpm --filter @ash/integrations check:sodax
//
// Read and unsigned-build tools only: nothing is signed or broadcast. Needs network access; not
// part of `pnpm test`. Exits non-zero when any check fails.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BUILDERS_MCP = "https://builders.sodax.com/mcp";
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// Any valid addresses: builds are never signed. The recipient is allowlisted for this run only.
const DESK = "AnCCJjheynmGqPp6Vgat9DTirGKD4CtQzP8cwTYV8qKH";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const ARBITRUM = "0xa4b1.arbitrum";
const SOL = "11111111111111111111111111111111";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
// Listed by SODAX after @sodax/sdk 2.1.0 shipped; builds only through the live token list.
const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const SOLVED = 3;

const ours = new Client({ name: "sodax-builders-diff", version: "0" });
const theirs = new Client({ name: "sodax-builders-diff", version: "0" });

async function o(name, args) {
  const res = await ours.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name}: ${JSON.stringify(res.structuredContent)}`);
  return res.structuredContent;
}

// Builders answers in Markdown with the JSON payload embedded after a heading.
async function b(name, args = {}) {
  const res = await theirs.callTool({ name, arguments: { format: "json", ...args } });
  const text = res.content?.map((part) => part.text).join("") ?? "";
  if (res.isError) throw new Error(`builders ${name}: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(text.search(/[[{]/)));
}

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const lower = (value) => String(value).toLowerCase();

function sameSet(actual, expected) {
  const a = new Set(actual);
  const e = new Set(expected);
  const missing = [...e].filter((v) => !a.has(v));
  const extra = [...a].filter((v) => !e.has(v));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

function hubAssetOf(hubAssets, chainKey, spokeToken) {
  const perChain = hubAssets[chainKey] ?? hubAssets;
  const hit = Object.entries(perChain).find(([spoke]) => lower(spoke) === lower(spokeToken));
  if (!hit) return undefined;
  const value = hit[1];
  return typeof value === "string" ? value : (value.asset ?? value.hubAsset ?? value.address);
}

async function configParity() {
  const all = await o("sodax_supported", {});
  const solana = await o("sodax_supported", { chain_key: "solana" });

  let r = sameSet(all.chains, await b("sodax_get_supported_chains"));
  check("chains match Builders", r.ok, r.ok ? `${all.chains.length} chains` : JSON.stringify(r));

  const swap = await b("sodax_get_swap_tokens", { chainId: "solana" });
  const swapList = Array.isArray(swap) ? swap : (swap.solana ?? Object.values(swap).flat());
  r = sameSet(
    solana.swap_tokens.map((t) => t.address),
    swapList.map((t) => t.address),
  );
  check(
    "Solana swap tokens match Builders",
    r.ok,
    r.ok ? `${solana.swap_tokens.length} tokens` : JSON.stringify(r),
  );

  const mmTokens = await b("sodax_get_money_market_tokens", { chainId: "solana" });
  r = sameSet(
    solana.money_market_tokens.map((t) => t.address),
    mmTokens.map((t) => t.address),
  );
  check(
    "Solana money-market tokens match Builders",
    r.ok,
    r.ok ? solana.money_market_tokens.map((t) => t.symbol).join(",") : JSON.stringify(r),
  );

  const mm = await o("sodax_mm_markets", {});
  const assets = await b("sodax_get_money_market_assets");
  const assetList = Array.isArray(assets) ? assets : (assets.assets ?? assets.data ?? []);
  r = sameSet(
    mm.assets.map((a) => lower(a.reserveAddress)),
    assetList.map((a) => lower(a.reserveAddress)),
  );
  check(
    "money-market reserves match Builders",
    r.ok,
    r.ok ? `${mm.assets.length} reserves` : JSON.stringify(r),
  );
}

async function builtIntents() {
  const relayMap = await b("sodax_get_relay_chain_id_map");
  const hubSolana = await b("sodax_get_hub_assets", { chainId: "solana" });
  const hubArbitrum = await b("sodax_get_hub_assets", { chainId: ARBITRUM });

  const swap = (srcToken, amount) =>
    o("sodax_build_swap", {
      src_chain_key: "solana",
      src_address: DESK,
      src_token: srcToken,
      amount,
      dst_chain_key: ARBITRUM,
      dst_token: ARB_USDC,
      dst_address: RECIPIENT,
    });

  const { intent } = await swap(SOL, "100000000");
  check(
    "intent.srcChain = Builders relay id for solana",
    String(intent.srcChain) === String(relayMap.solana),
    `${intent.srcChain} vs ${relayMap.solana}`,
  );
  check(
    "intent.dstChain = Builders relay id for arbitrum",
    String(intent.dstChain) === String(relayMap[ARBITRUM]),
    `${intent.dstChain} vs ${relayMap[ARBITRUM]}`,
  );
  const expectedIn = hubAssetOf(hubSolana, "solana", SOL);
  const expectedOut = hubAssetOf(hubArbitrum, ARBITRUM, ARB_USDC);
  check(
    "intent.inputToken = Builders hub asset of SOL",
    lower(intent.inputToken) === lower(expectedIn),
    `${intent.inputToken} vs ${expectedIn}`,
  );
  check(
    "intent.outputToken = Builders hub asset of Arbitrum USDC",
    lower(intent.outputToken) === lower(expectedOut),
    `${intent.outputToken} vs ${expectedOut}`,
  );
  check(
    "intent.dstAddress encodes the allowlisted recipient",
    lower(intent.dstAddress).includes(lower(RECIPIENT).slice(2)),
    intent.dstAddress,
  );

  const quote = await o("sodax_quote", {
    src_chain_key: "solana",
    src_token: SOL,
    dst_chain_key: ARBITRUM,
    dst_token: ARB_USDC,
    amount: "100000000",
  });
  try {
    const solver = await b("sodax_get_solver_quote", {
      tokenSrc: intent.inputToken,
      tokenDst: intent.outputToken,
      amount: "100000000",
      quoteType: "exact_input",
    });
    const theirsAmount = BigInt(solver.quoted_amount ?? solver.quotedAmount);
    const oursAmount = BigInt(quote.quoted_amount);
    const bps = Number(((oursAmount - theirsAmount) * 10_000n) / (theirsAmount || 1n));
    check(
      "quote within 1% of the solver's quote via Builders",
      Math.abs(bps) <= 100,
      `ours ${oursAmount}, Builders ${theirsAmount} (${bps} bps)`,
    );
  } catch (error) {
    check("solver quote via Builders", false, error.message.slice(0, 300));
  }

  const pump = await swap(PUMP, "1000000000");
  const expectedPump = hubAssetOf(hubSolana, "solana", PUMP);
  check(
    "post-release token (PUMP) builds with Builders' hub asset",
    lower(pump.intent.inputToken) === lower(expectedPump),
    `${pump.intent.inputToken} vs ${expectedPump}`,
  );

  return relayMap;
}

// Real intents from Builders' history. Sonic-source intents need no relay leg, so their hub tx is
// also their source tx and `sodax_status` can be asked about them directly.
async function statusParity(relayMap) {
  const orderbook = await b("sodax_get_orderbook", { limit: 5, srcChain: Number(relayMap.solana) });
  const creators = [...new Set(orderbook.map((entry) => entry.intentData.creator))];
  let history = [];
  for (const creator of creators) {
    const page = await b("sodax_get_user_transactions", { userAddress: creator, limit: 20 });
    history = history.concat(page.items ?? page);
  }
  const hubSourced = history.filter((it) => String(it.intent?.srcChain) === String(relayMap.sonic));
  const withEvent = (type) =>
    hubSourced.find((it) => (it.events ?? []).some((e) => (e.eventType ?? e.type) === type));

  const filled = withEvent("intent-filled");
  const cancelled = withEvent("intent-cancelled");
  for (const [label, item, expectSolved] of [
    ["filled", filled, true],
    ["cancelled", cancelled, false],
  ]) {
    if (!item) {
      check(`a Sonic-source ${label} intent exists in Builders history`, false);
      continue;
    }
    const status = await o("sodax_status", {
      kind: "swap",
      src_chain_key: "sonic",
      tx_hash: item.txHash,
    });
    const code = Number(status.data?.status);
    check(
      `status of a ${label} intent agrees with Builders (${expectSolved ? "solved" : "not solved"})`,
      expectSolved ? code === SOLVED : code !== SOLVED,
      `ours source=${status.source} status=${code}, intent ${item.intentHash}`,
    );
  }

  if (filled) {
    const oursPackets = await o("sodax_status", {
      kind: "money_market",
      src_chain_key: "sonic",
      tx_hash: filled.txHash,
    });
    const theirsPackets = await b("sodax_relay_get_transaction_packets", {
      chainId: String(relayMap.sonic),
      txHash: filled.txHash,
    }).catch(() => ({ data: [] }));
    const oursCount = oursPackets.data?.length ?? 0;
    const theirsCount =
      theirsPackets.data?.length ?? (Array.isArray(theirsPackets) ? theirsPackets.length : 0);
    check(
      "relay packets for the same tx agree with Builders",
      oursCount === theirsCount,
      `ours ${oursCount}, Builders ${theirsCount}`,
    );
  }
}

try {
  await ours.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "sodax"],
      stderr: "ignore",
      env: { ...process.env, SODAX_ALLOWED_DESTINATIONS: `${ARBITRUM}:${RECIPIENT}` },
    }),
  );
  await theirs.connect(new StreamableHTTPClientTransport(new URL(BUILDERS_MCP)));

  await configParity();
  const relayMap = await builtIntents();
  await statusParity(relayMap);
} catch (error) {
  check("run completed", false, error instanceof Error ? error.message : String(error));
} finally {
  await Promise.allSettled([ours.close(), theirs.close()]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
