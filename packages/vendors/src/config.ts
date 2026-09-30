import { homedir } from "node:os";
import { join } from "node:path";
import { toBaseUnits } from "@agent-rails/contract";
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { type Address, address } from "@solana/kit";

export const VENDOR_IDS = ["oracle", "notary", "compute"] as const;
export type VendorId = (typeof VENDOR_IDS)[number];

export function isVendorId(value: string): value is VendorId {
  return (VENDOR_IDS as readonly string[]).includes(value);
}

export const DEFAULT_PORTS: Record<VendorId, number> = {
  oracle: 4101,
  notary: 4102,
  compute: 4103,
};

/** Human units in the vendor's mint. Devnet-sized on purpose: a tick costs less than a fee. */
const DEFAULT_PRICES: Record<VendorId, string> = {
  oracle: "0.0001",
  notary: "0.0005",
  compute: "0.001",
};

export type VendorConfig = {
  id: VendorId;
  port: number;
  host: string;
  rpcUrl: string;
  /**
   * Where payments land. Only the public key: receiving needs no signature, so a vendor
   * process holds no secret and a compromised vendor box cannot move what it earned.
   */
  payTo: Address;
  mint: Address;
  mintSymbol: string;
  decimals: number;
  /** Price of one unit (one quote, one document, one credit pack) in base units. */
  unitPrice: bigint;
  unitPriceHuman: string;
  /** Label the operator is expected to allowlist `payTo` under. A hint; the chain decides. */
  destinationLabel: string;
  dataDir: string;
  invoiceTtlSeconds: number;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function agentRailsHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_RAILS_HOME ?? join(homedir(), ".agent-rails");
}

/**
 * Every knob is per vendor (`ORACLE_PAY_TO`, `NOTARY_PRICE`, …) so the three can run from one
 * environment file on one box, or split across boxes, without a config format of their own.
 */
export function loadVendorConfig(
  id: VendorId,
  env: NodeJS.ProcessEnv = process.env,
  overrides: { port?: number } = {},
): VendorConfig {
  const prefix = id.toUpperCase();
  const mint = env[`${prefix}_MINT`] ?? env.VENDOR_MINT ?? NATIVE_MINT;
  const native = mint === NATIVE_MINT;
  const decimals = Number(env[`${prefix}_DECIMALS`] ?? env.VENDOR_DECIMALS ?? (native ? 9 : 6));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`${prefix}_DECIMALS must be an integer between 0 and 18`);
  }
  const unitPriceHuman = env[`${prefix}_PRICE`] ?? DEFAULT_PRICES[id];
  const unitPrice = toBaseUnits(unitPriceHuman, decimals);
  if (unitPrice <= 0n) throw new Error(`${prefix}_PRICE must be greater than zero`);

  const ttl = Number(env.VENDOR_INVOICE_TTL_SECONDS ?? 900);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) {
    throw new Error("VENDOR_INVOICE_TTL_SECONDS must be between 60 and 86400");
  }

  return {
    id,
    port: overrides.port ?? Number(env[`${prefix}_PORT`] ?? DEFAULT_PORTS[id]),
    host: env.VENDOR_HOST ?? "127.0.0.1",
    rpcUrl: env.AGENT_RAILS_RPC ?? env.VENDOR_RPC ?? "https://api.devnet.solana.com",
    payTo: address(required(env, `${prefix}_PAY_TO`)),
    mint: address(mint),
    mintSymbol: env[`${prefix}_MINT_SYMBOL`] ?? (native ? "SOL" : "USDC"),
    decimals,
    unitPrice,
    unitPriceHuman,
    destinationLabel: env[`${prefix}_DESTINATION_LABEL`] ?? `vendor-${id}`,
    // Always one directory per vendor: three processes sharing one state file would each
    // overwrite the others' invoices on every save.
    dataDir: join(env.VENDOR_DATA_DIR ?? join(agentRailsHome(env), "vendors"), id),
    invoiceTtlSeconds: ttl,
  };
}
