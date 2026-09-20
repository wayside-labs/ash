import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  AGENT_SESSION_DISCRIMINATOR,
  decodeAgentSession,
  decodePolicy,
  decodeTreasury,
  findSolVaultPda,
  POLICY_DISCRIMINATOR,
} from "@agent-rails/sdk";
import {
  type Address,
  address,
  type Base58EncodedBytes,
  createSolanaRpc,
  getBase58Decoder,
  getBase64Encoder,
} from "@solana/kit";
import { isLikelyAddress, type SolanaCluster } from "@/lib/schema";

const CLUSTER_RPC_URLS: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * A custom RPC is user input reaching a server-side fetch, so it is restricted
 * to https and never allowed to point back at the host network.
 */
export function resolveRpcUrl(cluster: SolanaCluster, customRpc?: string | null): string {
  const fallback = CLUSTER_RPC_URLS[cluster];
  const candidate = customRpc?.trim();
  if (!candidate) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== "https:") return fallback;
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return blocked ? fallback : parsed.toString();
}

function rpcFor(cluster: SolanaCluster, customRpc?: string | null) {
  return createSolanaRpc(resolveRpcUrl(cluster, customRpc));
}

export type BalanceResult = { address: string; lamports: number | null; error?: string };

export async function getBalances(
  cluster: SolanaCluster,
  customRpc: string | null,
  addresses: string[],
): Promise<BalanceResult[]> {
  const rpc = rpcFor(cluster, customRpc);
  const unique = [...new Set(addresses.filter(isLikelyAddress))];
  const settled = await Promise.all(
    unique.map(async (addr): Promise<BalanceResult> => {
      try {
        const { value } = await rpc.getBalance(address(addr)).send();
        return { address: addr, lamports: Number(value) };
      } catch (error) {
        return { address: addr, lamports: null, error: describe(error) };
      }
    }),
  );
  return settled;
}

export type TreasuryView = {
  address: string;
  owner: string;
  operator: string;
  paused: boolean;
  solVaultAddress: string;
  solVaultLamports: number;
  activeSessions: number;
  policyCount: number;
  /** Owner ceilings — the outer bound every policy has to fit inside. */
  mints: MintCeilingView[];
  policies: PolicyView[];
  sessions: SessionView[];
  /** mint -> decimals, for rendering base-unit limits and counters. */
  decimals: Record<string, number>;
};

export type MintCeilingView = {
  mint: string;
  decimals: number;
  maxPerTx: string;
  maxShortWindow: string;
  maxLongWindow: string;
  maxLifetime: string;
};

export type PolicyView = {
  address: string;
  name: string;
  destinationMode: number;
  requireMemo: boolean;
  activeSessions: number;
  limits: {
    mint: string;
    perTxMax: string;
    shortWindowMax: string;
    shortWindowSeconds: number;
    longWindowMax: string;
    longWindowSeconds: number;
    lifetimeMax: string;
  }[];
};

export type SessionView = {
  address: string;
  label: string;
  sessionKey: string;
  policy: string;
  expiresAt: number;
  revoked: boolean;
  seq: string;
  spend: {
    mint: string;
    shortSpent: string;
    longSpent: string;
    lifetimeSpent: string;
    shortWindowStart: number;
  }[];
};

const base64 = getBase64Encoder();

function decodeName(bytes: ArrayLike<number>): string {
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\0+$/, "");
}

/** Offset of the `treasury` field: 8 discriminator + 1 version + 1 bump. */
const TREASURY_FIELD_OFFSET = 10n;

export async function readTreasury(
  cluster: SolanaCluster,
  customRpc: string | null,
  treasuryAddress: string,
): Promise<TreasuryView | null> {
  if (!isLikelyAddress(treasuryAddress)) return null;
  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(treasuryAddress);

  const info = await rpc.getAccountInfo(treasuryPk, { encoding: "base64" }).send();
  if (!info.value) return null;
  // An address that exists but belongs to someone else (a wallet, a token
  // account) is "not a treasury", not a decode crash.
  if (info.value.owner !== AGENT_RAILS_PROGRAM_ADDRESS) return null;

  const treasury = decodeTreasury({
    address: treasuryPk,
    data: new Uint8Array(base64.encode(info.value.data[0])),
    executable: info.value.executable,
    lamports: info.value.lamports,
    programAddress: info.value.owner,
    space: BigInt(info.value.space ?? 0),
  }).data;

  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });
  const solVaultInfo = await rpc.getBalance(solVault).send();

  const [policies, sessions] = await Promise.all([
    readPolicies(rpc, treasuryPk),
    readSessions(rpc, treasuryPk),
  ]);

  const configured: Record<string, number> = {};
  for (const config of treasury.mints.slice(0, treasury.mintCount)) {
    configured[config.mint] = config.decimals;
  }
  const referenced = [
    ...policies.flatMap((p) => p.limits.map((l) => l.mint)),
    ...sessions.flatMap((s) => s.spend.map((c) => c.mint)),
  ].filter((mint) => configured[mint] === undefined);
  const decimals = { ...configured, ...(await readDecimals(rpc, referenced)) };

  return {
    address: treasuryAddress,
    owner: treasury.owner,
    operator: treasury.operator,
    paused: treasury.paused,
    solVaultAddress: solVault,
    solVaultLamports: Number(solVaultInfo.value),
    activeSessions: treasury.activeSessions,
    policyCount: treasury.policyCount,
    mints: treasury.mints.slice(0, treasury.mintCount).map((m) => ({
      mint: m.mint,
      decimals: m.decimals,
      maxPerTx: m.ceiling.maxPerTx.toString(),
      maxShortWindow: m.ceiling.maxShortWindow.toString(),
      maxLongWindow: m.ceiling.maxLongWindow.toString(),
      maxLifetime: m.ceiling.maxLifetime.toString(),
    })),
    policies,
    sessions,
    decimals,
  };
}

type Rpc = ReturnType<typeof createSolanaRpc>;

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

const base58 = getBase58Decoder();
const POLICY_DISCRIMINATOR_B58 = base58.decode(POLICY_DISCRIMINATOR) as Base58EncodedBytes;
const SESSION_DISCRIMINATOR_B58 = base58.decode(AGENT_SESSION_DISCRIMINATOR) as Base58EncodedBytes;

async function programAccounts(rpc: Rpc, discriminator: Base58EncodedBytes, treasury: Address) {
  return rpc
    .getProgramAccounts(AGENT_RAILS_PROGRAM_ADDRESS, {
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

async function readPolicies(rpc: Rpc, treasury: Address): Promise<PolicyView[]> {
  const accounts = await programAccounts(rpc, POLICY_DISCRIMINATOR_B58, treasury);
  return accounts.map((acc) => {
    const decoded = decodePolicy({
      address: acc.pubkey,
      data: new Uint8Array(base64.encode(acc.account.data[0])),
      executable: acc.account.executable,
      lamports: acc.account.lamports,
      programAddress: acc.account.owner,
      space: BigInt(acc.account.space ?? 0),
    }).data;
    return {
      address: acc.pubkey,
      name: decodeName(decoded.name),
      destinationMode: decoded.destinationMode,
      requireMemo: decoded.requireMemo,
      activeSessions: decoded.activeSessions,
      limits: decoded.mintLimits.slice(0, decoded.mintCount).map((l) => ({
        mint: l.mint,
        perTxMax: l.perTxMax.toString(),
        shortWindowMax: l.shortWindowMax.toString(),
        shortWindowSeconds: l.shortWindowSeconds,
        longWindowMax: l.longWindowMax.toString(),
        longWindowSeconds: l.longWindowSeconds,
        lifetimeMax: l.lifetimeMax.toString(),
      })),
    };
  });
}

async function readSessions(rpc: Rpc, treasury: Address): Promise<SessionView[]> {
  const accounts = await programAccounts(rpc, SESSION_DISCRIMINATOR_B58, treasury);
  return accounts.map((acc) => {
    const decoded = decodeAgentSession({
      address: acc.pubkey,
      data: new Uint8Array(base64.encode(acc.account.data[0])),
      executable: acc.account.executable,
      lamports: acc.account.lamports,
      programAddress: acc.account.owner,
      space: BigInt(acc.account.space ?? 0),
    }).data;
    return {
      address: acc.pubkey,
      label: decodeName(decoded.label),
      sessionKey: decoded.sessionKey,
      policy: decoded.policy,
      expiresAt: Number(decoded.expiresAt),
      revoked: decoded.revoked,
      seq: decoded.seq.toString(),
      spend: decoded.spend
        .filter((s) => s.mint !== DEFAULT_PUBKEY)
        .map((s) => ({
          mint: s.mint,
          shortSpent: s.shortSpent.toString(),
          longSpent: s.longSpent.toString(),
          lifetimeSpent: s.lifetimeSpent.toString(),
          shortWindowStart: Number(s.shortWindowStart),
        })),
    };
  });
}

/**
 * Policy limits are stored in base units. Without the mint's decimals the UI
 * would print "50000000" where the user set 0.05 SOL, so resolve them once per
 * treasury read and hand the map to the client.
 */
async function readDecimals(rpc: Rpc, mints: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(mints)].filter((m) => m !== DEFAULT_PUBKEY);
  if (unique.length === 0) return {};
  try {
    const { value } = await rpc
      .getMultipleAccounts(
        unique.map((m) => address(m)),
        { encoding: "jsonParsed" },
      )
      .send();
    const out: Record<string, number> = {};
    value.forEach((account, index) => {
      const mint = unique[index];
      if (!mint) return;
      const parsed = account?.data as { parsed?: { info?: { decimals?: number } } } | undefined;
      const decimals = parsed?.parsed?.info?.decimals;
      if (typeof decimals === "number") out[mint] = decimals;
    });
    return out;
  } catch {
    return {};
  }
}

export type VaultBalance = {
  treasury: string;
  solVault: string;
  lamports: number | null;
};

/**
 * A treasury's own lamports are just its rent — the spendable SOL lives in the
 * `sol_vault` PDA. Showing the former as "the cofre balance" understates the
 * vault by orders of magnitude, so callers resolve the vault explicitly.
 */
export async function getVaultBalances(
  cluster: SolanaCluster,
  customRpc: string | null,
  treasuries: string[],
): Promise<VaultBalance[]> {
  const rpc = rpcFor(cluster, customRpc);
  const unique = [...new Set(treasuries.filter(isLikelyAddress))];

  return Promise.all(
    unique.map(async (treasury): Promise<VaultBalance> => {
      try {
        const [solVault] = await findSolVaultPda({ treasury: address(treasury) });
        const { value } = await rpc.getBalance(solVault).send();
        return { treasury, solVault, lamports: Number(value) };
      } catch {
        return { treasury, solVault: "", lamports: null };
      }
    }),
  );
}

export async function checkRpc(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const rpc = createSolanaRpc(url);
    const started = Date.now();
    const version = await rpc.getVersion().send();
    const slot = await rpc.getSlot().send();
    return {
      ok: true,
      detail: `solana-core ${version["solana-core"]} · slot ${slot} · ${Date.now() - started}ms`,
    };
  } catch (error) {
    return { ok: false, detail: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export { CLUSTER_RPC_URLS };
