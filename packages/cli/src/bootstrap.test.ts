import { findTreasuryPda } from "@agent-rails/client";
import {
  type Address,
  createNoopSigner,
  generateKeyPairSigner,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BootstrapInput,
  type BootstrapPlan,
  type BootstrapStage,
  buildStages,
  findEventAuthority,
  type MintPlan,
  mergePolicyMintLimits,
  NATIVE_MINT_ADDRESS,
  planBootstrap,
  policyNeedsUpdate,
  readStepState,
  resolveBootstrapLimits,
  type StepState,
} from "./bootstrap.js";
import { encodeFixedName } from "./names.js";
import type { Rpc } from "./rpc.js";
import { TOKEN_2022_PROGRAM_ADDRESS } from "./token.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address;
const USDC_VAULT_ATA = "11111111111111111111111111111117" as Address;

let wallet: KeyPairSigner;
let sessionKey: KeyPairSigner;
let feePayer: KeyPairSigner;
let createKey: KeyPairSigner;
let mockMintKeypair: KeyPairSigner;
let destination: KeyPairSigner;
let eventAuthority: Address;

beforeAll(async () => {
  [wallet, sessionKey, feePayer, createKey, mockMintKeypair, destination] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  eventAuthority = await findEventAuthority();
});

const SOL_LIMITS = {
  perTxMax: 100_000_000n,
  shortWindowMax: 1_000_000_000n,
  shortWindowSeconds: 3_600,
  longWindowMax: 1_000_000_000n,
  longWindowSeconds: 86_400,
  lifetimeMax: 30_000_000_000n,
};

const TOKEN_LIMITS = {
  perTxMax: 10_000_000n,
  shortWindowMax: 100_000_000n,
  shortWindowSeconds: 3_600,
  longWindowMax: 100_000_000n,
  longWindowSeconds: 86_400,
  lifetimeMax: 3_000_000_000n,
};

function solMint(): MintPlan {
  return {
    mint: NATIVE_MINT_ADDRESS,
    decimals: 9,
    tokenProgram: SYSTEM_PROGRAM,
    limits: SOL_LIMITS,
    symbol: "SOL",
  };
}

function usdcMint(overrides: Partial<MintPlan> = {}): MintPlan {
  return {
    mint: USDC,
    decimals: 6,
    tokenProgram: TOKEN_PROGRAM,
    vaultAta: USDC_VAULT_ATA,
    limits: TOKEN_LIMITS,
    symbol: "USDC",
    ...overrides,
  };
}

const NOTHING_DONE: StepState = {
  treasuryExists: false,
  configuredMints: [],
  policyExists: false,
  policyMints: [],
  policyLimits: [],
  entryExists: false,
  sessionExists: false,
};

function allDone(mints: Address[]): StepState {
  return {
    treasuryExists: true,
    configuredMints: mints,
    policyExists: true,
    policyMints: mints,
    policyLimits: [],
    entryExists: true,
    sessionExists: true,
  };
}

function makeInput(
  overrides: Partial<BootstrapInput> = {},
): BootstrapInput & { eventAuthority: Address } {
  return {
    // `buildStages` is pure: it reads no accounts, which is what makes it testable without
    // a validator and what makes `--dry-run` truthful.
    rpc: {} as Rpc,
    wallet,
    sessionKey,
    feePayer,
    destination: destination.address,
    policyName: encodeFixedName("default", "--name"),
    sessionLabel: encodeFixedName("default-agent", "--name"),
    destinationLabel: encodeFixedName("demo", "label"),
    mints: [solMint()],
    sessionExpiresAt: 1_800_000_000n,
    depositLamports: 500_000_000n,
    feeBudgetLamports: 50_000_000n,
    eventAuthority,
    ...overrides,
  };
}

function makePlan(overrides: Partial<BootstrapPlan> = {}): BootstrapPlan {
  return {
    treasury: "11111111111111111111111111111112" as Address,
    solVault: "11111111111111111111111111111113" as Address,
    policy: "11111111111111111111111111111114" as Address,
    session: "11111111111111111111111111111115" as Address,
    allowlistEntry: "11111111111111111111111111111116" as Address,
    createKey,
    ...overrides,
  };
}

type Ix = BootstrapStage["instructions"][number];

const flatten = (stages: BootstrapStage[]) => stages.flatMap((stage) => stage.instructions);

/** Kit encodes roles as READONLY 0, WRITABLE 1, READONLY_SIGNER 2, WRITABLE_SIGNER 3. */
const signersOf = (ix: Ix): string[] =>
  (ix.accounts ?? [])
    .filter((account) => account.role === 2 || account.role === 3)
    .map((account) => String(account.address));

describe("buildStages - native SOL only", () => {
  it("emits every instruction for a fresh bootstrap, in three transactions", () => {
    const stages = buildStages(makeInput(), makePlan(), NOTHING_DONE);
    expect(stages).toHaveLength(3);
    // create_treasury, add_mint, create_policy, add_allowlist_entry, create_session,
    // plus the two System transfers.
    expect(flatten(stages)).toHaveLength(7);
  });

  /**
   * `add_mint` must land before `create_policy`: `policy_leq_ceiling` rejects a limit for a
   * mint the treasury has no ceiling for. Splitting them across transactions is only safe
   * because they are ordered, so the ordering is asserted rather than assumed.
   */
  it("puts the treasury and its ceiling in a stage before the policy", () => {
    const stages = buildStages(makeInput(), makePlan(), NOTHING_DONE);
    expect(stages[0]?.instructions).toHaveLength(2);
    expect(stages[1]?.instructions).toHaveLength(2);
    expect(stages[2]?.instructions).toHaveLength(3);
  });

  it("does nothing when the chain already has everything and nothing needs funding", () => {
    const input = makeInput({ depositLamports: 0n, feeBudgetLamports: 0n });
    expect(buildStages(input, makePlan(), allDone([NATIVE_MINT_ADDRESS]))).toHaveLength(0);
  });

  /** The resume path: a run that died after the policy landed must not re-create it. */
  it("skips the steps the chain already has", () => {
    const state: StepState = { ...allDone([NATIVE_MINT_ADDRESS]), sessionExists: false };
    const input = makeInput({ depositLamports: 0n, feeBudgetLamports: 0n });
    const stages = buildStages(input, makePlan(), state);
    expect(stages).toHaveLength(1);
    expect(flatten(stages)).toHaveLength(1);
  });

  it("omits a funding transfer whose shortfall is zero", () => {
    const input = makeInput({ depositLamports: 0n });
    const stages = buildStages(input, makePlan(), allDone([NATIVE_MINT_ADDRESS]));
    expect(flatten(stages).filter((ix) => ix.programAddress === SYSTEM_PROGRAM)).toHaveLength(1);
  });

  it("refuses to build a treasury it has no create_key for", () => {
    expect(() =>
      buildStages(makeInput(), makePlan({ createKey: undefined }), NOTHING_DONE),
    ).toThrow(/create_key/);
  });

  /**
   * The invariant the whole design rests on: nothing the CLI writes lets the agent's key
   * raise a limit. The session key must appear only as data in `create_session`, never as a
   * signer on an instruction that configures the treasury.
   */
  it("never makes the session key a signer on a privileged instruction", () => {
    const stages = buildStages(
      makeInput({ mints: [solMint(), usdcMint()] }),
      makePlan(),
      NOTHING_DONE,
    );
    const privileged = flatten(stages).filter((ix) => ix.programAddress !== SYSTEM_PROGRAM);
    expect(privileged.length).toBeGreaterThan(0);

    for (const ix of privileged) {
      const signers = signersOf(ix);
      // Positive control: without this the assertion below would also pass on an empty
      // list, i.e. if the role encoding ever changed under it.
      expect(signers).toContain(wallet.address);
      expect(signers).not.toContain(sessionKey.address);
    }
  });

  it("configures the native SOL sentinel mint", () => {
    expect(NATIVE_MINT_ADDRESS).toBe("So11111111111111111111111111111111111111112");
  });
});

describe("buildStages - with an SPL mint", () => {
  it("adds a fourth stage for the token, after the treasury and before the policy", () => {
    const stages = buildStages(
      makeInput({ mints: [solMint(), usdcMint()] }),
      makePlan(),
      NOTHING_DONE,
    );
    expect(stages.map((s) => s.label)).toEqual([
      "Creating treasury and SOL ceiling",
      "Adding USDC and its vault token account",
      "Writing policy and allowlist",
      "Minting session and funding vault",
    ]);
  });

  it("writes one policy covering both mints, not one policy per mint", () => {
    const stages = buildStages(
      makeInput({ mints: [solMint(), usdcMint()] }),
      makePlan(),
      NOTHING_DONE,
    );
    const policyStage = stages.find((s) => s.label === "Writing policy and allowlist");
    // create_policy + add_allowlist_entry. A second create_policy would fail on the PDA.
    expect(policyStage?.instructions).toHaveLength(2);
  });

  it("supports Token-2022 mints, whose token program differs", () => {
    const stages = buildStages(
      makeInput({ mints: [solMint(), usdcMint({ tokenProgram: TOKEN_2022_PROGRAM_ADDRESS })] }),
      makePlan(),
      NOTHING_DONE,
    );
    const tokenStage = stages.find((s) => s.label.startsWith("Adding"));
    const accounts = tokenStage?.instructions[0]?.accounts?.map((a) => a.address) ?? [];
    expect(accounts).toContain(TOKEN_2022_PROGRAM_ADDRESS);
  });

  /**
   * The idempotency case a second mint introduces: the treasury and policy both exist, but
   * they were built before USDC was asked for. Re-creating either would fail on its PDA, so
   * the only correct move is `update_policy`.
   */
  it("updates an existing policy rather than re-creating it when a mint is added", () => {
    const tightenedSol = {
      mint: NATIVE_MINT_ADDRESS,
      perTxMax: 20_000_000n,
      shortWindowMax: 45_000_000n,
      shortWindowSeconds: 3_600,
      longWindowMax: 60_000_000n,
      longWindowSeconds: 86_400,
      lifetimeMax: 1_200_000_000n,
    };
    const state: StepState = {
      ...allDone([NATIVE_MINT_ADDRESS]),
      configuredMints: [NATIVE_MINT_ADDRESS],
      policyMints: [NATIVE_MINT_ADDRESS],
      policyLimits: [tightenedSol],
    };
    const stages = buildStages(
      makeInput({
        mints: [solMint(), usdcMint()],
        depositLamports: 0n,
        feeBudgetLamports: 0n,
      }),
      makePlan(),
      state,
    );
    expect(stages.map((s) => s.label)).toEqual([
      "Adding USDC and its vault token account",
      "Writing policy and allowlist",
    ]);
    // Exactly one instruction: update_policy. The allowlist entry already exists.
    expect(stages[1]?.instructions).toHaveLength(1);
  });

  it("does nothing when both mints are already configured and covered", () => {
    const state = allDone([NATIVE_MINT_ADDRESS, USDC]);
    const input = makeInput({
      mints: [solMint(), usdcMint()],
      depositLamports: 0n,
      feeBudgetLamports: 0n,
    });
    expect(buildStages(input, makePlan(), state)).toHaveLength(0);
  });

  it("creates and mints a mock mint, minting only after add_mint has made the ATA", () => {
    const mock = usdcMint({ mint: mockMintKeypair.address, symbol: "MOCK" });
    const stages = buildStages(
      makeInput({
        mints: [solMint(), mock],
        mockMint: {
          keypair: mockMintKeypair,
          decimals: 6,
          rentLamports: 1_461_600n,
          supply: 1_000_000_000n,
        },
      }),
      makePlan(),
      NOTHING_DONE,
    );

    const labels = stages.map((s) => s.label);
    const tokenStageIndex = labels.findIndex((l) => l.startsWith("Adding"));
    const fundingStageIndex = labels.findIndex((l) => l.startsWith("Minting session"));
    expect(tokenStageIndex).toBeLessThan(fundingStageIndex);

    // create_account + initialize_mint2 + add_mint
    expect(stages[tokenStageIndex]?.instructions).toHaveLength(3);
    // The MintTo lands in the funding stage, after the ATA exists.
    const tokenIxs = flatten([stages[fundingStageIndex] as BootstrapStage]).filter(
      (ix) => ix.programAddress === TOKEN_PROGRAM,
    );
    expect(tokenIxs).toHaveLength(1);
  });

  it("does not re-mint when the vault already holds the target balance", () => {
    const mock = usdcMint({ mint: mockMintKeypair.address, symbol: "MOCK" });
    const stages = buildStages(
      makeInput({
        mints: [solMint(), mock],
        depositLamports: 0n,
        feeBudgetLamports: 0n,
        mockMint: {
          keypair: mockMintKeypair,
          decimals: 6,
          rentLamports: 1_461_600n,
          // Shortfall of zero: the vault is already at the target.
          supply: 0n,
        },
      }),
      makePlan(),
      allDone([NATIVE_MINT_ADDRESS, mockMintKeypair.address]),
    );
    expect(stages).toHaveLength(0);
  });
});

describe("mergePolicyMintLimits", () => {
  it("keeps tightened on-chain limits for mints already on the policy", () => {
    const tightenedSol = {
      mint: NATIVE_MINT_ADDRESS,
      perTxMax: 20_000_000n,
      shortWindowMax: 45_000_000n,
      shortWindowSeconds: 3_600,
      longWindowMax: 60_000_000n,
      longWindowSeconds: 86_400,
      lifetimeMax: 1_200_000_000n,
    };
    expect(mergePolicyMintLimits([solMint(), usdcMint()], [tightenedSol])).toEqual([
      tightenedSol,
      {
        mint: USDC,
        perTxMax: TOKEN_LIMITS.perTxMax,
        shortWindowMax: TOKEN_LIMITS.shortWindowMax,
        shortWindowSeconds: TOKEN_LIMITS.shortWindowSeconds,
        longWindowMax: TOKEN_LIMITS.longWindowMax,
        longWindowSeconds: TOKEN_LIMITS.longWindowSeconds,
        lifetimeMax: TOKEN_LIMITS.lifetimeMax,
      },
    ]);
  });
});

describe("policyNeedsUpdate", () => {
  it("is false when the policy already covers every mint", () => {
    expect(policyNeedsUpdate([solMint()], [NATIVE_MINT_ADDRESS])).toBe(false);
    expect(policyNeedsUpdate([solMint(), usdcMint()], [NATIVE_MINT_ADDRESS, USDC])).toBe(false);
  });

  it("is true when a mint is missing from the policy", () => {
    expect(policyNeedsUpdate([solMint(), usdcMint()], [NATIVE_MINT_ADDRESS])).toBe(true);
  });

  /**
   * Compared by mint set, not by limit values: re-running `init` must not silently widen a
   * limit an operator has since tightened by hand.
   */
  it("ignores a policy whose limits differ from the defaults", () => {
    const tightened = usdcMint({ limits: { ...TOKEN_LIMITS, perTxMax: 1n } });
    expect(policyNeedsUpdate([solMint(), tightened], [NATIVE_MINT_ADDRESS, USDC])).toBe(false);
  });
});

describe("destination token account", () => {
  /**
   * Without this the token path bootstraps a treasury that can never make a token payment:
   * a fresh destination has no account for the mint, and the CLI deliberately leaves
   * `allow_create_destination_ata` false, so the program refuses to open one mid-payment.
   * It was caught by paying a real mint on a validator, not by a unit test.
   */
  it("opens the destination's token account in the token stage", () => {
    const stages = buildStages(
      makeInput({
        mints: [
          solMint(),
          usdcMint({ destinationAta: "11111111111111111111111111111118" as Address }),
        ],
      }),
      makePlan(),
      NOTHING_DONE,
    );
    const tokenStage = stages.find((s) => s.label.startsWith("Adding"));
    // add_mint + create_associated_token_account_idempotent
    expect(tokenStage?.instructions).toHaveLength(2);
    const ataIx = tokenStage?.instructions[1];
    expect(ataIx?.programAddress).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    // CreateIdempotent is instruction 1.
    expect(Array.from((ataIx?.data ?? []) as Uint8Array)).toEqual([1]);
  });

  it("emits nothing extra for a SOL-only treasury", () => {
    const stages = buildStages(makeInput(), makePlan(), NOTHING_DONE);
    expect(
      flatten(stages).some(
        (ix) => ix.programAddress === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      ),
    ).toBe(false);
  });
});

/**
 * The dashboard reaches the same builder with a session, a destination and a fee payer that
 * are each optional (ADR-021 wave 2A). Leaving one out must drop exactly its instructions —
 * never shift another stage's contents or leave an instruction that names a missing account.
 */
describe("buildStages - optional session, destination and fee payer", () => {
  function bare(overrides: Partial<BootstrapInput> = {}) {
    const { sessionKey: _s, feePayer: _f, destination: _d, ...rest } = makeInput(overrides);
    return rest;
  }
  const barePlan = () => {
    const { session: _s, allowlistEntry: _e, ...rest } = makePlan();
    return rest;
  };

  it("names each stage so a caller can render its own copy", () => {
    expect(buildStages(makeInput(), makePlan(), NOTHING_DONE).map((s) => s.id)).toEqual([
      "treasury",
      "policy",
      "funding",
    ]);
    expect(
      buildStages(makeInput({ mints: [solMint(), usdcMint()] }), makePlan(), NOTHING_DONE).map(
        (s) => s.id,
      ),
    ).toEqual(["treasury", "tokens", "policy", "funding"]);
  });

  it("writes the policy alone when no destination is given", () => {
    const stages = buildStages(bare(), barePlan(), NOTHING_DONE);
    expect(stages.find((s) => s.id === "policy")?.instructions).toHaveLength(1);
  });

  it("funds the vault but mints no session and pays no fee budget", () => {
    const stages = buildStages(bare(), barePlan(), NOTHING_DONE);
    const funding = stages.find((s) => s.id === "funding");
    // The deposit alone: a System transfer into the SOL vault.
    expect(funding?.instructions).toHaveLength(1);
    expect(funding?.instructions[0]?.programAddress).toBe(SYSTEM_PROGRAM);
  });

  it("skips the funding stage entirely when there is nothing to deposit", () => {
    const stages = buildStages(bare({ depositLamports: 0n }), barePlan(), NOTHING_DONE);
    expect(stages.map((s) => s.id)).toEqual(["treasury", "policy"]);
  });

  it("does not open a destination token account without a destination", () => {
    const input = bare({
      mints: [
        solMint(),
        usdcMint({ destinationAta: "11111111111111111111111111111118" as Address }),
      ],
    });
    const tokens = buildStages(input, barePlan(), NOTHING_DONE).find((s) => s.id === "tokens");
    expect(tokens?.instructions).toHaveLength(1);
  });

  it("uses the session key as fee payer when the caller says so", () => {
    const input = makeInput({ feePayer: sessionKey });
    const funding = buildStages(input, makePlan(), NOTHING_DONE).find((s) => s.id === "funding");
    const transfers = (funding?.instructions ?? []).filter(
      (ix) => ix.programAddress === SYSTEM_PROGRAM,
    );
    expect(transfers.map((ix) => ix.accounts?.[1]?.address)).toContain(sessionKey.address);
  });
});

describe("planBootstrap", () => {
  it("derives the treasury from a create_key the caller holds elsewhere", async () => {
    // The dashboard's case: the browser holds the key, the server only knows its address.
    const held = createNoopSigner(createKey.address);
    const plan = await planBootstrap({
      rpc: {} as Rpc,
      policyName: encodeFixedName("default", "--name"),
      createKey: held,
    });
    const [expected] = await findTreasuryPda({ createKey: createKey.address });
    expect(plan.treasury).toBe(expected);
    expect(plan.createKey).toBe(held);
    expect(plan.session).toBeUndefined();
    expect(plan.allowlistEntry).toBeUndefined();
  });

  it("derives a session and entry only for the keys it is given", async () => {
    const plan = await planBootstrap({
      rpc: {} as Rpc,
      policyName: encodeFixedName("default", "--name"),
      sessionKey: sessionKey.address,
      destination: destination.address,
    });
    expect(plan.session).toBeDefined();
    expect(plan.allowlistEntry).toBeDefined();
    expect(plan.createKey).toBeDefined();
  });
});

describe("readStepState", () => {
  it("asks only about the accounts this run would create", async () => {
    const asked: Address[][] = [];
    const rpc = {
      getMultipleAccounts: (addresses: Address[]) => {
        asked.push(addresses);
        return { send: async () => ({ value: addresses.map(() => null) }) };
      },
    } as unknown as Rpc;
    const { session: _s, allowlistEntry: _e, ...plan } = makePlan();
    const state = await readStepState(rpc, plan);
    expect(asked[0]).toHaveLength(2);
    expect(state).toMatchObject({ entryExists: false, sessionExists: false });
  });

  it("reads the session flag from its own slot when there is no entry", async () => {
    const rpc = {
      getMultipleAccounts: (addresses: Address[]) => ({
        // treasury, policy, session: only the session exists.
        send: async () => ({ value: addresses.map((_, i) => (i === 2 ? {} : null)) }),
      }),
    } as unknown as Rpc;
    const { allowlistEntry: _e, ...plan } = makePlan();
    const state = await readStepState(rpc, plan);
    expect(state).toMatchObject({ treasuryExists: false, entryExists: false, sessionExists: true });
  });
});

describe("resolveBootstrapLimits", () => {
  it("uses the daily cap for both windows and 30x it for the lifetime", () => {
    expect(resolveBootstrapLimits({ perTx: 1n, daily: 10n })).toEqual({
      perTxMax: 1n,
      shortWindowMax: 10n,
      shortWindowSeconds: 3_600,
      longWindowMax: 10n,
      longWindowSeconds: 86_400,
      lifetimeMax: 300n,
    });
  });

  it("refuses a per-payment cap above the daily cap", () => {
    expect(() => resolveBootstrapLimits({ perTx: 11n, daily: 10n })).toThrow(/exceeds/);
  });

  it("refuses a lifetime below the daily cap", () => {
    expect(() => resolveBootstrapLimits({ perTx: 1n, daily: 10n, lifetime: 9n })).toThrow(
      /lifetime/,
    );
  });
});
