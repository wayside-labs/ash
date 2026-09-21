import { NATIVE_MINT } from "@agent-rails/contract";
import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  AGENT_SESSION_DISCRIMINATOR,
  decodeAgentSession,
  decodePolicy,
  decodeTreasury,
  findAssociatedTokenAddress,
  findEventAuthorityPda,
  findNativeFixedDelegationPda,
  findNativeSubscriptionAuthorityPda,
  findSolVaultPda,
  getAddAllowlistEntryInstructionAsync,
  getAddMintInstruction,
  getEnableNativeAllowanceInstruction,
  getSetCeilingInstruction,
  getUpdatePolicyInstruction,
  getWithdrawInstructionAsync,
  loadDestinationIndex,
  NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
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

export type TreasuryFundingMode = "isolatedVault" | "nativeAllowance";

export type MintCeilingView = {
  mint: string;
  decimals: number;
  fundingMode: TreasuryFundingMode;
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

/**
 * Decodes one `Treasury`, or null when the address holds something else. An
 * address that exists but belongs to a wallet or a token account is "not a
 * treasury", not a decode crash.
 */
async function fetchTreasury(rpc: Rpc, treasuryPk: Address) {
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
      // `FundingMode.NativeAllowance` is discriminant 1 in the generated client.
      fundingMode: m.fundingMode === 1 ? "nativeAllowance" : "isolatedVault",
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
  /** On-chain owner, not the address the workflow row claims. Gates withdraw. */
  owner: string | null;
};

export type VaultBalances = {
  vaults: VaultBalance[];
  /**
   * `Rent::minimum_balance(0)` for this cluster. `withdraw` refuses to take the
   * vault below it, so the UI has to subtract it to offer an honest "max".
   */
  rentExemptMinimum: number;
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
): Promise<VaultBalances> {
  const rpc = rpcFor(cluster, customRpc);
  const unique = [...new Set(treasuries.filter(isLikelyAddress))];

  const [vaults, rentExemptMinimum] = await Promise.all([
    Promise.all(
      unique.map(async (treasury): Promise<VaultBalance> => {
        try {
          const treasuryPk = address(treasury);
          const [solVault] = await findSolVaultPda({ treasury: treasuryPk });
          const [{ value }, decoded] = await Promise.all([
            rpc.getBalance(solVault).send(),
            fetchTreasury(rpc, treasuryPk),
          ]);
          return {
            treasury,
            solVault,
            lamports: Number(value),
            owner: decoded?.owner ?? null,
          };
        } catch {
          return { treasury, solVault: "", lamports: null, owner: null };
        }
      }),
    ),
    getRentExemptMinimum(rpc),
  ]);

  return { vaults, rentExemptMinimum };
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

export type VaultTransferKind = "deposit" | "withdraw";

export type VaultTransferRequest = {
  kind: VaultTransferKind;
  treasury: string;
  /** The connected wallet: fee payer, and source (deposit) or destination (withdraw). */
  wallet: string;
  lamports: bigint;
};

export type BuiltTransaction = {
  /** Base64 wire transaction with empty signature slots, for the wallet to sign. */
  transaction: string;
  solVault: string;
  lastValidBlockHeight: number;
};

export type EnableNativeAllowanceRequest = {
  treasury: string;
  /** Connected wallet — must be the on-chain owner. */
  wallet: string;
  mint: string;
  amountCap: bigint;
  expiryTs: bigint;
};

export async function buildVaultTransfer(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: VaultTransferRequest,
): Promise<BuiltTransaction> {
  if (!isLikelyAddress(req.treasury) || !isLikelyAddress(req.wallet)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.lamports <= 0n) throw new SolanaRequestError("api.error.amountMustBePositive");

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });

  const instruction =
    req.kind === "deposit"
      ? transferSolInstruction(walletPk, solVault, req.lamports)
      : await buildWithdrawInstruction(rpc, treasuryPk, walletPk, req.lamports);

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(walletPk, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );

  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    solVault,
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

export async function buildEnableNativeAllowance(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: EnableNativeAllowanceRequest,
): Promise<BuiltTransaction> {
  if (
    !isLikelyAddress(req.treasury) ||
    !isLikelyAddress(req.wallet) ||
    !isLikelyAddress(req.mint)
  ) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.amountCap <= 0n) throw new SolanaRequestError("api.error.amountMustBePositive");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (req.expiryTs <= nowSec) throw new SolanaRequestError("api.error.expiryMustBeFuture");
  if (req.mint === NATIVE_MINT) throw new SolanaRequestError("api.error.nativeAllowanceSplOnly");

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const mintPk = address(req.mint);

  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (treasury.owner !== walletPk) throw new SolanaRequestError("api.error.notTreasuryOwner");

  const mintSlot = treasury.mints
    .slice(0, treasury.mintCount)
    .find((config) => config.mint === mintPk);
  if (!mintSlot) throw new SolanaRequestError("api.error.mintNotConfigured");
  if (mintSlot.fundingMode === 1) {
    throw new SolanaRequestError("api.error.alreadyNativeAllowance");
  }

  const [ownerAta] = await findAssociatedTokenAddress({ owner: walletPk, mint: mintPk });
  const ownerAtaInfo = await rpc.getAccountInfo(ownerAta, { encoding: "base64" }).send();
  if (!ownerAtaInfo.value) throw new SolanaRequestError("api.error.ownerAtaMissing");

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });

  const { enableNativeAllowanceTx } = await import("@agent-rails/sdk");
  const built = await enableNativeAllowanceTx({
    owner: createNoopSigner(walletPk),
    treasury: treasuryPk,
    mint: mintPk,
    ownerAta,
    amountCap: req.amountCap,
    expiryTs: req.expiryTs,
    recentBlockhash: latestBlockhash,
  });

  return {
    transaction: built.wireTransaction,
    solVault,
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

/**
 * The program rejects a non-owner anyway, but checking here turns an opaque
 * simulation failure into a sentence the dashboard can render. Pause is
 * deliberately *not* consulted: owner withdrawal keeps working while paused.
 */
async function buildWithdrawInstruction(
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

export type ConfirmationResult = {
  signature: string;
  status: "confirmed" | "failed" | "timeout";
  error?: string;
};

const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 1_000;

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

const TOKEN_2022_PROGRAM_ADDRESS = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SPL_TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MINT_ACCOUNT_SIZE = 82;
const MINT_DECIMALS_OFFSET = 44;
const DAY_SECONDS = 86_400;
const DESTINATION_MODE_ALLOWLIST = 1;

export type AddMintRequest = {
  treasury: string;
  wallet: string;
  mint: string;
};

export type ActivateSecurityPolicyRequest = {
  treasury: string;
  wallet: string;
  policy: string;
  mint: string;
  fundingMode: TreasuryFundingMode;
  allowanceCap?: bigint;
  expiryTs?: bigint;
  maxPerTransaction: bigint;
  dailyLimit: bigint;
  allowlist: string[];
};

type SplMintInfo = {
  mint: Address;
  tokenProgram: Address;
  decimals: number;
  vaultAta: Address;
};

async function readSplMint(rpc: Rpc, mintPk: Address, treasuryPk: Address): Promise<SplMintInfo> {
  const { value } = await rpc.getAccountInfo(mintPk, { encoding: "base64" }).send();
  if (!value) throw new SolanaRequestError("api.error.invalidMintAccount");

  const owner = value.owner as Address;
  if (owner !== SPL_TOKEN_PROGRAM_ADDRESS && owner !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new SolanaRequestError("api.error.invalidMintAccount");
  }

  const data = new Uint8Array(base64.encode(value.data[0]));
  if (data.length < MINT_ACCOUNT_SIZE) throw new SolanaRequestError("api.error.invalidMintAccount");

  const decimals = data[MINT_DECIMALS_OFFSET];
  if (decimals === undefined) throw new SolanaRequestError("api.error.invalidMintAccount");

  const [vaultAta] = await findAssociatedTokenAddress({
    owner: treasuryPk,
    mint: mintPk,
    tokenProgram: owner,
  });

  return { mint: mintPk, tokenProgram: owner, decimals, vaultAta };
}

function generousOwnerCeiling(decimals: number) {
  const unit = 10n ** BigInt(decimals);
  const perTx = 1_000_000n * unit;
  return {
    maxPerTx: perTx,
    maxShortWindow: perTx * 10n,
    maxLongWindow: perTx * 100n,
    maxLifetime: perTx * 1_000n,
    minShortWindowSeconds: 3_600,
    minLongWindowSeconds: DAY_SECONDS,
  };
}

function policyLimitsFromWizard(perTx: bigint, daily: bigint) {
  const longWindowMax = daily * 30n;
  const lifetimeMax = daily * 365n;
  return {
    perTxMax: perTx,
    shortWindowMax: daily,
    shortWindowSeconds: DAY_SECONDS,
    longWindowMax: longWindowMax > daily ? longWindowMax : daily,
    longWindowSeconds: DAY_SECONDS * 30,
    lifetimeMax: lifetimeMax > longWindowMax ? lifetimeMax : longWindowMax,
  };
}

function ceilingFromLimits(limits: ReturnType<typeof policyLimitsFromWizard>) {
  return {
    maxPerTx: limits.perTxMax,
    maxShortWindow: limits.shortWindowMax,
    maxLongWindow: limits.longWindowMax,
    maxLifetime: limits.lifetimeMax,
    minShortWindowSeconds: limits.shortWindowSeconds,
    minLongWindowSeconds: limits.longWindowSeconds,
  };
}

function ceilingCovers(
  ceiling: {
    maxPerTx: bigint;
    maxShortWindow: bigint;
    maxLongWindow: bigint;
    maxLifetime: bigint;
  },
  limits: ReturnType<typeof policyLimitsFromWizard>,
): boolean {
  return (
    ceiling.maxPerTx >= limits.perTxMax &&
    ceiling.maxShortWindow >= limits.shortWindowMax &&
    ceiling.maxLongWindow >= limits.longWindowMax &&
    ceiling.maxLifetime >= limits.lifetimeMax
  );
}

/** 32-byte NUL-padded UTF-8 label for allowlist entries. */
function encodeAllowlistLabel(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value.slice(0, 32));
  const out = new Uint8Array(32);
  out.set(bytes.slice(0, 32));
  return out;
}

export async function buildAddMint(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: AddMintRequest,
): Promise<BuiltTransaction> {
  if (
    !isLikelyAddress(req.treasury) ||
    !isLikelyAddress(req.wallet) ||
    !isLikelyAddress(req.mint)
  ) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.mint === NATIVE_MINT) throw new SolanaRequestError("api.error.addMintSplOnly");

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const mintPk = address(req.mint);

  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (treasury.owner !== walletPk) throw new SolanaRequestError("api.error.notTreasuryOwner");

  const existing = treasury.mints
    .slice(0, treasury.mintCount)
    .some((config) => config.mint === mintPk);
  if (existing) throw new SolanaRequestError("api.error.mintAlreadyConfigured");
  if (treasury.mintCount >= treasury.mints.length) {
    throw new SolanaRequestError("api.error.treasuryMintSlotsFull");
  }

  const mintInfo = await readSplMint(rpc, mintPk, treasuryPk);
  const [eventAuthority] = await findEventAuthorityPda();
  const owner = createNoopSigner(walletPk);

  const instruction = getAddMintInstruction({
    owner,
    treasury: treasuryPk,
    mint: mintInfo.mint,
    vaultAta: mintInfo.vaultAta,
    tokenProgram: mintInfo.tokenProgram,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    ceiling: generousOwnerCeiling(mintInfo.decimals),
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(walletPk, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );

  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    solVault,
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

export async function buildActivateSecurityPolicy(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: ActivateSecurityPolicyRequest,
): Promise<BuiltTransaction> {
  if (
    !isLikelyAddress(req.treasury) ||
    !isLikelyAddress(req.wallet) ||
    !isLikelyAddress(req.policy) ||
    !isLikelyAddress(req.mint)
  ) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.maxPerTransaction <= 0n || req.dailyLimit <= 0n) {
    throw new SolanaRequestError("api.error.amountMustBePositive");
  }
  if (req.maxPerTransaction > req.dailyLimit) {
    throw new SolanaRequestError("api.error.perTxExceedsDaily");
  }
  if (req.allowlist.length === 0) throw new SolanaRequestError("api.error.allowlistRequired");

  const rpc = rpcFor(cluster, customRpc);
  const treasuryPk = address(req.treasury);
  const walletPk = address(req.wallet);
  const policyPk = address(req.policy);
  const mintPk = address(req.mint);
  const owner = createNoopSigner(walletPk);

  const treasury = await fetchTreasury(rpc, treasuryPk);
  if (!treasury) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (treasury.owner !== walletPk && treasury.operator !== walletPk) {
    throw new SolanaRequestError("api.error.notTreasuryOperator");
  }

  const mintSlot = treasury.mints
    .slice(0, treasury.mintCount)
    .find((config) => config.mint === mintPk);
  if (!mintSlot) throw new SolanaRequestError("api.error.mintNotConfigured");

  const policies = await readPolicies(rpc, treasuryPk);
  const policy = policies.find((p) => p.address === req.policy);
  if (!policy) throw new SolanaRequestError("api.error.noPolicyConfigured");

  const wizardLimits = policyLimitsFromWizard(req.maxPerTransaction, req.dailyLimit);
  const instructions: Instruction[] = [];
  const [eventAuthority] = await findEventAuthorityPda();

  if (!ceilingCovers(mintSlot.ceiling, wizardLimits)) {
    instructions.push(
      getSetCeilingInstruction({
        owner,
        treasury: treasuryPk,
        eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        mint: mintPk,
        ceiling: ceilingFromLimits(wizardLimits),
        allowAnyDestination: treasury.allowAnyDestination,
        allowCreateDestinationAta: treasury.allowCreateDestinationAta,
      }),
    );
  }

  if (req.fundingMode === "nativeAllowance") {
    if (mintPk === address(NATIVE_MINT)) {
      throw new SolanaRequestError("api.error.nativeAllowanceSplOnly");
    }
    if (mintSlot.fundingMode === 1) {
      throw new SolanaRequestError("api.error.alreadyNativeAllowance");
    }
    if (!req.allowanceCap || !req.expiryTs) {
      throw new SolanaRequestError("api.error.invalidPayload");
    }
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (req.expiryTs <= nowSec) throw new SolanaRequestError("api.error.expiryMustBeFuture");

    const [ownerAta] = await findAssociatedTokenAddress({ owner: walletPk, mint: mintPk });
    const ownerAtaInfo = await rpc.getAccountInfo(ownerAta, { encoding: "base64" }).send();
    if (!ownerAtaInfo.value) throw new SolanaRequestError("api.error.ownerAtaMissing");

    const [subscriptionAuthority] = await findNativeSubscriptionAuthorityPda({
      owner: walletPk,
      mint: mintPk,
    });
    const [nativeDelegation] = await findNativeFixedDelegationPda({
      subscriptionAuthority,
      delegator: walletPk,
      delegatee: treasuryPk,
    });

    instructions.push(
      getEnableNativeAllowanceInstruction({
        owner,
        treasury: treasuryPk,
        mint: mintPk,
        ownerAta,
        subscriptionAuthority,
        nativeDelegation,
        tokenProgram: mintSlot.tokenProgram,
        nativeSubscriptionsProgram: NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
        eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        amountCap: req.allowanceCap,
        expiryTs: req.expiryTs,
      }),
    );
  }

  // Rebuild mint limits for every configured treasury mint.
  const configuredMints = treasury.mints.slice(0, treasury.mintCount);
  const mintLimits = configuredMints.map((config) => {
    const existing = policy.limits.find((limit) => limit.mint === config.mint);
    const limits =
      config.mint === mintPk
        ? wizardLimits
        : existing
          ? {
              perTxMax: BigInt(existing.perTxMax),
              shortWindowMax: BigInt(existing.shortWindowMax),
              shortWindowSeconds: existing.shortWindowSeconds,
              longWindowMax: BigInt(existing.longWindowMax),
              longWindowSeconds: existing.longWindowSeconds,
              lifetimeMax: BigInt(existing.lifetimeMax),
            }
          : {
              perTxMax: config.ceiling.maxPerTx,
              shortWindowMax: config.ceiling.maxShortWindow,
              shortWindowSeconds: config.ceiling.minShortWindowSeconds,
              longWindowMax: config.ceiling.maxLongWindow,
              longWindowSeconds: config.ceiling.minLongWindowSeconds,
              lifetimeMax: config.ceiling.maxLifetime,
            };
    return {
      mint: config.mint,
      ...limits,
    };
  });

  instructions.push(
    getUpdatePolicyInstruction({
      operator: owner,
      treasury: treasuryPk,
      policy: policyPk,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      args: {
        mintLimits,
        destinationMode: DESTINATION_MODE_ALLOWLIST,
        requireMemo: policy.requireMemo,
        createDestinationAta: false,
      },
    }),
  );

  const destinationIndex = await loadDestinationIndex({
    rpc: rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: policyPk,
  });
  const existingOwners = new Set(destinationIndex.entries.map((entry) => entry.owner));
  for (const destination of req.allowlist) {
    const destinationPk = address(destination);
    if (existingOwners.has(destinationPk)) continue;
    instructions.push(
      await getAddAllowlistEntryInstructionAsync({
        operator: owner,
        treasury: treasuryPk,
        policy: policyPk,
        eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        destinationOwner: destinationPk,
        label: encodeAllowlistLabel(truncateAllowlistLabel(destination)),
        perTxMaxOverride: 0n,
      }),
    );
  }

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const [solVault] = await findSolVaultPda({ treasury: treasuryPk });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(walletPk, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    solVault,
    lastValidBlockHeight: Number(latestBlockhash.lastValidBlockHeight),
  };
}

function truncateAllowlistLabel(addressValue: string): string {
  return addressValue.length > 32 ? addressValue.slice(0, 32) : addressValue;
}

export { CLUSTER_RPC_URLS };
