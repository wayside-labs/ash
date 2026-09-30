import { type DestinationAllowlist, parseAllowlist } from "./policy.js";

export type PartnerFeeConfig = { address: `0x${string}`; percentage: number };

export type SodaxConnectorConfig = {
  apiKey?: string;
  partnerFee?: PartnerFeeConfig;
  allowlist: DestinationAllowlist;
  solanaRpcUrl?: string;
  hubRpcUrl?: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePartnerFee(env: NodeJS.ProcessEnv): PartnerFeeConfig | undefined {
  const address = nonEmpty(env.SODAX_PARTNER_FEE_ADDRESS);
  const bps = nonEmpty(env.SODAX_PARTNER_FEE_BPS);
  if (!address && !bps) return undefined;
  if (!address || !bps) {
    throw new Error("SODAX_PARTNER_FEE_ADDRESS and SODAX_PARTNER_FEE_BPS must be set together");
  }
  // Fees accrue on the Sonic hub, so the receiver is always an EVM address.
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("SODAX_PARTNER_FEE_ADDRESS must be a 0x… Sonic address");
  }
  const percentage = Number(bps);
  if (!Number.isInteger(percentage) || percentage < 1 || percentage > 1000) {
    throw new Error("SODAX_PARTNER_FEE_BPS must be an integer from 1 to 1000 (0.01%–10%)");
  }
  return { address: address as `0x${string}`, percentage };
}

export function readSodaxConfig(env: NodeJS.ProcessEnv = process.env): SodaxConnectorConfig {
  const config: SodaxConnectorConfig = {
    allowlist: parseAllowlist(env.SODAX_ALLOWED_DESTINATIONS),
  };
  const apiKey = nonEmpty(env.SODAX_API_KEY);
  if (apiKey) config.apiKey = apiKey;
  const partnerFee = parsePartnerFee(env);
  if (partnerFee) config.partnerFee = partnerFee;
  const solanaRpcUrl = nonEmpty(env.SODAX_SOLANA_RPC_URL);
  if (solanaRpcUrl) config.solanaRpcUrl = solanaRpcUrl;
  const hubRpcUrl = nonEmpty(env.SODAX_HUB_RPC_URL);
  if (hubRpcUrl) config.hubRpcUrl = hubRpcUrl;
  return config;
}
