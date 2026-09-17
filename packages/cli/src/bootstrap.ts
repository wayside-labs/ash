import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  fetchMaybePolicy,
  fetchMaybeTreasury,
  findEntryPda,
  findPolicyPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
  getAddAllowlistEntryInstruction,
  getAddMintInstruction,
  getCreatePolicyInstruction,
  getCreateSessionInstruction,
  getCreateTreasuryInstruction,
  getUpdatePolicyInstruction,
} from "@agent-rails/client";
import { AUTH_MODE_DIRECT_SIGNER, NATIVE_MINT } from "@agent-rails/contract";
import {
  type Address,
  address,
  generateKeyPairSigner,
  getProgramDerivedAddress,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import { CliError } from "./errors.js";
import { accountsExist, type Rpc, transferSol } from "./rpc.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintInstructions,
  mintToInstruction,
} from "./token.js";

export const NATIVE_MINT_ADDRESS = address(NATIVE_MINT);

/** `DestinationMode::Allowlist` (policy crate `types.rs`). The CLI never writes `Any`. */
const DESTINATION_MODE_ALLOWLIST = 1;

/**
 * The event-authority PDA Anchor's `emit_cpi!` requires on every instruction.
 *
 * Codama does not emit a finder for it because it is not in the IDL's seed graph, so it is
 * derived here once and threaded through every instruction below.
 */
export async function findEventAuthority(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: AGENT_RAILS_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode("__event_authority")],
  });
  return pda;
}

export type BootstrapLimits = {
  /** Owner ceiling. The operator's policy must be `<=` this on every axis. */
  perTxMax: bigint;
  shortWindowMax: bigint;
  shortWindowSeconds: number;
  longWindowMax: bigint;
  longWindowSeconds: number;
  lifetimeMax: bigint;
};

/**
 * One mint the treasury will hold, with the limits that apply to it.
 *
 * Amounts are in that mint's own base units — lamports for SOL, 10^-6 for a six-decimal
 * USDC — because that is what both the ceiling and the policy store. Nothing downstream
 * re-scales them, so a limit converted with the wrong decimals is a limit that is wrong by
 * a factor of a thousand and still perfectly valid on-chain.
 */
export type MintPlan = {
  mint: Address;
  decimals: number;
  /** System program for native SOL; SPL Token or Token-2022 otherwise. */
  tokenProgram: Address;
  /** Absent for native SOL, which has no token account. */
  vaultAta?: Address;
  /**
   * The allowlisted destination's token account for this mint.
   *
   * Opened at setup so the payment path never needs the treasury's
   * `allow_create_destination_ata` permission. Absent for native SOL.
   */
  destinationAta?: Address;
  limits: BootstrapLimits;
  /** Human label for terminal output. */
  symbol: string;
};

/** A mint this run creates from scratch, so a fresh cluster has something to pay with. */
export type MockMintPlan = {
  keypair: KeyPairSigner;
  decimals: number;
  rentLamports: bigint;
  /** Base units minted into the vault ATA once `add_mint` has created it. */
  supply: bigint;
};

export type BootstrapPlan = {
  treasury: Address;
  solVault: Address;
  policy: Address;
  session: Address;
  allowlistEntry: Address;
  /** Absent once the treasury exists: `create_key` signs exactly once, at creation. */
  createKey: KeyPairSigner | undefined;
};

export type BootstrapInput = {
  rpc: Rpc;
  /** Owner, operator, and rent payer for setup. Never handed to the agent. */
  wallet: TransactionSigner;
  sessionKey: TransactionSigner;
  feePayer: TransactionSigner;
  destination: Address;
  policyName: Uint8Array;
  sessionLabel: Uint8Array;
  destinationLabel: Uint8Array;
  /** Native SOL first, then any SPL mint. At most `MAX_MINTS` (4). */
  mints: MintPlan[];
  mockMint?: MockMintPlan;
  sessionExpiresAt: bigint;
  depositLamports: bigint;
  feeBudgetLamports: bigint;
  /** A treasury from a previous run, to resume into instead of creating a second one. */
  existingTreasury?: Address;
};

/**
 * Resolve every address this bootstrap will touch, before anything is signed.
 *
 * Deriving up front is what makes the command resumable and `--dry-run` truthful: the PDAs
 * do not depend on any transaction landing, so the CLI can show the developer exactly what
 * it is about to create, and on a re-run can ask the chain which of them already exist.
 */
export async function planBootstrap(input: {
  rpc: Rpc;
  sessionKey: Address;
  destination: Address;
  policyName: Uint8Array;
  existingTreasury?: Address;
}): Promise<BootstrapPlan> {
  let treasury: Address;
  let createKey: KeyPairSigner | undefined;

  if (input.existingTreasury) {
    treasury = input.existingTreasury;
  } else {
    // Ephemeral by design: it seeds the treasury PDA, signs `create_treasury`, and is then
    // discarded. That is what lets one owner hold unlimited treasuries with no index.
    createKey = await generateKeyPairSigner();
    [treasury] = await findTreasuryPda({ createKey: createKey.address });
  }

  const [solVault] = await findSolVaultPda({ treasury });
  const [policy] = await findPolicyPda({ treasury, name: input.policyName });
  const [session] = await findSessionPda({ treasury, sessionKey: input.sessionKey });
  const [allowlistEntry] = await findEntryPda({ policy, destinationOwner: input.destination });

  return { treasury, solVault, policy, session, allowlistEntry, createKey };
}

export type StepState = {
  treasuryExists: boolean;
  /** Mints with a ceiling on the treasury. */
  configuredMints: Address[];
  policyExists: boolean;
  /** Mints the live policy carries a limit for. */
  policyMints: Address[];
  entryExists: boolean;
  sessionExists: boolean;
};

/**
 * Ask the chain which steps are already done.
 *
 * Resume is driven by account existence and account *contents*, not by the local manifest.
 * The distinction earns its keep once a second mint is in play: a treasury can exist with a
 * SOL ceiling and no USDC ceiling, and a policy can exist that covers one mint but not the
 * other. "Does the account exist" is too coarse a question to resume from — the chain has to
 * be asked what is actually in it.
 */
export async function readStepState(
  rpc: Rpc,
  plan: Pick<BootstrapPlan, "treasury" | "policy" | "session" | "allowlistEntry">,
): Promise<StepState> {
  const [treasuryExists, policyExists, entryExists, sessionExists] = await accountsExist(rpc, [
    plan.treasury,
    plan.policy,
    plan.allowlistEntry,
    plan.session,
  ]);

  const configuredMints: Address[] = [];
  if (treasuryExists) {
    const account = await fetchMaybeTreasury(rpc, plan.treasury, { commitment: "confirmed" });
    if (account.exists) {
      for (const config of account.data.mints.slice(0, account.data.mintCount)) {
        configuredMints.push(config.mint);
      }
    }
  }

  const policyMints: Address[] = [];
  if (policyExists) {
    const account = await fetchMaybePolicy(rpc, plan.policy, { commitment: "confirmed" });
    if (account.exists) {
      for (const limit of account.data.mintLimits.slice(0, account.data.mintCount)) {
        policyMints.push(limit.mint);
      }
    }
  }

  return {
    treasuryExists: treasuryExists === true,
    configuredMints,
    policyExists: policyExists === true,
    policyMints,
    entryExists: entryExists === true,
    sessionExists: sessionExists === true,
  };
}

export type BootstrapStage = {
  /** Shown on the spinner and in the failure message. */
  label: string;
  instructions: Instruction[];
};

function toMintLimit(plan: MintPlan) {
  return {
    mint: plan.mint,
    perTxMax: plan.limits.perTxMax,
    shortWindowMax: plan.limits.shortWindowMax,
    shortWindowSeconds: plan.limits.shortWindowSeconds,
    longWindowMax: plan.limits.longWindowMax,
    longWindowSeconds: plan.limits.longWindowSeconds,
    lifetimeMax: plan.limits.lifetimeMax,
  };
}

function addMintInstruction(
  input: BootstrapInput & { eventAuthority: Address },
  plan: BootstrapPlan,
  mint: MintPlan,
) {
  const isNative = mint.mint === NATIVE_MINT_ADDRESS;
  return getAddMintInstruction({
    owner: input.wallet,
    treasury: plan.treasury,
    eventAuthority: input.eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    mint: mint.mint,
    // Native SOL takes none of the token accounts; the program stores the System program in
    // `MintConfig.token_program` on that path and creates no ATA.
    ...(isNative
      ? {}
      : {
          vaultAta: mint.vaultAta,
          tokenProgram: mint.tokenProgram,
        }),
    ceiling: {
      maxPerTx: mint.limits.perTxMax,
      maxShortWindow: mint.limits.shortWindowMax,
      maxLongWindow: mint.limits.longWindowMax,
      maxLifetime: mint.limits.lifetimeMax,
      minShortWindowSeconds: mint.limits.shortWindowSeconds,
      minLongWindowSeconds: mint.limits.longWindowSeconds,
    },
  });
}

/**
 * Group the bootstrap into the transactions it will actually be sent as.
 *
 * The ordering constraints are real, not stylistic. `add_mint` must land before the policy,
 * because `policy_leq_ceiling` rejects a limit for a mint the treasury has no ceiling for.
 * A mock mint must be initialised before `add_mint` reads its owner and decimals. And
 * `mint_to` must come after `add_mint`, because `add_mint` is what creates the vault ATA it
 * mints into. Beyond that the grouping is about transaction size: all of it in one
 * transaction runs past the 1232-byte limit, and separate stages also give the developer
 * legible milestones instead of one opaque wait.
 */
export function buildStages(
  input: BootstrapInput & { eventAuthority: Address },
  plan: BootstrapPlan,
  state: StepState,
): BootstrapStage[] {
  const stages: BootstrapStage[] = [];
  const configured = new Set(state.configuredMints);

  const native = input.mints.find((mint) => mint.mint === NATIVE_MINT_ADDRESS);
  const tokens = input.mints.filter((mint) => mint.mint !== NATIVE_MINT_ADDRESS);

  // ---- Treasury and the native ceiling ------------------------------------------------
  const stageOne: Instruction[] = [];
  if (!state.treasuryExists) {
    if (!plan.createKey) {
      throw new CliError("Internal: no create_key available for a treasury that does not exist");
    }
    stageOne.push(
      getCreateTreasuryInstruction({
        payer: input.wallet,
        createKey: plan.createKey,
        treasury: plan.treasury,
        solVault: plan.solVault,
        eventAuthority: input.eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        owner: input.wallet.address,
        // Same key as owner for a first run. The roles are separate in the account, so an
        // operator can be handed off later with `set_roles` without recreating anything.
        operator: input.wallet.address,
        recoveryDestination: input.wallet.address,
        // Both false: the strictest treasury the program allows. A ceiling can be widened
        // later by the owner, but a bootstrap that starts permissive teaches the wrong
        // default and cannot be tightened for sessions already issued under it.
        allowAnyDestination: false,
        allowCreateDestinationAta: false,
      }),
    );
  }
  if (native && !configured.has(native.mint)) {
    stageOne.push(addMintInstruction(input, plan, native));
  }
  if (stageOne.length > 0) {
    stages.push({ label: "Creating treasury and SOL ceiling", instructions: stageOne });
  }

  // ---- The SPL mint -------------------------------------------------------------------
  const stageTwo: Instruction[] = [];
  if (input.mockMint && !configured.has(input.mockMint.keypair.address)) {
    stageTwo.push(
      ...createMintInstructions({
        payer: input.wallet,
        mint: input.mockMint.keypair,
        mintAuthority: input.wallet.address,
        decimals: input.mockMint.decimals,
        rentLamports: input.mockMint.rentLamports,
      }),
    );
  }
  for (const token of tokens) {
    if (!configured.has(token.mint)) {
      stageTwo.push(addMintInstruction(input, plan, token));
    }
    // Idempotent, so it is emitted unconditionally rather than guarded by a read: the
    // instruction succeeds whether or not the account is already there, and one extra
    // instruction is cheaper than the round trip needed to find out.
    if (token.destinationAta) {
      stageTwo.push(
        createAssociatedTokenAccountIdempotentInstruction({
          payer: input.wallet,
          owner: input.destination,
          mint: token.mint,
          associatedAccount: token.destinationAta,
          tokenProgram: token.tokenProgram,
        }),
      );
    }
  }
  if (stageTwo.length > 0) {
    stages.push({
      label: `Adding ${tokens.map((t) => t.symbol).join(", ")} and its vault token account`,
      instructions: stageTwo,
    });
  }

  // ---- Policy and allowlist -----------------------------------------------------------
  const stageThree: Instruction[] = [];
  const policyArgs = {
    mintLimits: input.mints.map(toMintLimit),
    destinationMode: DESTINATION_MODE_ALLOWLIST,
    requireMemo: false,
    createDestinationAta: false,
  };

  if (!state.policyExists) {
    stageThree.push(
      getCreatePolicyInstruction({
        operator: input.wallet,
        treasury: plan.treasury,
        policy: plan.policy,
        eventAuthority: input.eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        name: input.policyName,
        args: policyArgs,
      }),
    );
  } else if (policyNeedsUpdate(input.mints, state.policyMints)) {
    // A policy that predates this mint has to be rewritten, not patched: `PolicyInput` is
    // passed whole precisely so `policy_leq_ceiling` can judge every limit and both
    // destination flags as one unit, and a per-field setter would let an operator step
    // through an illegal intermediate state.
    stageThree.push(
      getUpdatePolicyInstruction({
        operator: input.wallet,
        treasury: plan.treasury,
        policy: plan.policy,
        eventAuthority: input.eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        args: policyArgs,
      }),
    );
  }

  if (!state.entryExists) {
    stageThree.push(
      getAddAllowlistEntryInstruction({
        operator: input.wallet,
        treasury: plan.treasury,
        policy: plan.policy,
        entry: plan.allowlistEntry,
        eventAuthority: input.eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        destinationOwner: input.destination,
        label: input.destinationLabel,
        // 0 is the sentinel for "no per-destination override" (state.rs, `effective_per_tx`).
        perTxMaxOverride: 0n,
      }),
    );
  }
  if (stageThree.length > 0) {
    stages.push({ label: "Writing policy and allowlist", instructions: stageThree });
  }

  // ---- Session and funding ------------------------------------------------------------
  const stageFour: Instruction[] = [];
  if (!state.sessionExists) {
    stageFour.push(
      getCreateSessionInstruction({
        operator: input.wallet,
        treasury: plan.treasury,
        policy: plan.policy,
        session: plan.session,
        eventAuthority: input.eventAuthority,
        program: AGENT_RAILS_PROGRAM_ADDRESS,
        sessionKey: input.sessionKey.address,
        label: input.sessionLabel,
        expiresAt: input.sessionExpiresAt,
        // v1 has exactly one auth mode; `create_session` rejects anything else.
        authMode: AUTH_MODE_DIRECT_SIGNER,
      }),
    );
  }
  if (input.depositLamports > 0n) {
    stageFour.push(transferSol(input.wallet, plan.solVault, input.depositLamports));
  }
  if (input.feeBudgetLamports > 0n) {
    stageFour.push(transferSol(input.wallet, input.feePayer.address, input.feeBudgetLamports));
  }
  if (input.mockMint && input.mockMint.supply > 0n) {
    const vaultAta = tokens.find((t) => t.mint === input.mockMint?.keypair.address)?.vaultAta;
    if (vaultAta) {
      stageFour.push(
        mintToInstruction({
          mint: input.mockMint.keypair.address,
          destination: vaultAta,
          authority: input.wallet,
          amount: input.mockMint.supply,
        }),
      );
    }
  }
  if (stageFour.length > 0) {
    stages.push({ label: "Minting session and funding vault", instructions: stageFour });
  }

  return stages;
}

/**
 * Does the live policy already cover every mint this run wants it to?
 *
 * Compared by mint set rather than by limits: re-running `init` must not silently rewrite
 * limits an operator has since tightened by hand. Widening a policy is an operator decision,
 * and `init` only makes it when the policy does not cover a mint at all.
 */
export function policyNeedsUpdate(mints: MintPlan[], policyMints: Address[]): boolean {
  const covered = new Set(policyMints);
  return mints.some((mint) => !covered.has(mint.mint));
}
