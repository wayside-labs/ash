import {
  AUTH_MODE_DIRECT_SIGNER,
  MAX_SESSION_TTL_SECONDS,
  MIN_WINDOW_SECONDS,
} from "@agent-rails/contract";
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { knownMintSymbol } from "@agent-rails/contract/mints";
import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  AGENT_SESSION_DISCRIMINATOR,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  decodeAgentSession,
  decodePolicy,
  decodeTreasury,
  FundingMode,
  fetchMaybeAgentSession,
  findAssociatedTokenAddress,
  findEventAuthorityPda,
  findPolicyPda,
  findSessionPda,
  findSolVaultPda,
  getCreateSessionInstruction,
  getWithdrawInstruction,
  getWithdrawInstructionAsync,
  loadDestinationIndex,
  POLICY_DISCRIMINATOR,
} from "@agent-rails/sdk";
import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  type Base58EncodedBytes,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { isLikelyAddress, type SolanaCluster } from "@/lib/schema";
import { encodeFixedName } from "@/lib/server/fixed-name";

const CLUSTER_RPC_URLS: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Decimals of the native-SOL sentinel, for a treasury that never added a slot for it. */
const SOL_DECIMALS = 9;

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

export function rpcFor(cluster: SolanaCluster, customRpc?: string | null) {
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
  /**
   * Head of the session's audit hash chain (spec §6), hex.
   *
   * Read but not verified here: verifying means replaying `PaymentExecuted`
   * through `next_audit_head` and comparing the terminus, which needs event
   * history. Showing the recorded head is still worth doing — it is the value a
   * replay will be checked against.
   */
  auditHead: string;
  spend: {
    mint: string;
    shortSpent: string;
    longSpent: string;
    lifetimeSpent: string;
    shortWindowStart: number;
  }[];
};

const base64 = getBase64Encoder();

/** Fixed-width byte field to lowercase hex, for the audit head. */
function hex(bytes: ArrayLike<number>): string {
  return Array.from(Uint8Array.from(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeName(bytes: ArrayLike<number>): string {
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\0+$/, "");
}

/** Offset of the `treasury` field: 8 discriminator + 1 version + 1 bump. */
const TREASURY_FIELD_OFFSET = 10n;

/**
 * Decodes one `Treasury`, or null when the address holds something else. An
 * address that exists but belongs to a wallet or a token account is "not a
 * treasury", not a decode crash.
 */
export async function fetchTreasury(rpc: Rpc, treasuryPk: Address) {
  const info = await rpc.getAccountInfo(treasuryPk, { encoding: "base64" }).send();
  if (!info.value || info.value.owner !== AGENT_RAILS_PROGRAM_ADDRESS) return null;
  return decodeTreasury({
    address: treasuryPk,
    data: new Uint8Array(base64.encode(info.value.data[0])),
    executable: info.value.executable,
    lamports: info.value.lamports,
    programAddress: info.value.owner,
    space: BigInt(info.value.space ?? 0),
  }).data;
}

export async function readTreasury(
  cluster: SolanaCluster,
  customRpc: string | null,
  treasuryAddress: string,
): Promise<TreasuryView | null> {
  if (!isLikelyAddress(treasuryAddress)) return null;
  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(treasuryAddress);

  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) return null;

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

export type Rpc = ReturnType<typeof createSolanaRpc>;

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
      auditHead: hex(decoded.auditHead),
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
 * Every allowlist entry for a policy — the roster behind the Metrics page's
 * destination list.
 *
 * Wraps the SDK's reader rather than reimplementing the memcmp, and lives here
 * rather than in the route so `rpcFor`'s custom-RPC allowlist stays the only way
 * this process opens a connection.
 */
export type DestinationEntryView = {
  label: string;
  normalizedLabel: string;
  owner: string;
  entry: string;
  /** Base units; "0" means this destination has no override of its own. */
  perTxMaxOverride: string;
};

export async function readDestinations(
  cluster: SolanaCluster,
  customRpc: string | null,
  policy: string,
): Promise<DestinationEntryView[]> {
  if (!isLikelyAddress(policy)) return [];
  const rpc = rpcFor(cluster, customRpc);
  const index = await loadDestinationIndex({
    rpc: rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: address(policy),
  });
  return index.entries.map((entry) => ({
    label: entry.label,
    normalizedLabel: entry.normalizedLabel,
    owner: entry.owner,
    entry: entry.entry,
    perTxMaxOverride: entry.perTxMaxOverride.toString(),
  }));
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

/** One asset the treasury holds: a configured mint's vault ATA, or `sol_vault`. */
export type VaultAssetBalance = {
  mint: string;
  /** Ticker when we ship one for this address, else null — the UI truncates. */
  symbol: string | null;
  decimals: number;
  tokenProgram: string;
  /** The vault ATA, or the `sol_vault` PDA for the native sentinel. */
  vault: string;
  /** Base units as a decimal string: a u64 does not survive JSON as a number. */
  amount: string;
  /** False when the vault ATA was never created; `amount` is then "0". */
  exists: boolean;
  /**
   * ADR-014. Under `native-allowance` the funds sit in the owner's wallet and
   * the vault ATA is not where payments are drawn from, so a zero here is
   * expected rather than a treasury that needs topping up.
   */
  fundingMode: "isolated-vault" | "native-allowance";
  /** True when the owner configured this mint; false for the synthesized SOL row. */
  configured: boolean;
};

export type VaultBalance = {
  treasury: string;
  solVault: string;
  lamports: number | null;
  /** On-chain owner, not the address the workflow row claims. Gates withdraw. */
  owner: string | null;
  /** Every mint the owner configured, plus native SOL, which always exists. */
  assets: VaultAssetBalance[];
};

/** What the connected wallet holds of a mint — the deposit dialog's honest "max". */
export type OwnerTokenBalance = {
  mint: string;
  ata: string;
  amount: string;
  exists: boolean;
};

export type VaultBalances = {
  vaults: VaultBalance[];
  /**
   * `Rent::minimum_balance(0)` for this cluster. `withdraw` refuses to take the
   * vault below it, so the UI has to subtract it to offer an honest "max".
   */
  rentExemptMinimum: number;
  /** Token accounts of the wallet named in the request, for the mints above. */
  ownerTokens: OwnerTokenBalance[];
};

type TokenAccountAmounts = Map<string, { amount: string; exists: boolean }>;

/** `getMultipleAccounts` caps at 100 addresses per call. */
const ACCOUNTS_PER_CALL = 100;

/**
 * Reads token-account amounts in as few round trips as possible. An address
 * that holds nothing and an address that was never created are different
 * states: the first is a vault waiting for a deposit, the second is a vault the
 * deposit has to open first.
 */
async function readTokenAmounts(rpc: Rpc, accounts: string[]): Promise<TokenAccountAmounts> {
  const out: TokenAccountAmounts = new Map();
  const unique = [...new Set(accounts)];
  for (let i = 0; i < unique.length; i += ACCOUNTS_PER_CALL) {
    const chunk = unique.slice(i, i + ACCOUNTS_PER_CALL);
    try {
      const { value } = await rpc
        .getMultipleAccounts(
          chunk.map((a) => address(a)),
          { encoding: "jsonParsed" },
        )
        .send();
      value.forEach((account, index) => {
        const key = chunk[index];
        if (!key) return;
        if (!account) {
          out.set(key, { amount: "0", exists: false });
          return;
        }
        const parsed = account.data as
          | { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
          | undefined;
        const amount = parsed?.parsed?.info?.tokenAmount?.amount;
        // An account the RPC could not parse comes back in the base64 array
        // form. Leaving it out collapses it into the "not created yet" state,
        // where a deposit prepends an idempotent ATA create that no-ops and a
        // withdraw offers nothing — both safe. Recording it as an existing
        // zero balance would instead assert an empty vault on the strength of
        // a shape we did not recognise.
        if (typeof amount !== "string") return;
        out.set(key, { amount, exists: true });
      });
    } catch {
      // A failed chunk leaves its accounts unresolved rather than reporting zero,
      // which the callers render as "—" instead of an empty vault.
    }
  }
  return out;
}

type PlannedAsset = Omit<VaultAssetBalance, "amount" | "exists">;

/** The mints a treasury can hold: what the owner configured, plus native SOL. */
async function planAssets(
  treasury: Address,
  solVault: Address,
  decoded: Awaited<ReturnType<typeof fetchTreasury>>,
): Promise<PlannedAsset[]> {
  const configs = decoded ? decoded.mints.slice(0, decoded.mintCount) : [];
  const assets: PlannedAsset[] = [];

  for (const config of configs) {
    const fundingMode: VaultAssetBalance["fundingMode"] =
      config.fundingMode === FundingMode.NativeAllowance ? "native-allowance" : "isolated-vault";
    if (config.mint === NATIVE_MINT) {
      assets.push({
        mint: NATIVE_MINT,
        symbol: knownMintSymbol(NATIVE_MINT),
        decimals: config.decimals,
        tokenProgram: config.tokenProgram,
        vault: solVault,
        fundingMode,
        configured: true,
      });
      continue;
    }
    const [vaultAta] = await findAssociatedTokenAddress({
      owner: treasury,
      mint: address(config.mint),
      tokenProgram: address(config.tokenProgram),
    });
    assets.push({
      mint: config.mint,
      symbol: knownMintSymbol(config.mint),
      decimals: config.decimals,
      tokenProgram: config.tokenProgram,
      vault: vaultAta,
      fundingMode,
      configured: true,
    });
  }

  // `sol_vault` accepts permissionless deposits from the moment the treasury
  // exists and `withdraw` never consults `Treasury.mints`, so SOL is spendable
  // whether or not a slot was ever added for it. A treasury bootstrapped with
  // `init --mint <usdc>` alone would otherwise lose its SOL row entirely.
  if (!assets.some((a) => a.mint === NATIVE_MINT)) {
    assets.unshift({
      mint: NATIVE_MINT,
      symbol: knownMintSymbol(NATIVE_MINT),
      decimals: SOL_DECIMALS,
      tokenProgram: DEFAULT_PUBKEY,
      vault: solVault,
      fundingMode: "isolated-vault",
      configured: false,
    });
  }

  return assets;
}

/**
 * A treasury's own lamports are just its rent — the spendable SOL lives in the
 * `sol_vault` PDA, and every other asset lives in a vault ATA the treasury PDA
 * owns. Showing the treasury account's balance as "the vault" understates it by
 * orders of magnitude, so callers resolve each vault explicitly.
 */
export async function getVaultBalances(
  cluster: SolanaCluster,
  customRpc: string | null,
  treasuries: string[],
  owner?: string | null,
): Promise<VaultBalances> {
  const rpc = rpcFor(cluster, customRpc);
  const unique = [...new Set(treasuries.filter(isLikelyAddress))];

  const [planned, rentExemptMinimum] = await Promise.all([
    Promise.all(
      unique.map(async (treasury) => {
        try {
          const treasuryPk = address(treasury);
          const [solVault] = await findSolVaultPda({ treasury: treasuryPk });
          const [{ value }, decoded] = await Promise.all([
            rpc.getBalance(solVault).send(),
            fetchTreasury(rpc, treasuryPk),
          ]);
          return {
            treasury,
            solVault: solVault as string,
            lamports: Number(value),
            owner: decoded?.owner ?? null,
            assets: await planAssets(treasuryPk, solVault, decoded),
          };
        } catch {
          return {
            treasury,
            solVault: "",
            lamports: null,
            owner: null,
            assets: [] as PlannedAsset[],
          };
        }
      }),
    ),
    getRentExemptMinimum(rpc),
  ]);

  // The wallet's own account for each mint any of these treasuries holds. Read
  // in the same pass so the deposit dialog never has to open a second request
  // on a different refresh clock than the vault it is depositing into.
  const ownerMints = ownerTokenMints(planned);
  const ownerAtas = isLikelyAddress(owner ?? null)
    ? await Promise.all(
        ownerMints.map(async ({ mint, tokenProgram }) => {
          const [ata] = await findAssociatedTokenAddress({
            owner: address(owner as string),
            mint: address(mint),
            tokenProgram: address(tokenProgram),
          });
          return { mint, ata: ata as string };
        }),
      )
    : [];

  const amounts = await readTokenAmounts(rpc, [
    ...planned.flatMap((v) => v.assets.filter((a) => a.mint !== NATIVE_MINT).map((a) => a.vault)),
    ...ownerAtas.map((o) => o.ata),
  ]);

  const vaults: VaultBalance[] = planned.map((vault) => ({
    treasury: vault.treasury,
    solVault: vault.solVault,
    lamports: vault.lamports,
    owner: vault.owner,
    assets: vault.assets.map((asset) => {
      if (asset.mint === NATIVE_MINT) {
        return {
          ...asset,
          amount: vault.lamports === null ? "0" : String(vault.lamports),
          exists: vault.lamports !== null,
        };
      }
      const read = amounts.get(asset.vault);
      return { ...asset, amount: read?.amount ?? "0", exists: read?.exists ?? false };
    }),
  }));

  const ownerTokens: OwnerTokenBalance[] = ownerAtas.map(({ mint, ata }) => {
    const read = amounts.get(ata);
    return { mint, ata, amount: read?.amount ?? "0", exists: read?.exists ?? false };
  });

  return { vaults, rentExemptMinimum, ownerTokens };
}

/** Distinct non-native mints across every treasury, with their token program. */
function ownerTokenMints(
  planned: { assets: PlannedAsset[] }[],
): { mint: string; tokenProgram: string }[] {
  const seen = new Map<string, string>();
  for (const vault of planned) {
    for (const asset of vault.assets) {
      if (asset.mint === NATIVE_MINT) continue;
      if (!seen.has(asset.mint)) seen.set(asset.mint, asset.tokenProgram);
    }
  }
  return [...seen].map(([mint, tokenProgram]) => ({ mint, tokenProgram }));
}

/** Constant per cluster in practice, but read rather than hardcoded. */
async function getRentExemptMinimum(rpc: Rpc): Promise<number> {
  try {
    return Number(await rpc.getMinimumBalanceForRentExemption(0n).send());
  } catch {
    return 890_880;
  }
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

// ---------------------------------------------------------------------------
// Writes. The server only ever *builds* — it holds no key and never signs. It
// hands back an unsigned wire transaction the browser wallet signs and sends,
// which keeps the RPC allowlist in `resolveRpcUrl` on the one side of the wire
// that can enforce it.
// ---------------------------------------------------------------------------

/** Carries an i18n key so the route can translate without re-parsing a message. */
export class SolanaRequestError extends Error {
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "SolanaRequestError";
  }
}

const SYSTEM_PROGRAM_ADDRESS = address(DEFAULT_PUBKEY);

/**
 * System program `Transfer`: a u32 LE instruction index of 2 followed by the
 * lamport amount as u64 LE. Hand-rolled rather than adding
 * `@solana-program/system` as a dependency for twelve bytes.
 */
function transferSolInstruction(
  source: Address,
  destination: Address,
  amount: bigint,
): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: source, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * SPL Token / Token-2022 `TransferChecked` (instruction 12).
 *
 * Hand-rolled for the same reason the System transfer above is: ten bytes of
 * fixed, consensus-stable layout against a dependency whose other ninety per
 * cent this dashboard never calls. `TransferChecked` rather than `Transfer` so
 * the mint and its decimals are asserted by the token program — a deposit that
 * lands a thousandfold off because the decimals were guessed is exactly the
 * class of mistake nothing downstream would catch.
 */
function transferCheckedInstruction(input: {
  source: Address;
  mint: Address;
  destination: Address;
  authority: Address;
  amount: bigint;
  decimals: number;
  tokenProgram: Address;
}): Instruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, input.amount, true);
  data[9] = input.decimals;
  return {
    programAddress: input.tokenProgram,
    accounts: [
      { address: input.source, role: AccountRole.WRITABLE },
      { address: input.mint, role: AccountRole.READONLY },
      { address: input.destination, role: AccountRole.WRITABLE },
      { address: input.authority, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

/**
 * Associated Token Account `CreateIdempotent` (instruction 1).
 *
 * Permissionless — anyone may open anyone's associated token account — and
 * idempotent, so it is safe to prepend whenever the account might be missing
 * without a read-then-write race deciding whether the transaction lands.
 */
function createAtaIdempotentInstruction(input: {
  payer: Address;
  owner: Address;
  mint: Address;
  ata: Address;
  tokenProgram: Address;
}): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.ata, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: input.tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

export type VaultTransferKind = "deposit" | "withdraw";

export type VaultTransferRequest = {
  kind: VaultTransferKind;
  treasury: string;
  /** The connected wallet: fee payer, and source (deposit) or destination (withdraw). */
  wallet: string;
  /** The mint being moved. The native sentinel takes the `sol_vault` path. */
  mint: string;
  /** Base units of `mint` — lamports when native. */
  amount: bigint;
};

export type BuiltTransaction = {
  /** Base64 wire transaction with empty signature slots, for the wallet to sign. */
  transaction: string;
  /** Where the funds land or come from: `sol_vault`, or the mint's vault ATA. */
  vault: string;
  lastValidBlockHeight: number;
};

export async function buildVaultTransfer(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: VaultTransferRequest,
): Promise<BuiltTransaction> {
  if (!isLikelyAddress(req.treasury) || !isLikelyAddress(req.wallet)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.mint !== NATIVE_MINT && !isLikelyAddress(req.mint)) {
    throw new SolanaRequestError("api.error.invalidMint");
  }
  if (req.amount <= 0n) throw new SolanaRequestError("api.error.amountMustBePositive");

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });

  const { instructions, vault } =
    req.mint === NATIVE_MINT
      ? {
          instructions: [
            req.kind === "deposit"
              ? transferSolInstruction(walletPk, solVault, req.amount)
              : await buildSolWithdrawInstruction(rpc, treasuryPk, walletPk, req.amount),
          ],
          vault: solVault as string,
        }
      : await buildTokenTransfer(rpc, {
          kind: req.kind,
          treasury: treasuryPk,
          wallet: walletPk,
          mint: address(req.mint),
          amount: req.amount,
        });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(walletPk, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    vault,
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

/**
 * The program rejects a non-owner anyway, but checking here turns an opaque
 * simulation failure into a sentence the dashboard can render. Pause is
 * deliberately *not* consulted: owner withdrawal keeps working while paused.
 */
async function buildSolWithdrawInstruction(
  rpc: Rpc,
  treasuryPk: Address,
  walletPk: Address,
  amount: bigint,
): Promise<Instruction> {
  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (treasury.owner !== walletPk) throw new SolanaRequestError("api.error.notTreasuryOwner");

  const [eventAuthority] = await findEventAuthorityPda();
  return getWithdrawInstructionAsync({
    // The wallet signs in the browser; the server only needs the account meta.
    owner: createNoopSigner(walletPk),
    treasury: treasuryPk,
    mint: address(NATIVE_MINT),
    destination: walletPk,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    amount,
  });
}

/** SPL `Mint`: the base layout Token-2022 also starts with. */
const MINT_ACCOUNT_SIZE = 82;
const MINT_DECIMALS_OFFSET = 44;

type MintMeta = {
  tokenProgram: Address;
  decimals: number;
  fundingMode: "isolated-vault" | "native-allowance";
  configured: boolean;
};

/**
 * Where a mint's decimals and token program come from.
 *
 * The owner-configured `MintConfig` wins, because that is what the payment path
 * asserts against. Falling back to the mint account matters only for withdraw:
 * `withdraw` deliberately never consults `Treasury.mints` (see `withdraw.rs`),
 * so an owner can always reach funds in a vault whose slot was removed — and a
 * UI that refused to build that transaction would trap them.
 */
async function resolveMintMeta(
  rpc: Rpc,
  treasury: NonNullable<Awaited<ReturnType<typeof fetchTreasury>>>,
  mint: Address,
): Promise<MintMeta> {
  const config = treasury.mints
    .slice(0, treasury.mintCount)
    .find((candidate) => candidate.mint === mint);
  if (config) {
    return {
      tokenProgram: address(config.tokenProgram),
      decimals: config.decimals,
      fundingMode:
        config.fundingMode === FundingMode.NativeAllowance ? "native-allowance" : "isolated-vault",
      configured: true,
    };
  }

  const { value } = await rpc.getAccountInfo(mint, { encoding: "base64" }).send();
  if (!value) throw new SolanaRequestError("api.error.mintNotFound");
  const data = new Uint8Array(base64.encode(value.data[0]));
  const decimals = data.length >= MINT_ACCOUNT_SIZE ? data[MINT_DECIMALS_OFFSET] : undefined;
  if (decimals === undefined) throw new SolanaRequestError("api.error.invalidMint");
  return {
    tokenProgram: value.owner as Address,
    decimals,
    fundingMode: "isolated-vault",
    configured: false,
  };
}

/** Whether an account exists on chain — an uncreated ATA is not a zero balance. */
async function accountExists(rpc: Rpc, account: Address): Promise<boolean> {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  return value !== null;
}

async function buildTokenTransfer(
  rpc: Rpc,
  input: {
    kind: VaultTransferKind;
    treasury: Address;
    wallet: Address;
    mint: Address;
    amount: bigint;
  },
): Promise<{ instructions: Instruction[]; vault: string }> {
  const treasury = await fetchTreasury(rpc, input.treasury);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (input.kind === "withdraw" && treasury.owner !== input.wallet) {
    throw new SolanaRequestError("api.error.notTreasuryOwner");
  }

  const meta = await resolveMintMeta(rpc, treasury, input.mint);
  const [vaultAta] = await findAssociatedTokenAddress({
    owner: input.treasury,
    mint: input.mint,
    tokenProgram: meta.tokenProgram,
  });
  const [walletAta] = await findAssociatedTokenAddress({
    owner: input.wallet,
    mint: input.mint,
    tokenProgram: meta.tokenProgram,
  });

  const instructions =
    input.kind === "deposit"
      ? await buildTokenDeposit(rpc, input, meta, vaultAta, walletAta)
      : await buildTokenWithdraw(rpc, input, meta, vaultAta, walletAta);

  return { instructions, vault: vaultAta };
}

async function buildTokenDeposit(
  rpc: Rpc,
  input: { treasury: Address; wallet: Address; mint: Address; amount: bigint },
  meta: MintMeta,
  vaultAta: Address,
  walletAta: Address,
): Promise<Instruction[]> {
  // A deposit into a mint the treasury never added is money the agent path
  // cannot spend: `execute_payment` asserts the `MintConfig`, so the funds
  // would sit there reachable only by `withdraw`. The owner adds the mint with
  // `agent-rails init --mint <mint>` first.
  if (!meta.configured) throw new SolanaRequestError("api.error.mintNotConfigured");
  // ADR-014: under a native allowance the payment path pulls from the owner's
  // own wallet, so the vault ATA is not the account that funds anything.
  if (meta.fundingMode === "native-allowance") {
    throw new SolanaRequestError("api.error.mintNativeAllowance");
  }

  const [hasWalletAta, hasVaultAta] = await Promise.all([
    accountExists(rpc, walletAta),
    accountExists(rpc, vaultAta),
  ]);
  if (!hasWalletAta) throw new SolanaRequestError("api.error.noTokenAccount");

  const instructions: Instruction[] = [];
  // `add_mint` opens the vault ATA, but a treasury restored from an older setup
  // — or one whose ATA was closed — would otherwise fail with nothing the user
  // can act on. Idempotent, so paying for it twice is impossible.
  if (!hasVaultAta) {
    instructions.push(
      createAtaIdempotentInstruction({
        payer: input.wallet,
        owner: input.treasury,
        mint: input.mint,
        ata: vaultAta,
        tokenProgram: meta.tokenProgram,
      }),
    );
  }
  instructions.push(
    transferCheckedInstruction({
      source: walletAta,
      mint: input.mint,
      destination: vaultAta,
      authority: input.wallet,
      amount: input.amount,
      decimals: meta.decimals,
      tokenProgram: meta.tokenProgram,
    }),
  );
  return instructions;
}

/** The owner check happens in `buildTokenTransfer`, before any account is read. */
async function buildTokenWithdraw(
  rpc: Rpc,
  input: { treasury: Address; wallet: Address; mint: Address; amount: bigint },
  meta: MintMeta,
  vaultAta: Address,
  walletAta: Address,
): Promise<Instruction[]> {
  const instructions: Instruction[] = [];
  // `transfer_checked` needs a real token account on the receiving side, and an
  // owner who has never held this mint does not have one. Opening it here costs
  // the owner rent once and keeps the program with no account-creation power.
  if (!(await accountExists(rpc, walletAta))) {
    instructions.push(
      createAtaIdempotentInstruction({
        payer: input.wallet,
        owner: input.wallet,
        mint: input.mint,
        ata: walletAta,
        tokenProgram: meta.tokenProgram,
      }),
    );
  }

  const [eventAuthority] = await findEventAuthorityPda();
  // The synchronous builder, deliberately: the async one resolves `sol_vault`
  // to its PDA when omitted, and on the SPL path that account must be `None`
  // — which the account-meta factory renders as the program id.
  instructions.push(
    getWithdrawInstruction({
      owner: createNoopSigner(input.wallet),
      treasury: input.treasury,
      mint: input.mint,
      vaultAta,
      destination: walletAta,
      tokenProgram: meta.tokenProgram,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      amount: input.amount,
    }),
  );
  return instructions;
}

/**
 * An unsigned v0 transaction with `feePayer` as the first signer slot. Signers attached to
 * the instructions are ignored: every one of them is a no-op stand-in for a key that signs
 * in the browser.
 */
export async function compileUnsigned(
  rpc: Rpc,
  feePayer: Address,
  instructions: Instruction[],
): Promise<{ transaction: string; lastValidBlockHeight: number }> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

export type CreateSessionRequest = {
  treasury: string;
  /** Operator or owner — fee payer and `create_session` authority. */
  wallet: string;
  /** Public session key generated in the browser; the private half never reaches here. */
  sessionKey: string;
  label: string;
  /** Policy PDA; when omitted the first on-chain policy or the `default` PDA is used. */
  policy?: string | null;
  /** Hours until expiry; defaults to 24, same as the CLI. */
  sessionTtlHours: number;
};

export type CreateSessionResult = {
  session: string;
  sessionKey: string;
  policy: string;
  /** Absent when the session already exists and is live — nothing to sign. */
  transaction?: string;
  lastValidBlockHeight?: number;
  alreadyOnChain?: boolean;
};

export type ConfirmationResult = {
  signature: string;
  status: "confirmed" | "failed" | "timeout";
  error?: string;
};

const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 1_000;

export function requireOperatorOrOwner(
  wallet: Address,
  treasury: NonNullable<Awaited<ReturnType<typeof fetchTreasury>>>,
): void {
  if (wallet !== treasury.owner && wallet !== treasury.operator) {
    throw new SolanaRequestError("api.error.notOperatorOrOwner");
  }
}

export function assertSessionKeySafe(
  sessionKey: Address,
  treasury: NonNullable<Awaited<ReturnType<typeof fetchTreasury>>>,
): void {
  if (sessionKey === treasury.owner || sessionKey === treasury.operator) {
    throw new SolanaRequestError("api.error.privilegedSessionKey");
  }
  for (const guardian of treasury.guardians.slice(0, treasury.guardianCount)) {
    if (sessionKey === guardian) throw new SolanaRequestError("api.error.privilegedSessionKey");
  }
}

export function resolveExpiry(hours: number): bigint {
  const seconds = hours * 3_600;
  if (seconds > MAX_SESSION_TTL_SECONDS) {
    throw new SolanaRequestError("api.error.sessionTtlTooLong");
  }
  if (seconds < MIN_WINDOW_SECONDS) {
    throw new SolanaRequestError("api.error.sessionTtlTooShort");
  }
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

async function resolvePolicyAddress(
  rpc: Rpc,
  treasuryPk: Address,
  explicit?: string | null,
): Promise<Address> {
  if (explicit) {
    if (!isLikelyAddress(explicit)) throw new SolanaRequestError("api.error.invalidPayload");
    return address(explicit);
  }

  const policies = await readPolicies(rpc, treasuryPk);
  const [onlyPolicy] = policies;
  if (onlyPolicy) return address(onlyPolicy.address);
  if (policies.length > 1) throw new SolanaRequestError("api.error.policyRequired");

  const [policy] = await findPolicyPda({
    treasury: treasuryPk,
    name: encodeFixedName("default"),
  });
  return policy;
}

/**
 * Builds an unsigned `create_session` for the connected operator/owner wallet.
 * The session private key is generated client-side and never sent here.
 */
export async function buildCreateSession(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: CreateSessionRequest,
): Promise<CreateSessionResult> {
  if (
    !isLikelyAddress(req.treasury) ||
    !isLikelyAddress(req.wallet) ||
    !isLikelyAddress(req.sessionKey)
  ) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const sessionKeyPk = address(req.sessionKey);

  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  requireOperatorOrOwner(walletPk, treasury);
  assertSessionKeySafe(sessionKeyPk, treasury);

  const policy = await resolvePolicyAddress(rpc, treasuryPk, req.policy);
  const expiresAt = resolveExpiry(req.sessionTtlHours);
  const [session] = await findSessionPda({ treasury: treasuryPk, sessionKey: sessionKeyPk });

  const existing = await fetchMaybeAgentSession(rpc, session, { commitment: "confirmed" });
  if (existing.exists && !existing.data.revoked) {
    return {
      session: session as string,
      sessionKey: sessionKeyPk as string,
      policy: policy as string,
      alreadyOnChain: true,
    };
  }

  const [eventAuthority] = await findEventAuthorityPda();
  const instruction = getCreateSessionInstruction({
    operator: createNoopSigner(walletPk),
    treasury: treasuryPk,
    policy,
    session,
    sessionKey: sessionKeyPk,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    label: encodeFixedName(req.label),
    expiresAt,
    authMode: AUTH_MODE_DIRECT_SIGNER,
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(walletPk, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );

  return {
    session: session as string,
    sessionKey: sessionKeyPk as string,
    policy: policy as string,
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

/**
 * The wallet submits through its own RPC, so all we hold afterwards is a
 * signature. Polling beats a websocket subscription here: the route is a
 * one-shot request and `getSignatureStatuses` is on every public endpoint.
 */
export async function confirmSignature(
  cluster: SolanaCluster,
  customRpc: string | null,
  sig: string,
): Promise<ConfirmationResult> {
  const rpc = rpcFor(cluster, customRpc);
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { value } = await rpc
      .getSignatureStatuses([sig as Parameters<Rpc["getSignatureStatuses"]>[0][number]], {
        searchTransactionHistory: true,
      })
      .send();
    const status = value[0];
    if (status) {
      if (status.err) {
        return { signature: sig, status: "failed", error: JSON.stringify(status.err) };
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return { signature: sig, status: "confirmed" };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }

  return { signature: sig, status: "timeout" };
}

export { CLUSTER_RPC_URLS };
