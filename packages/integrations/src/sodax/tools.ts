import {
  getTransactionPackets,
  isHubChainKeyType,
  isSodaxError,
  type RelayExtraData,
  relayTxAndWaitPacket,
  type Sodax,
  type SpokeChainKey,
  type XToken,
} from "@sodax/sdk";
import { z } from "zod";
import type { SodaxConnectorConfig } from "./config.js";
import { checkDestination } from "./policy.js";
import { parseAmount, parseIntent, toJsonSafe } from "./serialize.js";

// The SDK types every call through a per-chain generic narrowed from literal chain keys. Agent input
// is a runtime string validated against the live chain list, so the connector talks to it through
// this loosened view rather than casting at every call site.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
type Loose = any;

export class ToolError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

type SdkResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function errorDetail(error: unknown): unknown {
  if (isSodaxError(error)) return error.toJSON();
  if (error instanceof Error) return { name: error.name, message: error.message };
  return error;
}

function unwrap<T>(result: SdkResult<T>, what: string): T {
  if (result.ok) return result.value;
  throw new ToolError(`${what} failed`, errorDetail(result.error));
}

const amountSchema = z.string().regex(/^\d+$/, "base-unit integer string");
const chainKeySchema = z
  .string()
  .min(1)
  .describe("SODAX chain key, e.g. solana, sonic, 0xa4b1.arbitrum");
const addressSchema = z.string().min(1);
const relayDataSchema = z.strictObject({ address: z.string(), payload: z.string() });

const DESK_FLOW =
  "Fund the desk first with agent_rails_execute_payment (policy-checked, receipted). Sign `tx` with the " +
  "desk key on src_chain_key and broadcast it (Solana: base64 serialized transaction, EVM: {from,to,value,data}). " +
  "Solana transactions carry a recent blockhash: sign within about a minute or rebuild.";

export type SodaxTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  handler: (input: Loose) => Promise<unknown>;
};

export function createSodaxTools(sodax: Sodax, config: SodaxConnectorConfig): SodaxTool[] {
  const sdk = sodax as Loose;

  function chain(key: string): SpokeChainKey {
    const supported: readonly string[] = sodax.config.getSupportedSpokeChains();
    if (!supported.includes(key)) {
      throw new ToolError(`Unknown chain key "${key}"`, { supported });
    }
    return key as SpokeChainKey;
  }

  function guardDestination(
    srcChainKey: string,
    srcAddress: string,
    dstChainKey: string,
    dstAddress: string,
  ) {
    const check = checkDestination(
      config.allowlist,
      { chainKey: srcChainKey, address: srcAddress },
      { chainKey: dstChainKey, address: dstAddress },
    );
    if (!check.ok) throw new ToolError(check.reason);
  }

  function findToken(tokens: readonly XToken[], address: string): XToken | undefined {
    const lower = address.toLowerCase();
    return tokens.find((t) => t.address === address || t.address.toLowerCase() === lower);
  }

  function spokeTokens(chainKey: SpokeChainKey): XToken[] {
    const supported = sdk.config.spokeChainConfig?.[chainKey]?.supportedTokens ?? {};
    return Object.values(supported) as XToken[];
  }

  async function approvalPlan(
    isValid: () => Promise<SdkResult<boolean>>,
    build: () => Promise<SdkResult<unknown>>,
  ): Promise<unknown> {
    if (unwrap(await isValid(), "allowance check")) return undefined;
    return unwrap(await build(), "approval build");
  }

  async function quotedMin(
    quote: Promise<SdkResult<{ quoted_amount: bigint }>>,
    slippageBps: number,
  ): Promise<{ quoted: bigint; min: bigint }> {
    const { quoted_amount } = unwrap(await quote, "quote");
    return { quoted: quoted_amount, min: (quoted_amount * BigInt(10_000 - slippageBps)) / 10_000n };
  }

  function relayChainId(chainKey: SpokeChainKey): string {
    const id = sdk.instanceConfig?.relay?.relayChainIdMap?.[chainKey];
    if (id === undefined) throw new ToolError(`No relay chain id for ${chainKey}`);
    return String(id);
  }

  const relayerUrl = (): string => sdk.instanceConfig.relay.relayerApiEndpoint;

  const slippageSchema = z.number().int().min(1).max(2000).optional().describe("Default 100 (1%)");

  return [
    {
      name: "sodax_supported",
      description:
        "Free. Networks SODAX reaches, and for one chain its swap tokens, money-market tokens, and the leverage-yield vaults on the Sonic hub. Read addresses from here; never hard-code them.",
      inputSchema: z.strictObject({ chain_key: chainKeySchema.optional() }),
      handler: async ({ chain_key }: { chain_key?: string }) => {
        const chains = sodax.config.getSupportedSpokeChains();
        const vaults = sodax.leverageYield
          .listVaults()
          .map((v) => ({ name: v.name, vault: v.vault }));
        if (!chain_key) return { chains, vaults };
        const key = chain(chain_key);
        return {
          chain_key: key,
          swap_tokens: sodax.swaps.getSupportedSwapTokensByChainId(key),
          money_market_tokens: sodax.moneyMarket.getSupportedTokensByChainId(key),
          vaults,
        };
      },
    },

    {
      name: "sodax_quote",
      description:
        "Free. Cross-network swap quote (exact input). quoted_amount is net of the protocol's 0.1% fee and any configured partner fee, in dst_token base units. For swaps inside Solana, jupiter_quote usually routes better.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        src_token: addressSchema,
        dst_chain_key: chainKeySchema,
        dst_token: addressSchema,
        amount: amountSchema.describe("Input amount in src_token base units"),
      }),
      handler: async (input: {
        src_chain_key: string;
        src_token: string;
        dst_chain_key: string;
        dst_token: string;
        amount: string;
      }) => {
        const src = chain(input.src_chain_key);
        const dst = chain(input.dst_chain_key);
        const amount = parseAmount(input.amount, "amount");
        const quote = unwrap(
          await sodax.swaps.getQuote({
            token_src: input.src_token,
            token_dst: input.dst_token,
            token_src_blockchain_id: src,
            token_dst_blockchain_id: dst,
            amount,
            quote_type: "exact_input",
          } as Loose),
          "quote",
        );
        return {
          quoted_amount: quote.quoted_amount,
          protocol_fee: sodax.swaps.getSolverFee(amount),
          partner_fee: sodax.swaps.getPartnerFee(amount),
        };
      },
    },

    {
      name: "sodax_build_swap",
      description:
        "Free, moves nothing. Builds an UNSIGNED cross-network swap intent from a desk wallet, plus an approval tx when an EVM source needs one. Refuses recipients outside the operator's destination allowlist. After broadcasting, call sodax_submit (kind swap) with tx_hash, intent and relay_data.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        src_address: addressSchema.describe("Desk wallet that will sign on src_chain_key"),
        src_token: addressSchema,
        amount: amountSchema,
        dst_chain_key: chainKeySchema,
        dst_token: addressSchema,
        dst_address: addressSchema.describe("Recipient on dst_chain_key; must be allowlisted"),
        min_output_amount: amountSchema.optional().describe("Omit to quote and apply slippage_bps"),
        slippage_bps: slippageSchema,
        deadline_seconds: z
          .number()
          .int()
          .min(0)
          .max(86_400)
          .optional()
          .describe(
            "Default 300. 0 creates a limit order that never expires and must be cancelled",
          ),
        allow_partial_fill: z.boolean().optional(),
      }),
      handler: async (input: {
        src_chain_key: string;
        src_address: string;
        src_token: string;
        amount: string;
        dst_chain_key: string;
        dst_token: string;
        dst_address: string;
        min_output_amount?: string;
        slippage_bps?: number;
        deadline_seconds?: number;
        allow_partial_fill?: boolean;
      }) => {
        const src = chain(input.src_chain_key);
        const dst = chain(input.dst_chain_key);
        guardDestination(src, input.src_address, dst, input.dst_address);
        const inputAmount = parseAmount(input.amount, "amount");
        const minOutputAmount =
          input.min_output_amount !== undefined
            ? parseAmount(input.min_output_amount, "min_output_amount")
            : (
                await quotedMin(
                  sdk.swaps.getQuote({
                    token_src: input.src_token,
                    token_dst: input.dst_token,
                    token_src_blockchain_id: src,
                    token_dst_blockchain_id: dst,
                    amount: inputAmount,
                    quote_type: "exact_input",
                  }),
                  input.slippage_bps ?? 100,
                )
              ).min;
        const seconds = input.deadline_seconds ?? 300;
        const deadline =
          seconds === 0
            ? 0n
            : unwrap(await sodax.swaps.getSwapDeadline(BigInt(seconds)), "deadline");
        const params = {
          inputToken: input.src_token,
          outputToken: input.dst_token,
          inputAmount,
          minOutputAmount,
          deadline,
          allowPartialFill: input.allow_partial_fill ?? false,
          srcChainKey: src,
          dstChainKey: dst,
          srcAddress: input.src_address,
          dstAddress: input.dst_address,
          solver: "0x0000000000000000000000000000000000000000",
          data: "0x",
        };
        const approval = await approvalPlan(
          () => sdk.swaps.isAllowanceValid({ params, raw: true }),
          () => sdk.swaps.buildApproveTxs({ params, raw: true }),
        );
        const created = unwrap(
          await sdk.swaps.createIntent({ params, raw: true }),
          "createIntent",
        ) as {
          tx: unknown;
          intent: unknown;
          relayData: RelayExtraData;
        };
        return {
          approval,
          tx: created.tx,
          intent: created.intent,
          relay_data: created.relayData,
          limit_order: seconds === 0,
          next_step: `${approval ? "Broadcast approval.resetTx (if present) then approval.approveTx and wait for each receipt. " : ""}${DESK_FLOW} Then sodax_submit kind=swap. Keep intent and relay_data until sodax_status reports solved.`,
        };
      },
    },

    {
      name: "sodax_build_cancel_swap",
      description:
        "Free. Builds an UNSIGNED cancel for an open swap intent (a failed fill or a limit order); remaining input returns to the intent's creator. EVM and other non-split sources only — after broadcasting, call sodax_relay with notify=none.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        intent: z
          .record(z.string(), z.unknown())
          .describe("intent exactly as returned by sodax_build_swap"),
      }),
      handler: async (input: { src_chain_key: string; intent: Record<string, unknown> }) => {
        const src = chain(input.src_chain_key);
        if (src === "solana" || src === "bitcoin") {
          throw new ToolError(
            "Raw cancels from Solana/Bitcoin need cancel relay data that @sodax/sdk 2.1.0 does not expose. A timed intent can be cancelled by anyone once its deadline passes; otherwise cancel from a signed SDK session.",
          );
        }
        const tx = unwrap(
          await sdk.swaps.createCancelIntent({
            params: { srcChainKey: src, intent: parseIntent(input.intent) },
            raw: true,
          }),
          "createCancelIntent",
        );
        return { tx, next_step: `${DESK_FLOW} Then sodax_relay with notify=none.` };
      },
    },

    {
      name: "sodax_bridge_info",
      description:
        "Free. Bridge (same asset, no price discovery) discovery: which dst tokens a src token bridges to, and the current bridgeable limit between a pair.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        src_token: addressSchema,
        dst_chain_key: chainKeySchema,
        dst_token: addressSchema.optional(),
      }),
      handler: async (input: {
        src_chain_key: string;
        src_token: string;
        dst_chain_key: string;
        dst_token?: string;
      }) => {
        const src = chain(input.src_chain_key);
        const dst = chain(input.dst_chain_key);
        const bridgeable_tokens = unwrap(
          sdk.bridge.getBridgeableTokens(src, dst, input.src_token),
          "getBridgeableTokens",
        ) as XToken[];
        if (!input.dst_token) return { bridgeable_tokens };
        const from = findToken(spokeTokens(src), input.src_token);
        const to =
          findToken(bridgeable_tokens, input.dst_token) ??
          findToken(spokeTokens(dst), input.dst_token);
        if (!from || !to) return { bridgeable_tokens, bridgeable: false };
        const bridgeable = sodax.bridge.isBridgeable({ from, to });
        const limit = bridgeable
          ? unwrap(await sodax.bridge.getBridgeableAmount(from, to), "getBridgeableAmount")
          : undefined;
        return { bridgeable_tokens, bridgeable, limit };
      },
    },

    {
      name: "sodax_build_bridge",
      description:
        "Free, moves nothing. Builds an UNSIGNED bridge deposit (spoke→hub→spoke vaults) from a desk wallet, plus an approval when an EVM source needs one. Refuses recipients outside the destination allowlist. After broadcasting, call sodax_submit kind=bridge.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        src_address: addressSchema,
        src_token: addressSchema,
        amount: amountSchema,
        dst_chain_key: chainKeySchema,
        dst_token: addressSchema,
        recipient: addressSchema,
      }),
      handler: async (input: {
        src_chain_key: string;
        src_address: string;
        src_token: string;
        amount: string;
        dst_chain_key: string;
        dst_token: string;
        recipient: string;
      }) => {
        const src = chain(input.src_chain_key);
        const dst = chain(input.dst_chain_key);
        guardDestination(src, input.src_address, dst, input.recipient);
        const params = {
          srcChainKey: src,
          srcAddress: input.src_address,
          srcToken: input.src_token,
          amount: parseAmount(input.amount, "amount"),
          dstChainKey: dst,
          dstToken: input.dst_token,
          recipient: input.recipient,
        };
        const approval = await approvalPlan(
          () => sdk.bridge.isAllowanceValid({ params, raw: true }),
          () => sdk.bridge.buildApproveTxs({ params, raw: true }),
        );
        const created = unwrap(
          await sdk.bridge.createBridgeIntent({ params, raw: true }),
          "createBridgeIntent",
        ) as { tx: unknown; relayData: RelayExtraData };
        return {
          approval,
          tx: created.tx,
          relay_data: created.relayData,
          next_step: `${DESK_FLOW} Then sodax_submit kind=bridge with the full relay_data.`,
        };
      },
    },

    {
      name: "sodax_mm_markets",
      description:
        "Free. SODAX money market (Aave fork on the Sonic hub) reserves with supply/borrow rates, supplied and borrowed totals.",
      inputSchema: z.strictObject({}),
      handler: async () => ({
        assets: unwrap(await sodax.backendApi.getAllMoneyMarketAssets(), "getAllMoneyMarketAssets"),
      }),
    },

    {
      name: "sodax_mm_position",
      description:
        "Free. A spoke address's money-market position (collateral, debt per reserve). The position lives in the hub wallet derived from (chain_key, address).",
      inputSchema: z.strictObject({ chain_key: chainKeySchema, address: addressSchema }),
      handler: async (input: { chain_key: string; address: string }) => {
        const key = chain(input.chain_key);
        try {
          return {
            position: await sodax.moneyMarket.data.getUserReservesHumanized(key, input.address),
          };
        } catch (error) {
          throw new ToolError("getUserReservesHumanized failed", errorDetail(error));
        }
      },
    },

    {
      name: "sodax_build_mm_action",
      description:
        "Free, moves nothing. Builds an UNSIGNED money-market action from a desk wallet: supply, borrow, withdraw or repay. Borrow/withdraw may deliver to another chain (dst must be allowlisted). After broadcasting, call sodax_relay with notify=none.",
      inputSchema: z.strictObject({
        action: z.enum(["supply", "borrow", "withdraw", "repay"]),
        src_chain_key: chainKeySchema,
        src_address: addressSchema,
        token: addressSchema.describe(
          "Token on src chain (supply/repay) or on dst chain (borrow/withdraw)",
        ),
        amount: amountSchema,
        dst_chain_key: chainKeySchema.optional().describe("borrow/withdraw only; defaults to src"),
        dst_address: addressSchema
          .optional()
          .describe("borrow/withdraw only; defaults to src_address"),
      }),
      handler: async (input: {
        action: "supply" | "borrow" | "withdraw" | "repay";
        src_chain_key: string;
        src_address: string;
        token: string;
        amount: string;
        dst_chain_key?: string;
        dst_address?: string;
      }) => {
        const src = chain(input.src_chain_key);
        const outbound = input.action === "borrow" || input.action === "withdraw";
        if (!outbound && (input.dst_chain_key || input.dst_address)) {
          throw new ToolError(`${input.action} takes no destination`);
        }
        const dst = input.dst_chain_key ? chain(input.dst_chain_key) : src;
        const dstAddress = input.dst_address ?? input.src_address;
        if (outbound) guardDestination(src, input.src_address, dst, dstAddress);
        const params = {
          srcChainKey: src,
          srcAddress: input.src_address,
          token: input.token,
          amount: parseAmount(input.amount, "amount"),
          action: input.action,
          ...(outbound ? { dstChainKey: dst, dstAddress } : {}),
        };
        const approval = outbound
          ? undefined
          : await approvalPlan(
              () => sdk.moneyMarket.isAllowanceValid({ params }),
              () => sdk.moneyMarket.approve({ params, raw: true }),
            );
        const builders = {
          supply: "createSupplyIntent",
          borrow: "createBorrowIntent",
          withdraw: "createWithdrawIntent",
          repay: "createRepayIntent",
        } as const;
        const created = unwrap(
          await sdk.moneyMarket[builders[input.action]]({ params, raw: true }),
          builders[input.action],
        ) as { tx: unknown; relayData: RelayExtraData };
        return {
          approval: approval ? { approveTx: approval } : undefined,
          tx: created.tx,
          relay_data: created.relayData,
          next_step: `${approval ? "Broadcast approval.approveTx and wait for its receipt. " : ""}${DESK_FLOW} Then sodax_relay with notify=none and poll sodax_status kind=money_market.`,
        };
      },
    },

    {
      name: "sodax_vaults",
      description:
        "Free. Leverage-yield vaults on Sonic (looped LST positions, ERC-4626 lsoda* shares): effective APR (can be negative) and TVL. Leveraged positions carry depeg and liquidation risk.",
      inputSchema: z.strictObject({}),
      handler: async () => {
        const vaults = sodax.leverageYield.listVaults();
        return {
          vaults: await Promise.all(
            vaults.map(async (v) => {
              const [apr, total] = await Promise.all([
                sodax.leverageYield.getEffectiveApr(v.vault),
                sodax.leverageYield.getTotalAssets(v.vault),
              ]);
              return {
                ...v,
                effective_apr: apr.ok ? apr.value : { error: errorDetail(apr.error) },
                total_assets: total.ok ? total.value : { error: errorDetail(total.error) },
              };
            }),
          ),
        };
      },
    },

    {
      name: "sodax_vault_quote",
      description:
        "Free. Quote entering (any token → lsoda* shares) or exiting (shares → any token) a leverage-yield vault. Always quote vaults here, never with sodax_quote: the fees differ and a swap quote can make the intent unfillable.",
      inputSchema: z.strictObject({
        direction: z.enum(["deposit", "withdraw"]),
        vault: z.string().describe("Vault name (e.g. lsodaJITOSOL) or address"),
        chain_key: chainKeySchema.describe(
          "Chain of the token paid in (deposit) or received (withdraw)",
        ),
        token: addressSchema,
        amount: amountSchema.describe(
          "Token base units (deposit) or lsoda* shares, 18 dp (withdraw)",
        ),
      }),
      handler: async (input: {
        direction: "deposit" | "withdraw";
        vault: string;
        chain_key: string;
        token: string;
        amount: string;
      }) => {
        const key = chain(input.chain_key);
        const vault = findVault(sodax, input.vault);
        const hub = "sonic";
        const deposit = input.direction === "deposit";
        return unwrap(
          await sodax.leverageYield.getQuote({
            token_src: deposit ? input.token : vault.vault,
            token_src_blockchain_id: deposit ? key : hub,
            token_dst: deposit ? vault.vault : input.token,
            token_dst_blockchain_id: deposit ? hub : key,
            amount: parseAmount(input.amount, "amount"),
            quote_type: "exact_input",
          } as Loose),
          "vault quote",
        );
      },
    },

    {
      name: "sodax_build_vault_action",
      description:
        "Free, moves nothing. Builds an UNSIGNED leverage-yield vault deposit or withdraw intent. Shares land in the hub wallet derived from (src_chain_key, src_address); withdraw from that same desk. After broadcasting, call sodax_relay with notify=vault.",
      inputSchema: z.strictObject({
        direction: z.enum(["deposit", "withdraw"]),
        vault: z.string(),
        src_chain_key: chainKeySchema,
        src_address: addressSchema,
        token: addressSchema.describe("Input token (deposit) or output token (withdraw)"),
        amount: amountSchema.describe("Token base units (deposit) or lsoda* shares (withdraw)"),
        dst_chain_key: chainKeySchema.optional().describe("withdraw only; defaults to src"),
        recipient: addressSchema.optional().describe("withdraw only; defaults to src_address"),
        min_output_amount: amountSchema.optional(),
        slippage_bps: slippageSchema,
      }),
      handler: async (input: {
        direction: "deposit" | "withdraw";
        vault: string;
        src_chain_key: string;
        src_address: string;
        token: string;
        amount: string;
        dst_chain_key?: string;
        recipient?: string;
        min_output_amount?: string;
        slippage_bps?: number;
      }) => {
        const src = chain(input.src_chain_key);
        const vault = findVault(sodax, input.vault);
        const deposit = input.direction === "deposit";
        if (deposit && (input.dst_chain_key || input.recipient)) {
          throw new ToolError("deposit takes no destination; shares go to the desk's hub wallet");
        }
        const dst = input.dst_chain_key ? chain(input.dst_chain_key) : src;
        const recipient = input.recipient ?? input.src_address;
        if (!deposit) guardDestination(src, input.src_address, dst, recipient);
        const inputAmount = parseAmount(input.amount, "amount");
        const minOutputAmount =
          input.min_output_amount !== undefined
            ? parseAmount(input.min_output_amount, "min_output_amount")
            : (
                await quotedMin(
                  sdk.leverageYield.getQuote({
                    token_src: deposit ? input.token : vault.vault,
                    token_src_blockchain_id: deposit ? src : "sonic",
                    token_dst: deposit ? vault.vault : input.token,
                    token_dst_blockchain_id: deposit ? "sonic" : dst,
                    amount: inputAmount,
                    quote_type: "exact_input",
                  }),
                  input.slippage_bps ?? 100,
                )
              ).min;
        const payload = unwrap(
          deposit
            ? await sdk.leverageYield.deposit({
                vault: vault.vault,
                srcChainKey: src,
                srcAddress: input.src_address,
                inputToken: input.token,
                inputAmount,
                minOutputAmount,
              })
            : await sdk.leverageYield.withdraw({
                vault: vault.vault,
                srcChainKey: src,
                srcAddress: input.src_address,
                dstChainKey: dst,
                outputToken: input.token,
                inputAmount,
                minOutputAmount,
                recipient,
              }),
          input.direction,
        ) as { params: unknown };
        const approval = deposit
          ? await approvalPlan(
              () => sdk.swaps.isAllowanceValid({ params: payload.params, raw: true }),
              () => sdk.swaps.buildApproveTxs({ params: payload.params, raw: true }),
            )
          : undefined;
        const created = unwrap(
          await sdk.leverageYield.createVaultIntent({ ...payload, raw: true }),
          "createVaultIntent",
        ) as { tx: unknown; intent: unknown; relayData: RelayExtraData };
        return {
          approval,
          tx: created.tx,
          intent: created.intent,
          relay_data: created.relayData,
          next_step: `${approval ? "Broadcast the approval first. " : ""}${DESK_FLOW} Then sodax_relay with notify=vault and poll sodax_status kind=vault.`,
        };
      },
    },

    {
      name: "sodax_submit",
      description:
        "Hands an already-broadcast swap or bridge deposit to the SODAX backend, which relays it and (for swaps) notifies solvers. Idempotent on (tx_hash, src_chain_key): retry freely, never re-sign. If it keeps failing, use sodax_relay instead.",
      inputSchema: z.strictObject({
        kind: z.enum(["swap", "bridge"]),
        src_chain_key: chainKeySchema,
        tx_hash: z.string().min(1),
        wallet_address: addressSchema.describe("The desk address that signed the tx"),
        relay_data: relayDataSchema,
        intent: z.record(z.string(), z.unknown()).optional().describe("Required for kind=swap"),
      }),
      handler: async (input: {
        kind: "swap" | "bridge";
        src_chain_key: string;
        tx_hash: string;
        wallet_address: string;
        relay_data: RelayExtraData;
        intent?: Record<string, unknown>;
      }) => {
        const src = chain(input.src_chain_key);
        if (input.kind === "swap") {
          if (!input.intent)
            throw new ToolError("kind=swap requires the intent from sodax_build_swap");
          const res = unwrap(
            await sodax.api.swaps.submitTx({
              txHash: input.tx_hash,
              srcChainKey: src,
              walletAddress: input.wallet_address,
              intent: parseIntent(input.intent) as Loose,
              relayData: input.relay_data.payload,
            }),
            "swaps submit-tx",
          );
          return {
            ...res,
            next_step: "Poll sodax_status kind=swap every ~3s until solved or failed.",
          };
        }
        const res = unwrap(
          await sodax.api.bridge.submitTx({
            txHash: input.tx_hash,
            srcChainKey: src,
            walletAddress: input.wallet_address,
            relayData: input.relay_data,
          } as Loose),
          "bridge submit-tx",
        );
        return { ...res, next_step: "Poll sodax_status kind=bridge until executed or failed." };
      },
    },

    {
      name: "sodax_relay",
      description:
        "Relays an already-broadcast spoke transaction to the Sonic hub and waits for execution, then optionally notifies solvers. Required for money-market actions, vault intents and cancels; the fallback for swaps whose sodax_submit stalls. Safe to repeat: re-relaying is idempotent.",
      inputSchema: z.strictObject({
        src_chain_key: chainKeySchema,
        tx_hash: z.string().min(1),
        relay_data: relayDataSchema.optional().describe("Required for Solana and Bitcoin sources"),
        notify: z.enum(["swap", "vault", "none"]),
        timeout_ms: z.number().int().min(10_000).max(300_000).optional().describe("Default 120000"),
      }),
      handler: async (input: {
        src_chain_key: string;
        tx_hash: string;
        relay_data?: RelayExtraData;
        notify: "swap" | "vault" | "none";
        timeout_ms?: number;
      }) => {
        const src = chain(input.src_chain_key);
        if ((src === "solana" || src === "bitcoin") && !input.relay_data) {
          throw new ToolError(
            "Solana/Bitcoin commit only a hash of the relay payload on-chain; pass relay_data exactly as built",
          );
        }
        let hubTxHash = input.tx_hash;
        let packet: unknown;
        if (!isHubChainKeyType(src)) {
          packet = unwrap(
            await relayTxAndWaitPacket({
              srcTxHash: input.tx_hash,
              // Non-split chains accept any envelope; the relay ignores it for them.
              data: input.relay_data ?? { address: "0x", payload: "0x" },
              chainKey: src,
              relayerApiEndpoint: relayerUrl() as Loose,
              timeout: input.timeout_ms ?? 120_000,
            }),
            "relay",
          );
          hubTxHash = (packet as { dst_tx_hash: string }).dst_tx_hash;
        }
        let solver: unknown;
        if (input.notify === "swap") {
          solver = unwrap(
            await sodax.swaps.postExecution({ intent_tx_hash: hubTxHash as Loose }),
            "postExecution",
          );
        } else if (input.notify === "vault") {
          solver = unwrap(
            await sodax.leverageYield.notifySolver({ intent_tx_hash: hubTxHash as Loose }),
            "notifySolver",
          );
        }
        return { hub_tx_hash: hubTxHash, packet, solver };
      },
    },

    {
      name: "sodax_status",
      description:
        "Free. Status of a SODAX action by its SOURCE-chain tx hash. swap/vault: solver status (3 = solved, 4 = failed). bridge: backend record, else the relay packet. money_market: relay packet (executed = settled on the hub).",
      inputSchema: z.strictObject({
        kind: z.enum(["swap", "vault", "bridge", "money_market"]),
        src_chain_key: chainKeySchema,
        tx_hash: z.string().min(1),
      }),
      handler: async (input: {
        kind: "swap" | "vault" | "bridge" | "money_market";
        src_chain_key: string;
        tx_hash: string;
      }) => {
        const src = chain(input.src_chain_key);
        if (input.kind === "swap" || input.kind === "vault") {
          return unwrap(
            await sodax.swaps.getDetailedStatus({ srcChainKey: src, srcTxHash: input.tx_hash }),
            "status",
          );
        }
        const packets = async () => {
          const res = await getTransactionPackets(
            {
              action: "get_transaction_packets",
              params: { chain_id: relayChainId(src), tx_hash: input.tx_hash },
            } as Loose,
            relayerUrl() as Loose,
            15_000,
          );
          // The relay answers 404 until it has indexed the tx: not delivered yet, not a failure.
          if (!res.ok && /\b404\b/.test(String((res.error as Error)?.message))) {
            return { delivered: false, note: "Relay has no packet for this tx yet; keep polling." };
          }
          return unwrap(res, "relay packets");
        };
        if (input.kind === "bridge") {
          const backend = await sodax.api.bridge.getSubmitTxStatus({
            txHash: input.tx_hash,
            srcChainKey: src,
          });
          if (backend.ok) return { source: "backend", ...backend.value };
          return {
            source: "relay",
            backend_error: errorDetail(backend.error),
            ...(await packets()),
          };
        }
        return { source: "relay", ...(await packets()) };
      },
    },
  ];
}

function findVault(sodax: Sodax, nameOrAddress: string) {
  const lower = nameOrAddress.toLowerCase();
  const vault = sodax.leverageYield
    .listVaults()
    .find((v) => v.name.toLowerCase() === lower || v.vault.toLowerCase() === lower);
  if (!vault) {
    throw new ToolError(`Unknown vault "${nameOrAddress}"`, {
      vaults: sodax.leverageYield.listVaults().map((v) => v.name),
    });
  }
  return vault;
}

export function toToolPayload(value: unknown): Record<string, unknown> {
  return toJsonSafe(value) as Record<string, unknown>;
}

export function toolErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ToolError) {
    return toToolPayload({ error: error.message, detail: error.detail });
  }
  return toToolPayload({ error: error instanceof Error ? error.message : String(error) });
}
