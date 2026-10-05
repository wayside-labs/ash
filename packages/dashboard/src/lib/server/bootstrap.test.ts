import {
  ASH_PROGRAM_ADDRESS,
  findTreasuryPda,
  getTreasuryEncoder,
  type MintConfigArgs,
} from "@ash/sdk";
import {
  type Address,
  generateKeyPairSigner,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BootstrapRequest,
  buildTreasuryBootstrapStep,
  planTreasuryBootstrap,
} from "@/lib/server/bootstrap";
import type { Rpc } from "@/lib/server/solana";
import { signWithCreateKey } from "@/lib/wallet/create-key";

const NATIVE_MINT = "So11111111111111111111111111111111111111112" as Address;
const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
const SOL = 1_000_000_000n;

type FakeAccount = { data: Uint8Array; owner: string; executable?: boolean };

/**
 * Just enough RPC for the bootstrap to run for real: `readStepState`, the codama
 * fetchers and the transaction compiler all go through these four methods. Accounts are
 * real encodings, so what is under test is the shared CLI code, not a mock of it.
 */
function fakeRpc(accounts: Map<string, FakeAccount>, balances: Record<string, bigint> = {}) {
  const info = (address: string) => {
    const account = accounts.get(address);
    if (!account) return null;
    return {
      data: [Buffer.from(account.data).toString("base64"), "base64"],
      executable: account.executable ?? false,
      lamports: 1_000_000n,
      owner: account.owner,
      space: BigInt(account.data.length),
      rentEpoch: 0n,
    };
  };
  const reply = (value: unknown) => ({ send: async () => ({ context: { slot: 1n }, value }) });
  return {
    getAccountInfo: (address: string) => reply(info(address)),
    getMultipleAccounts: (addresses: string[]) => reply(addresses.map(info)),
    getBalance: (address: string) => reply(balances[address] ?? 0n),
    getLatestBlockhash: () => reply({ blockhash: SYSTEM_PROGRAM, lastValidBlockHeight: 100n }),
  } as unknown as Rpc;
}

const PROGRAM: [string, FakeAccount] = [
  ASH_PROGRAM_ADDRESS,
  {
    data: new Uint8Array(0),
    owner: "BPFLoaderUpgradeab1e11111111111111111111111",
    executable: true,
  },
];

function emptyMint(): MintConfigArgs {
  return {
    mint: SYSTEM_PROGRAM,
    tokenProgram: SYSTEM_PROGRAM,
    decimals: 0,
    flags: 0,
    fundingMode: 0,
    pad: new Uint8Array(5),
    ceiling: {
      maxPerTx: 0n,
      maxShortWindow: 0n,
      maxLongWindow: 0n,
      maxLifetime: 0n,
      minShortWindowSeconds: 0,
      minLongWindowSeconds: 0,
    },
  };
}

function treasuryAccount(input: {
  owner: Address;
  operator: Address;
  solCeiling?: { perTx: bigint; daily: bigint; lifetime: bigint };
}): FakeAccount {
  const mints = [emptyMint(), emptyMint(), emptyMint(), emptyMint()];
  if (input.solCeiling) {
    mints[0] = {
      ...emptyMint(),
      mint: NATIVE_MINT,
      decimals: 9,
      ceiling: {
        maxPerTx: input.solCeiling.perTx,
        maxShortWindow: input.solCeiling.daily,
        maxLongWindow: input.solCeiling.daily,
        maxLifetime: input.solCeiling.lifetime,
        minShortWindowSeconds: 3_600,
        minLongWindowSeconds: 86_400,
      },
    };
  }
  const data = getTreasuryEncoder().encode({
    version: 1,
    bump: 255,
    solVaultBump: 255,
    createKey: SYSTEM_PROGRAM,
    owner: input.owner,
    operator: input.operator,
    guardians: Array(5).fill(SYSTEM_PROGRAM),
    guardianCount: 0,
    paused: false,
    pausedAt: 0n,
    pausedBy: SYSTEM_PROGRAM,
    allowAnyDestination: false,
    allowCreateDestinationAta: false,
    timelockSeconds: 0n,
    recoveryDestination: input.owner,
    mints,
    mintCount: input.solCeiling ? 1 : 0,
    activeSessions: 0,
    policyCount: 0,
    createdAt: 0n,
    reserved: new Uint8Array(128),
  });
  return { data: new Uint8Array(data), owner: ASH_PROGRAM_ADDRESS };
}

let wallet: KeyPairSigner;
let other: KeyPairSigner;
let createKey: KeyPairSigner;
let sessionKey: KeyPairSigner;
let vendor: KeyPairSigner;
let existingTreasury: Address;

beforeAll(async () => {
  [wallet, other, createKey, sessionKey, vendor] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  [existingTreasury] = await findTreasuryPda({ createKey: other.address });
});

function request(overrides: Partial<BootstrapRequest> = {}): BootstrapRequest {
  return {
    wallet: wallet.address,
    treasury: null,
    createKey: createKey.address,
    policyName: "default",
    perTxLamports: SOL / 10n,
    dailyLamports: SOL,
    lifetimeLamports: null,
    destination: { owner: vendor.address, label: "oracle" },
    depositLamports: SOL / 2n,
    session: {
      key: sessionKey.address,
      label: "first agent",
      ttlHours: 24,
      feeBudgetLamports: SOL / 20n,
    },
    ...overrides,
  };
}

function signerSlots(base64: string): string[] {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  return Object.keys(tx.signatures);
}

describe("planTreasuryBootstrap - a fresh treasury", () => {
  it("plans the CLI's stages, in the CLI's order", async () => {
    const rpc = fakeRpc(new Map([PROGRAM]), { [wallet.address]: 5n * SOL });
    const plan = await planTreasuryBootstrap("devnet", null, request(), rpc);

    const [expected] = await findTreasuryPda({ createKey: createKey.address });
    expect(plan.treasury).toBe(expected);
    expect(plan.treasuryExists).toBe(false);
    expect(plan.steps.map((step) => step.id)).toEqual(["treasury", "policy", "funding"]);
    // create_session, the deposit, and the session key's fee budget.
    expect(plan.steps[2]?.instructions).toBe(3);
    expect(plan.deposit).toEqual({ target: "500000000", held: "0", shortfall: "500000000" });
    expect(plan.feeBudget?.shortfall).toBe("50000000");
    // Both shortfalls plus a 0.005 SOL allowance for each of the three transactions.
    expect(plan.requiredLamports).toBe(String(500_000_000 + 50_000_000 + 3 * 5_000_000));
    expect(plan.walletLamports).toBe(String(5n * SOL));
  });

  it("tops the vault up to the target rather than sending the target", async () => {
    const { solVault } = await planTreasuryBootstrap(
      "devnet",
      null,
      request(),
      fakeRpc(new Map([PROGRAM])),
    );
    const rpc = fakeRpc(new Map([PROGRAM]), { [solVault]: SOL / 5n });
    const plan = await planTreasuryBootstrap("devnet", null, request(), rpc);
    expect(plan.deposit.shortfall).toBe(String(SOL / 2n - SOL / 5n));
  });

  it("plans no allowlist entry and no session when neither is asked for", async () => {
    const rpc = fakeRpc(new Map([PROGRAM]));
    const plan = await planTreasuryBootstrap(
      "devnet",
      null,
      request({ destination: null, session: null }),
      rpc,
    );
    expect(plan.session).toBeNull();
    expect(plan.allowlistEntry).toBeNull();
    expect(plan.feeBudget).toBeNull();
    // The policy alone, and the deposit alone.
    expect(plan.steps).toEqual([
      { id: "treasury", instructions: 2 },
      { id: "policy", instructions: 1 },
      { id: "funding", instructions: 1 },
    ]);
  });

  it("refuses a cluster without the program", async () => {
    await expect(
      planTreasuryBootstrap("devnet", null, request(), fakeRpc(new Map())),
    ).rejects.toMatchObject({ messageKey: "api.error.programNotDeployed" });
  });

  it("refuses a per-payment cap above the daily cap", async () => {
    await expect(
      planTreasuryBootstrap(
        "devnet",
        null,
        request({ perTxLamports: 2n * SOL }),
        fakeRpc(new Map([PROGRAM])),
      ),
    ).rejects.toMatchObject({ messageKey: "api.error.invalidLimits" });
  });

  it("refuses the wallet itself as the session key", async () => {
    await expect(
      planTreasuryBootstrap(
        "devnet",
        null,
        request({
          session: { key: wallet.address, label: "x", ttlHours: 24, feeBudgetLamports: 0n },
        }),
        fakeRpc(new Map([PROGRAM])),
      ),
    ).rejects.toMatchObject({ messageKey: "api.error.privilegedSessionKey" });
  });

  it("refuses a new treasury with no create_key", async () => {
    await expect(
      planTreasuryBootstrap(
        "devnet",
        null,
        request({ createKey: null }),
        fakeRpc(new Map([PROGRAM])),
      ),
    ).rejects.toMatchObject({ messageKey: "api.error.invalidPayload" });
  });
});

describe("buildTreasuryBootstrapStep", () => {
  it("builds the treasury stage with slots for the wallet and the create_key", async () => {
    const step = await buildTreasuryBootstrapStep(
      "devnet",
      null,
      request(),
      fakeRpc(new Map([PROGRAM])),
    );
    if (step.done) throw new Error("expected a step");
    expect(step.stepId).toBe("treasury");
    expect(step.needsCreateKeySignature).toBe(true);
    expect(step.remaining).toBe(3);
    // The wallet pays and signs first; the create_key is the only other signer.
    expect(signerSlots(step.transaction)).toEqual([wallet.address, createKey.address]);
  });

  it("never asks the session key to sign anything", async () => {
    const step = await buildTreasuryBootstrapStep(
      "devnet",
      null,
      request(),
      fakeRpc(new Map([PROGRAM])),
    );
    if (step.done) throw new Error("expected a step");
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(step.transaction));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect(message.header.numSignerAccounts).toBe(2);
    expect(Object.keys(tx.signatures)).not.toContain(sessionKey.address);
  });

  it("produces a transaction the browser can sign with the create_key", async () => {
    const step = await buildTreasuryBootstrapStep(
      "devnet",
      null,
      request(),
      fakeRpc(new Map([PROGRAM])),
    );
    if (step.done) throw new Error("expected a step");
    const signed = await signWithCreateKey(step.transaction, createKey);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(signed));
    expect(tx.signatures[createKey.address]).not.toBeNull();
    // The wallet's slot is left for the wallet.
    expect(tx.signatures[wallet.address]).toBeNull();
  });

  it("refuses to sign with a create_key the transaction does not name", async () => {
    const step = await buildTreasuryBootstrapStep(
      "devnet",
      null,
      request(),
      fakeRpc(new Map([PROGRAM])),
    );
    if (step.done) throw new Error("expected a step");
    await expect(signWithCreateKey(step.transaction, other)).rejects.toThrow(
      "CREATE_KEY_NOT_A_SIGNER",
    );
  });
});

describe("resuming an existing treasury", () => {
  const resume = (overrides: Partial<BootstrapRequest> = {}) =>
    request({ treasury: existingTreasury, createKey: null, ...overrides });

  it("refuses a wallet that is neither owner nor operator", async () => {
    const rpc = fakeRpc(
      new Map([
        PROGRAM,
        [existingTreasury, treasuryAccount({ owner: other.address, operator: other.address })],
      ]),
    );
    await expect(buildTreasuryBootstrapStep("devnet", null, resume(), rpc)).rejects.toMatchObject({
      messageKey: "api.error.bootstrapNotOperatorOrOwner",
    });
  });

  it("refuses an operator a step that only the owner may sign", async () => {
    // No SOL ceiling yet, so the next step is `add_mint` — owner-only on-chain.
    const rpc = fakeRpc(
      new Map([
        PROGRAM,
        [existingTreasury, treasuryAccount({ owner: other.address, operator: wallet.address })],
      ]),
    );
    await expect(buildTreasuryBootstrapStep("devnet", null, resume(), rpc)).rejects.toMatchObject({
      messageKey: "api.error.bootstrapOwnerOnly",
    });
  });

  it("refuses a policy above the ceiling the owner already set", async () => {
    const rpc = fakeRpc(
      new Map([
        PROGRAM,
        [
          existingTreasury,
          treasuryAccount({
            owner: wallet.address,
            operator: wallet.address,
            solCeiling: { perTx: SOL / 100n, daily: SOL / 10n, lifetime: SOL },
          }),
        ],
      ]),
    );
    await expect(planTreasuryBootstrap("devnet", null, resume(), rpc)).rejects.toMatchObject({
      messageKey: "api.error.policyAboveCeiling",
    });
  });

  it("continues from the policy when the treasury and its ceiling already landed", async () => {
    const rpc = fakeRpc(
      new Map([
        PROGRAM,
        [
          existingTreasury,
          treasuryAccount({
            owner: other.address,
            operator: wallet.address,
            solCeiling: { perTx: SOL, daily: 10n * SOL, lifetime: 300n * SOL },
          }),
        ],
      ]),
    );
    const plan = await planTreasuryBootstrap("devnet", null, resume(), rpc);
    expect(plan.treasuryExists).toBe(true);
    expect(plan.steps.map((step) => step.id)).toEqual(["policy", "funding"]);

    const step = await buildTreasuryBootstrapStep("devnet", null, resume(), rpc);
    if (step.done) throw new Error("expected a step");
    expect(step.stepId).toBe("policy");
    expect(step.needsCreateKeySignature).toBe(false);
    expect(signerSlots(step.transaction)).toEqual([wallet.address]);
  });

  it("refuses the treasury's operator as the first session key", async () => {
    const rpc = fakeRpc(
      new Map([
        PROGRAM,
        [existingTreasury, treasuryAccount({ owner: wallet.address, operator: other.address })],
      ]),
    );
    await expect(
      planTreasuryBootstrap(
        "devnet",
        null,
        resume({
          session: { key: other.address, label: "x", ttlHours: 24, feeBudgetLamports: 0n },
        }),
        rpc,
      ),
    ).rejects.toMatchObject({ messageKey: "api.error.privilegedSessionKey" });
  });

  it("reports a treasury address with nothing behind it", async () => {
    await expect(
      planTreasuryBootstrap("devnet", null, resume(), fakeRpc(new Map([PROGRAM]))),
    ).rejects.toMatchObject({ messageKey: "api.error.treasuryNotFound" });
  });
});
