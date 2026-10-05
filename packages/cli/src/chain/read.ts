import {
  AGENT_SESSION_DISCRIMINATOR,
  ASH_PROGRAM_ADDRESS,
  decodeAgentSession,
  decodePolicy,
  decodeTreasury,
  fetchMaybePolicy,
  findSolVaultPda,
  POLICY_DISCRIMINATOR,
  type Policy,
  type Treasury,
} from "@ash/client";
import { NATIVE_MINT } from "@ash/contract";
import { loadDestinationIndex } from "@ash/sdk";
import {
  type Address,
  address,
  type Base58EncodedBytes,
  getBase58Decoder,
  getBase64Encoder,
} from "@solana/kit";
import { decodeFixedName } from "../names.js";
import type { Rpc } from "../rpc.js";
import { tokenBalance } from "../token.js";

const base64 = getBase64Encoder();
const base58 = getBase58Decoder();
const POLICY_DISCRIMINATOR_B58 = base58.decode(POLICY_DISCRIMINATOR) as Base58EncodedBytes;
const SESSION_DISCRIMINATOR_B58 = base58.decode(AGENT_SESSION_DISCRIMINATOR) as Base58EncodedBytes;
const TREASURY_FIELD_OFFSET = 10n;
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

export type MintCeilingView = {
  mint: Address;
  symbol: string;
  decimals: number;
  maxPerTx: bigint;
  maxShortWindow: bigint;
  maxLongWindow: bigint;
  maxLifetime: bigint;
  minShortWindowSeconds: number;
  minLongWindowSeconds: number;
  vaultBalance: bigint;
  vaultAta?: Address;
};

export type PolicyLimitView = {
  mint: Address;
  symbol: string;
  decimals: number;
  perTxMax: bigint;
  shortWindowMax: bigint;
  shortWindowSeconds: number;
  longWindowMax: bigint;
  longWindowSeconds: number;
  lifetimeMax: bigint;
};

export type SessionView = {
  address: Address;
  label: string;
  sessionKey: Address;
  policy: Address;
  expiresAt: number;
  revoked: boolean;
  seq: bigint;
  live: boolean;
};

export type TreasurySnapshot = {
  treasury: Address;
  solVault: Address;
  solVaultLamports: bigint;
  treasuryAccount: Treasury;
  ceilings: MintCeilingView[];
  policy?: Policy;
  policyLimits: PolicyLimitView[];
  sessions: SessionView[];
  destinations: { label: string; owner: Address; entry: Address }[];
};

async function programAccounts(rpc: Rpc, discriminator: Base58EncodedBytes, treasury: Address) {
  return rpc
    .getProgramAccounts(ASH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
        {
          memcmp: {
            offset: TREASURY_FIELD_OFFSET,
            bytes: treasury as string as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send();
}

function mintSymbol(mint: Address): string {
  return mint === address(NATIVE_MINT) ? "SOL" : mint.slice(0, 4);
}

export async function readTreasurySnapshot(
  rpc: Rpc,
  treasury: Address,
  policy: Address,
): Promise<TreasurySnapshot> {
  const info = await rpc.getAccountInfo(treasury, { encoding: "base64" }).send();
  if (!info.value || info.value.owner !== ASH_PROGRAM_ADDRESS) {
    throw new Error(`No treasury at ${treasury}`);
  }

  const treasuryAccount = decodeTreasury({
    address: treasury,
    data: new Uint8Array(base64.encode(info.value.data[0])),
    executable: info.value.executable,
    lamports: info.value.lamports,
    programAddress: info.value.owner,
    space: BigInt(info.value.space ?? 0),
  }).data;

  const [solVault] = await findSolVaultPda({ treasury });
  const solVaultLamports = BigInt((await rpc.getBalance(solVault).send()).value);

  const ceilings: MintCeilingView[] = [];
  for (const config of treasuryAccount.mints.slice(0, treasuryAccount.mintCount)) {
    const symbol = mintSymbol(config.mint);
    let vaultBalance = 0n;
    let vaultAta: Address | undefined;
    if (config.mint === address(NATIVE_MINT)) {
      vaultBalance = solVaultLamports;
    } else {
      const [ata] = await import("@ash/sdk").then((sdk) =>
        sdk.findAssociatedTokenAddress({
          owner: treasury,
          mint: config.mint,
          tokenProgram: config.tokenProgram,
        }),
      );
      vaultAta = ata;
      vaultBalance = await tokenBalance(rpc, ata);
    }
    ceilings.push({
      mint: config.mint,
      symbol,
      decimals: config.decimals,
      maxPerTx: config.ceiling.maxPerTx,
      maxShortWindow: config.ceiling.maxShortWindow,
      maxLongWindow: config.ceiling.maxLongWindow,
      maxLifetime: config.ceiling.maxLifetime,
      minShortWindowSeconds: config.ceiling.minShortWindowSeconds,
      minLongWindowSeconds: config.ceiling.minLongWindowSeconds,
      vaultBalance,
      ...(vaultAta ? { vaultAta } : {}),
    });
  }

  const policyAccount = await fetchMaybePolicy(rpc, policy, { commitment: "confirmed" });
  let policyData: Policy | undefined;
  const policyLimits: PolicyLimitView[] = [];
  if (policyAccount.exists) {
    policyData = policyAccount.data;
    for (const limit of policyData.mintLimits.slice(0, policyData.mintCount)) {
      const ceiling = ceilings.find((c) => c.mint === limit.mint);
      policyLimits.push({
        mint: limit.mint,
        symbol: ceiling?.symbol ?? mintSymbol(limit.mint),
        decimals: ceiling?.decimals ?? (limit.mint === address(NATIVE_MINT) ? 9 : 0),
        perTxMax: limit.perTxMax,
        shortWindowMax: limit.shortWindowMax,
        shortWindowSeconds: limit.shortWindowSeconds,
        longWindowMax: limit.longWindowMax,
        longWindowSeconds: limit.longWindowSeconds,
        lifetimeMax: limit.lifetimeMax,
      });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionAccounts = await programAccounts(rpc, SESSION_DISCRIMINATOR_B58, treasury);
  const sessions: SessionView[] = sessionAccounts.map((acc) => {
    const decoded = decodeAgentSession({
      address: acc.pubkey,
      data: new Uint8Array(base64.encode(acc.account.data[0])),
      executable: acc.account.executable,
      lamports: acc.account.lamports,
      programAddress: acc.account.owner,
      space: BigInt(acc.account.space ?? 0),
    }).data;
    const expiresAt = Number(decoded.expiresAt);
    return {
      address: acc.pubkey,
      label: decodeFixedName(decoded.label),
      sessionKey: decoded.sessionKey,
      policy: decoded.policy,
      expiresAt,
      revoked: decoded.revoked,
      seq: decoded.seq,
      live: !decoded.revoked && expiresAt > now,
    };
  });

  const destIndex = await loadDestinationIndex({
    rpc: rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy,
  });
  const destinations = destIndex.entries.map((entry) => ({
    label: entry.label,
    owner: entry.owner,
    entry: entry.entry,
  }));

  return {
    treasury,
    solVault,
    solVaultLamports,
    treasuryAccount,
    ceilings,
    ...(policyData ? { policy: policyData } : {}),
    policyLimits,
    sessions,
    destinations,
  };
}

export async function readPolicies(rpc: Rpc, treasury: Address): Promise<Policy[]> {
  const accounts = await programAccounts(rpc, POLICY_DISCRIMINATOR_B58, treasury);
  return accounts.map(
    (acc) =>
      decodePolicy({
        address: acc.pubkey,
        data: new Uint8Array(base64.encode(acc.account.data[0])),
        executable: acc.account.executable,
        lamports: acc.account.lamports,
        programAddress: acc.account.owner,
        space: BigInt(acc.account.space ?? 0),
      }).data,
  );
}

export { DEFAULT_PUBKEY };
