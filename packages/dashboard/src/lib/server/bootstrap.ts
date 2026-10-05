import {
  type BootstrapStage,
  type BootstrapStageId,
  buildStages,
  findEventAuthority,
  limitLeqCeiling,
  type MintPlan,
  NATIVE_MINT_ADDRESS,
  PDA_RENT_ALLOWANCE_LAMPORTS,
  planBootstrap,
  readStepState,
  resolveBootstrapLimits,
  shortfall,
} from "@ash/cli/bootstrap";
import { MAX_NAME_LEN } from "@ash/contract";
import { ASH_PROGRAM_ADDRESS } from "@ash/sdk";
import { type Address, address, createNoopSigner } from "@solana/kit";
import { z } from "zod";
import {
  addressSchema,
  isLikelyAddress,
  type SolanaCluster,
  solanaClusterSchema,
} from "@/lib/schema";
import { encodeFixedName } from "@/lib/server/fixed-name";
import {
  assertSessionKeySafe,
  compileUnsigned,
  fetchTreasury,
  type Rpc,
  resolveExpiry,
  rpcFor,
  SolanaRequestError,
} from "@/lib/server/solana";

// ---------------------------------------------------------------------------
// ADR-021 wave 2A: `ash init` from a browser. The stages are the CLI's own
// (`@ash/cli/bootstrap`), so the two operator surfaces cannot drift on ordering,
// ceilings or funding semantics. What differs is only who holds the keys: the owner's
// wallet signs in the browser, and so do the ephemeral `create_key` and the optional
// session key — this module sees their public halves and nothing else.
// ---------------------------------------------------------------------------

const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

export type BootstrapRequest = {
  /** Owner, operator and rent payer — the connected wallet. */
  wallet: string;
  /** A treasury to resume into; null for a new one. */
  treasury: string | null;
  /** Public half of the browser-held `create_key`. Required when `treasury` is null. */
  createKey: string | null;
  policyName: string;
  perTxLamports: bigint;
  dailyLamports: bigint;
  /** Null: 30x the daily cap, same default as `init`. */
  lifetimeLamports: bigint | null;
  /** The first allowlisted payee, by wallet owner. Optional. */
  destination: { owner: string; label: string } | null;
  /** Target balance for the SOL vault, not an amount to send. */
  depositLamports: bigint;
  /** The first agent's session. Optional; the key is generated in the browser. */
  session: {
    key: string;
    label: string;
    ttlHours: number;
    /** Target balance for the session key, which pays its own transaction fees. */
    feeBudgetLamports: bigint;
  } | null;
};

export type BootstrapPlanView = {
  treasury: string;
  solVault: string;
  policy: string;
  session: string | null;
  allowlistEntry: string | null;
  treasuryExists: boolean;
  /** What is still to send, in order. Empty when the chain already has everything. */
  steps: { id: BootstrapStageId; instructions: number }[];
  /** Lamports as decimal strings throughout: a u64 does not survive JSON as a number. */
  deposit: { target: string; held: string; shortfall: string };
  feeBudget: { target: string; held: string; shortfall: string } | null;
  walletLamports: string;
  /** Shortfalls plus a rent allowance per remaining step — an upper bound, not a quote. */
  requiredLamports: string;
};

export type BootstrapStepResult =
  | { done: true; treasury: string }
  | {
      done: false;
      treasury: string;
      stepId: BootstrapStageId;
      transaction: string;
      lastValidBlockHeight: number;
      /** The browser must add the `create_key` signature before the wallet signs. */
      needsCreateKeySignature: boolean;
      /** Steps left including this one. */
      remaining: number;
    };

type Prepared = {
  plan: Awaited<ReturnType<typeof planBootstrap>>;
  treasuryExists: boolean;
  stages: BootstrapStage[];
  vaultHeld: bigint;
  depositShortfall: bigint;
  feeHeld: bigint;
  feeShortfall: bigint;
};

function lamportsLimits(req: BootstrapRequest) {
  if (req.perTxLamports <= 0n || req.dailyLamports <= 0n) {
    throw new SolanaRequestError("api.error.invalidLimits");
  }
  try {
    return resolveBootstrapLimits({
      perTx: req.perTxLamports,
      daily: req.dailyLamports,
      lifetime: req.lifetimeLamports ?? undefined,
    });
  } catch {
    // The CLI's message names its own flags; the dashboard has fields, not flags.
    throw new SolanaRequestError("api.error.invalidLimits");
  }
}

async function balanceOf(rpc: Rpc, account: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(account, { commitment: "confirmed" }).send();
  return BigInt(value);
}

/**
 * Everything both routes need: the plan, what the chain already has, and the stages
 * still to send. Re-derived on every call rather than carried between requests, which is
 * what makes a dropped confirmation or a closed tab safe — the next call asks the chain.
 */
async function prepare(rpc: Rpc, req: BootstrapRequest): Promise<Prepared> {
  if (!isLikelyAddress(req.wallet)) throw new SolanaRequestError("api.error.invalidPayload");
  if (req.treasury !== null && !isLikelyAddress(req.treasury)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.treasury === null && !isLikelyAddress(req.createKey)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.destination && !isLikelyAddress(req.destination.owner)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }
  if (req.session && !isLikelyAddress(req.session.key)) {
    throw new SolanaRequestError("api.error.invalidPayload");
  }

  const walletPk = address(req.wallet);
  const limits = lamportsLimits(req);
  const sessionKeyPk = req.session ? address(req.session.key) : undefined;
  const sessionExpiresAt = req.session ? resolveExpiry(req.session.ttlHours) : 0n;

  // A resumed treasury is judged by what the chain says about it, not by the workflow row:
  // only its owner or operator may continue, and the session key must not be one of them.
  const existing = req.treasury ? await fetchTreasury(rpc, address(req.treasury)) : null;
  if (req.treasury && !existing) throw new SolanaRequestError("api.error.treasuryNotFound");
  if (existing && walletPk !== existing.owner && walletPk !== existing.operator) {
    throw new SolanaRequestError("api.error.bootstrapNotOperatorOrOwner");
  }
  if (sessionKeyPk) {
    if (sessionKeyPk === walletPk) throw new SolanaRequestError("api.error.privilegedSessionKey");
    if (existing) assertSessionKeySafe(sessionKeyPk, existing);
  }

  const policyName = encodeFixedName(req.policyName);
  const plan = await planBootstrap({
    rpc,
    policyName,
    ...(req.treasury
      ? { existingTreasury: address(req.treasury) }
      : { createKey: createNoopSigner(address(req.createKey as string)) }),
    sessionKey: sessionKeyPk,
    destination: req.destination ? address(req.destination.owner) : undefined,
  });
  const state = await readStepState(rpc, plan);

  // Loosening flows downhill: a fresh treasury gets the same numbers as ceiling and policy,
  // but one that already has a SOL ceiling keeps it, and the policy must fit under it.
  // Checked here so the wizard says so, instead of a simulation failure saying it later.
  const solCeiling = existing?.mints
    .slice(0, existing.mintCount)
    .find((config) => config.mint === NATIVE_MINT_ADDRESS)?.ceiling;
  if (solCeiling && !state.policyExists && !limitLeqCeiling(limits, solCeiling)) {
    throw new SolanaRequestError("api.error.policyAboveCeiling");
  }

  const sol: MintPlan = {
    mint: NATIVE_MINT_ADDRESS,
    decimals: 9,
    tokenProgram: SYSTEM_PROGRAM_ADDRESS,
    limits,
    symbol: "SOL",
  };

  const [vaultHeld, feeHeld] = await Promise.all([
    balanceOf(rpc, plan.solVault),
    sessionKeyPk ? balanceOf(rpc, sessionKeyPk) : Promise.resolve(0n),
  ]);
  const depositShortfall = shortfall(req.depositLamports, vaultHeld);
  const feeShortfall = req.session ? shortfall(req.session.feeBudgetLamports, feeHeld) : 0n;

  const wallet = createNoopSigner(walletPk);
  const sessionSigner = sessionKeyPk ? createNoopSigner(sessionKeyPk) : undefined;
  const stages = buildStages(
    {
      rpc,
      wallet,
      ...(sessionSigner ? { sessionKey: sessionSigner, feePayer: sessionSigner } : {}),
      ...(req.destination ? { destination: address(req.destination.owner) } : {}),
      policyName,
      sessionLabel: req.session ? encodeFixedName(req.session.label) : policyName,
      destinationLabel: req.destination ? encodeFixedName(req.destination.label) : policyName,
      mints: [sol],
      sessionExpiresAt,
      depositLamports: depositShortfall,
      feeBudgetLamports: feeShortfall,
      eventAuthority: await findEventAuthority(),
    },
    plan,
    state,
  );

  // `add_mint` is owner-only; everything after it takes owner or operator, which the
  // resume check above already established. A fresh treasury makes the wallet both.
  if (existing && existing.owner !== walletPk) {
    if (stages.some((stage) => stage.id === "treasury" || stage.id === "tokens")) {
      throw new SolanaRequestError("api.error.bootstrapOwnerOnly");
    }
  }

  return {
    plan,
    treasuryExists: state.treasuryExists,
    stages,
    vaultHeld,
    depositShortfall,
    feeHeld,
    feeShortfall,
  };
}

/**
 * A missing program reads, from `create_treasury`, as `ProgramAccountNotFound` — which
 * looks like a dashboard bug rather than "this cluster has no ASH on it".
 */
async function assertProgramDeployed(rpc: Rpc): Promise<void> {
  const { value } = await rpc.getAccountInfo(ASH_PROGRAM_ADDRESS, { encoding: "base64" }).send();
  if (!value?.executable) throw new SolanaRequestError("api.error.programNotDeployed");
}

export async function planTreasuryBootstrap(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: BootstrapRequest,
  rpc: Rpc = rpcFor(cluster, customRpc),
): Promise<BootstrapPlanView> {
  await assertProgramDeployed(rpc);
  const prepared = await prepare(rpc, req);
  const walletLamports = await balanceOf(rpc, address(req.wallet));
  const required =
    prepared.depositShortfall +
    prepared.feeShortfall +
    BigInt(prepared.stages.length) * PDA_RENT_ALLOWANCE_LAMPORTS;

  return {
    treasury: prepared.plan.treasury,
    solVault: prepared.plan.solVault,
    policy: prepared.plan.policy,
    session: prepared.plan.session ?? null,
    allowlistEntry: prepared.plan.allowlistEntry ?? null,
    treasuryExists: prepared.treasuryExists,
    steps: prepared.stages.map((stage) => ({
      id: stage.id,
      instructions: stage.instructions.length,
    })),
    deposit: {
      target: req.depositLamports.toString(),
      held: prepared.vaultHeld.toString(),
      shortfall: prepared.depositShortfall.toString(),
    },
    feeBudget: req.session
      ? {
          target: req.session.feeBudgetLamports.toString(),
          held: prepared.feeHeld.toString(),
          shortfall: prepared.feeShortfall.toString(),
        }
      : null,
    walletLamports: walletLamports.toString(),
    requiredLamports: required.toString(),
  };
}

/**
 * Builds the first stage the chain does not have yet. The client loops — build, sign,
 * confirm — until this says `done`, so the order is decided here on every call and a
 * client cannot skip ahead to a policy whose ceiling never landed.
 */
export async function buildTreasuryBootstrapStep(
  cluster: SolanaCluster,
  customRpc: string | null,
  req: BootstrapRequest,
  rpc: Rpc = rpcFor(cluster, customRpc),
): Promise<BootstrapStepResult> {
  const prepared = await prepare(rpc, req);
  const [next] = prepared.stages;
  if (!next) return { done: true, treasury: prepared.plan.treasury };

  const built = await compileUnsigned(rpc, address(req.wallet), next.instructions);
  return {
    done: false,
    treasury: prepared.plan.treasury,
    stepId: next.id,
    transaction: built.transaction,
    lastValidBlockHeight: built.lastValidBlockHeight,
    needsCreateKeySignature: next.id === "treasury" && !prepared.treasuryExists,
    remaining: prepared.stages.length,
  };
}

const lamports = z.string().regex(/^\d{1,20}$/);
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).length <= MAX_NAME_LEN);

/** The body both bootstrap routes take; lamports as decimal strings. */
export const bootstrapBodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  wallet: addressSchema,
  treasury: addressSchema.nullable().default(null),
  createKey: addressSchema.nullable().default(null),
  policyName: nameSchema,
  perTxLamports: lamports,
  dailyLamports: lamports,
  lifetimeLamports: lamports.nullable().default(null),
  destination: z.object({ owner: addressSchema, label: nameSchema }).nullable().default(null),
  depositLamports: lamports,
  session: z
    .object({
      key: addressSchema,
      label: nameSchema,
      ttlHours: z.number().int().positive().default(24),
      feeBudgetLamports: lamports,
    })
    .nullable()
    .default(null),
});

export function toBootstrapRequest(body: z.infer<typeof bootstrapBodySchema>): BootstrapRequest {
  return {
    wallet: body.wallet,
    treasury: body.treasury,
    createKey: body.createKey,
    policyName: body.policyName,
    perTxLamports: BigInt(body.perTxLamports),
    dailyLamports: BigInt(body.dailyLamports),
    lifetimeLamports: body.lifetimeLamports === null ? null : BigInt(body.lifetimeLamports),
    destination: body.destination,
    depositLamports: BigInt(body.depositLamports),
    session: body.session
      ? {
          key: body.session.key,
          label: body.session.label,
          ttlHours: body.session.ttlHours,
          feeBudgetLamports: BigInt(body.session.feeBudgetLamports),
        }
      : null,
  };
}
