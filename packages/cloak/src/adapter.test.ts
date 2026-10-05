import { ZEC_MINT } from "@ash/contract/template-run";
import * as realSdk from "@cloak.dev/sdk";
import {
  type Blockhash,
  compileTransaction,
  createSignableMessage,
  createTransactionMessage,
  generateKeyPair,
  generateKeyPairSigner,
  getAddressFromPublicKey,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it, vi } from "vitest";
import {
  type BrowserWalletHandle,
  createCloakSdkPort,
  createWalletSigner,
  deriveSessionKeys,
  rekeyRecovered,
} from "./adapter.js";
import { COMMITMENT_MEMO } from "./commitment.js";
import { deriveMasterSeed } from "./keys.js";
import { addr, FUNDER } from "./test-support.js";

type Sdk = typeof import("@cloak.dev/sdk");

const seedOf = (fill: number) => deriveMasterSeed(new Uint8Array(64).fill(fill));

describe("the keys come from the wallet and nothing else (real SDK, offline)", () => {
  it("derives the same viewing key from the same seed, every time", async () => {
    const a = await deriveSessionKeys(realSdk, seedOf(1));
    const b = await deriveSessionKeys(realSdk, seedOf(1));
    expect(Array.from(a.nk)).toEqual(Array.from(b.nk));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.nk).toHaveLength(32);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it("derives different keys from a different seed", async () => {
    const a = await deriveSessionKeys(realSdk, seedOf(1));
    const b = await deriveSessionKeys(realSdk, seedOf(2));
    expect(Array.from(a.nk)).not.toEqual(Array.from(b.nk));
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("does not leave the spend key behind in the seed it was handed", async () => {
    const seed = seedOf(3);
    const copy = Array.from(seed);
    await deriveSessionKeys(realSdk, seed);
    expect(Array.from(seed)).toEqual(copy); // the caller zeroes the seed, not this function
  });

  // The promise ADR-027 rests on: a deposit made in one tab is found again by another that only
  // has the wallet's signature. `matchDepositNote` is what `scanTransactions` calls per note.
  it("rebuilds a deposit note from the seed alone", async () => {
    const first = await deriveSessionKeys(realSdk, seedOf(7));
    const amount = 40_000_000n;
    const { utxo, noteSalt } = await realSdk.createRecoverableDepositUtxo(
      amount,
      first.nk,
      realSdk.NATIVE_SOL_MINT,
    );
    expect(utxo.commitment).toBeDefined();

    // A different session, a different object, the same wallet signature.
    const second = await deriveSessionKeys(realSdk, seedOf(7));
    const match = await realSdk.matchDepositNote({
      viewingKeyNk: second.nk,
      noteSalt,
      amount,
      mintAddress: realSdk.NATIVE_SOL_MINT,
      outputCommitments: [utxo.commitment as bigint],
    });
    expect(match).not.toBeNull();
    expect(match?.keypair.privateKey).toBe(utxo.keypair.privateKey);
    expect(match?.blinding).toBe(utxo.blinding);
  });

  it("does not rebuild it for another wallet's seed", async () => {
    const mine = await deriveSessionKeys(realSdk, seedOf(7));
    const theirs = await deriveSessionKeys(realSdk, seedOf(8));
    const { utxo, noteSalt } = await realSdk.createRecoverableDepositUtxo(
      10_000_000n,
      mine.nk,
      realSdk.NATIVE_SOL_MINT,
    );
    const match = await realSdk.matchDepositNote({
      viewingKeyNk: theirs.nk,
      noteSalt,
      amount: 10_000_000n,
      mintAddress: realSdk.NATIVE_SOL_MINT,
      outputCommitments: [utxo.commitment as bigint],
    });
    expect(match).toBeNull();
  });
});

/** A wallet that signs with a real Ed25519 key, and keeps the bytes it was asked to sign. */
async function signingWallet() {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  const seen: Uint8Array[] = [];
  const handle: BrowserWalletHandle = {
    address,
    async signMessage(message) {
      return new Uint8Array(64).fill(message.length % 251);
    },
    async signTransaction(bytes) {
      seen.push(bytes);
      const decoded = getTransactionDecoder().decode(bytes);
      const signed = await signTransaction([keyPair], decoded);
      return new Uint8Array(getTransactionEncoder().encode(signed));
    },
  };
  return { handle, address, seen };
}

describe("the wallet bridge (real SDK, offline)", () => {
  it("hands the wallet wire bytes and returns a transaction the wallet signed", async () => {
    const { handle, address, seen } = await signingWallet();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: 1n },
          m,
        ),
    );
    const compiled = compileTransaction(message);
    const signer = createWalletSigner(realSdk, handle);

    const [out] = await signer.modifyAndSignTransactions([compiled]);

    expect(seen).toHaveLength(1);
    expect(Array.from(seen[0] ?? [])).toEqual(Array.from(getTransactionEncoder().encode(compiled)));
    const signature = out?.signatures[address];
    expect(signature).toBeDefined();
    expect(signature).toHaveLength(64);
  });

  it("signs messages through the wallet's own signMessage", async () => {
    const { handle, address } = await signingWallet();
    const signer = createWalletSigner(realSdk, handle);
    expect(signer.address).toBe(address);
    const [dictionary] =
      (await signer.signMessages?.([createSignableMessage(new TextEncoder().encode("hello"))])) ??
      [];
    expect(dictionary?.[address]).toEqual(new Uint8Array(64).fill(5));
  });
});

type ChainOptions = {
  /** Keep the change note but not the deposit it came from, as a short scan window would. */
  orphanChange?: boolean;
  /** Tags whose leaves the relay's commitment list does not carry. */
  missingLeaves?: string[];
  /** A swap that timed out and left a refund leaf behind. */
  refund?: boolean;
  /** A note the verification could not check. */
  unverifiable?: boolean;
};

const NATIVE = "So11111111111111111111111111111111111111112";

/**
 * What a scan of the chain returns for one wallet, shaped like the SDK's own records: a deposit
 * that was half paid out (so spent, with a change note that carries a zero private key), and the
 * leftover deposit of an earlier run.
 */
function fakeChain(options: ChainOptions) {
  let commitment = 1_000n;
  const note = (
    amount: bigint,
    keypair: { privateKey: bigint; publicKey: bigint },
    signature: string,
  ) => ({
    amount,
    keypair,
    blinding: 7n,
    mintAddress: NATIVE,
    commitment: ++commitment,
    noteSalt: 1n,
    signature,
    timestamp: 1n,
  });
  const thisRun = { privateKey: 11n, publicKey: 12n };
  const earlierRun = { privateKey: 21n, publicKey: 22n };
  const deposit = note(40_000_000n, thisRun, "SHIELD1");
  const change = note(20_000_000n, { privateKey: 0n, publicKey: 12n }, "PAYOUT1");
  const leftover = note(5_000_000n, earlierRun, "SHIELD0");
  const refund = {
    amount: 15_000_000n,
    keypair: { privateKey: 31n, publicKey: 32n },
    blinding: 9n,
    commitment: ++commitment,
    leafIndex: 42n,
    signature: "CLOSE1",
    inputNullifier: new Uint8Array(32),
  };
  const known = [
    { tag: "deposit", note: deposit },
    { tag: "change", note: change },
    { tag: "leftover", note: leftover },
  ];
  const leaves = known
    .filter(({ tag }) => !(options.missingLeaves ?? []).includes(tag))
    .map(({ note: n }, i) => ({
      index: 7 + i,
      commitment: n.commitment.toString(16).padStart(64, "0"),
    }));
  return {
    deposit,
    change,
    leftover,
    refund,
    leaves,
    scan: {
      recoveredDepositNotes: options.orphanChange ? [leftover] : [deposit, leftover],
      recoveredChangeNotes: [change],
    },
    spent: new Set([deposit.commitment]),
  };
}

const hex64 = (value: bigint) => value.toString(16).padStart(64, "0");

// Recovery is where the first version failed: a scan returns notes with no leaf index, and change
// notes with a zero private key. Neither shows up against a fake that returns tidy notes, so these
// run the real note primitives, nullifiers and `verifyUtxos` and stub only the network.
describe("recovery against the real SDK (offline)", () => {
  /** A 0.04 SOL deposit, 0.02 of it paid out, and what a scan hands back for both. */
  async function halfPaidRun(nk: Uint8Array) {
    const mint = realSdk.NATIVE_SOL_MINT;
    const amount = 40_000_000n;
    const { utxo: deposit, noteSalt } = await realSdk.createRecoverableDepositUtxo(
      amount,
      nk,
      mint,
    );
    const changeAmount = 20_000_000n;
    const { utxo: change, noteSalt: changeSalt } = await realSdk.createRecoverableChangeUtxo(
      changeAmount,
      deposit.keypair,
      nk,
      mint,
    );
    const scannedDeposit = await realSdk.matchDepositNote({
      viewingKeyNk: nk,
      noteSalt,
      amount,
      mintAddress: mint,
      outputCommitments: [deposit.commitment as bigint],
    });
    // The scan knows the owner's public key from the chain note and nothing else about it.
    const scannedChange = await realSdk.matchChangeNote({
      viewingKeyNk: nk,
      noteSalt: changeSalt,
      amount: changeAmount,
      keypair: { privateKey: 0n, publicKey: deposit.keypair.publicKey },
      mintAddress: mint,
      outputIndex: 0,
      outputCommitments: [change.commitment as bigint],
    });
    if (!scannedDeposit || !scannedChange)
      throw new Error("the SDK could not rebuild its own note");
    return {
      deposit,
      change,
      scannedDeposit: { ...scannedDeposit, signature: "SHIELD", timestamp: 1n },
      scannedChange: { ...scannedChange, signature: "PAYOUT", timestamp: 2n },
    };
  }

  it("gets a change note back with a key that cannot spend it, and gives it its owner's", async () => {
    const { nk } = await deriveSessionKeys(realSdk, seedOf(5));
    const run = await halfPaidRun(nk);
    expect(run.scannedChange.keypair.privateKey).toBe(0n);
    expect(run.scannedChange.keypair.publicKey).toBe(run.deposit.keypair.publicKey);

    const [, rekeyed] = rekeyRecovered([run.scannedDeposit], [run.scannedChange]);
    expect(rekeyed?.keypair.privateKey).toBe(run.deposit.keypair.privateKey);

    // What the proof needs is the nullifier the chain will see. Only the right key reproduces it.
    const at = 11;
    const truth = await realSdk.computeUtxoNullifier({ ...run.change, index: at });
    const rekeyedNullifier = await realSdk.computeUtxoNullifier({ ...rekeyed, index: at } as never);
    const zeroKeyNullifier = await realSdk.computeUtxoNullifier({
      ...run.scannedChange,
      index: at,
    });
    expect(rekeyedNullifier).toBe(truth);
    expect(zeroKeyNullifier).not.toBe(truth);
    expect(await realSdk.computeUtxoCommitment(rekeyed as never)).toBe(run.change.commitment);
  });

  it("leaves out a change note whose deposit the scan did not reach, rather than guess its key", async () => {
    const { nk } = await deriveSessionKeys(realSdk, seedOf(5));
    const run = await halfPaidRun(nk);
    expect(rekeyRecovered([], [run.scannedChange])).toEqual([]);
  });

  function stubRpc(spentPdas: string[]) {
    return {
      endpoint: "https://rpc.example.invalid",
      getMultipleAccounts: (addresses: string[]) => ({
        send: async () => ({
          value: addresses.map((address) =>
            spentPdas.includes(address)
              ? {
                  data: ["", "base64"],
                  owner: realSdk.CLOAK_PROGRAM_ID,
                  lamports: 1n,
                  executable: false,
                }
              : null,
          ),
        }),
      }),
    };
  }

  async function openRecovering(spent: "deposit" | "nothing", leavesOf: "both" | "deposit-only") {
    const seed = seedOf(5);
    const { nk } = await deriveSessionKeys(realSdk, seed);
    const run = await halfPaidRun(nk);
    const programId = realSdk.CLOAK_PROGRAM_ID;
    const { pool } = await realSdk.getShieldPoolPDAs(programId, realSdk.NATIVE_SOL_MINT);
    const depositNullifier = await realSdk.computeUtxoNullifier({ ...run.deposit, index: 3 });
    const [depositPda] = await realSdk.getNullifierPDA(
      pool,
      Uint8Array.from(Buffer.from(hex64(depositNullifier), "hex")),
      programId,
    );
    const rpc = stubRpc(spent === "deposit" ? [depositPda] : []);
    const withdrawn: { amount: bigint; keypair: { privateKey: bigint } }[][] = [];
    const sdk = {
      ...realSdk,
      createCloakRpc: () => rpc,
      scanTransactions: async () => ({
        recoveredDepositNotes: [run.scannedDeposit],
        recoveredChangeNotes: [run.scannedChange],
      }),
      fetchCommitments: async () => [
        { index: 3, commitment: hex64(run.deposit.commitment as bigint) },
        ...(leavesOf === "both"
          ? [{ index: 4, commitment: hex64(run.change.commitment as bigint) }]
          : []),
      ],
      discoverSwapRefunds: async () => [],
      fullWithdraw: async (inputs: { amount: bigint; keypair: { privateKey: bigint } }[]) => {
        withdrawn.push(inputs);
        return { signature: "SIG_FULL", outputUtxos: [] };
      },
    } as unknown as Sdk;
    const port = createCloakSdkPort({
      rpcUrl: "https://rpc.example.invalid",
      auth: walletAuth(),
      loadSdk: async () => sdk,
    });
    return { run, withdrawn, opened: await port.openSession(seed) };
  }

  it("finds the note the chain still shows unspent, and not the deposit it came from", async () => {
    const { opened, run } = await openRecovering("deposit", "both");
    await expect(opened.recoverSpendable({ shieldSignature: "SHIELD" })).resolves.toEqual({
      spendableLamports: run.change.amount,
      notes: 1,
    });
  });

  it("sweeps it with the owner's key and the leaf the relay listed", async () => {
    const { opened, run, withdrawn } = await openRecovering("deposit", "both");
    await expect(opened.sweepAll("11111111111111111111111111111112")).resolves.toEqual({
      signature: "SIG_FULL",
    });
    expect(withdrawn).toHaveLength(1);
    const [note] = withdrawn[0] ?? [];
    expect(note?.amount).toBe(run.change.amount);
    expect(note?.keypair.privateKey).toBe(run.deposit.keypair.privateKey);
    expect((note as { index?: number } | undefined)?.index).toBe(4);
  });

  it("finds the deposit itself when nothing was paid out yet", async () => {
    const { opened, run } = await openRecovering("nothing", "both");
    // Neither note is spent, so both are candidates; the larger one first, two at most.
    await expect(opened.recoverSpendable()).resolves.toEqual({
      spendableLamports: run.deposit.amount + run.change.amount,
      notes: 2,
    });
  });

  it("will not count a note the relay's list does not carry, since it could not be proven", async () => {
    const { opened } = await openRecovering("deposit", "deposit-only");
    await expect(opened.recoverSpendable({ shieldSignature: "SHIELD" })).resolves.toEqual({
      spendableLamports: 0n,
      notes: 0,
    });
  });
});

/** A stand-in for the SDK that records how the adapter calls it. */
function fakeSdkModule(chainOptions: ChainOptions = {}, overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    <A extends unknown[], T>(name: string, result: (...args: A) => T) =>
    (...args: A): T => {
      calls.push({ name, args });
      return result(...args);
    };

  const chain = fakeChain(chainOptions);
  const nk = new Uint8Array(32).fill(9);
  const utxo = (amount: bigint, tag: string) => ({
    amount,
    keypair: { privateKey: 5n, publicKey: 6n },
    blinding: 7n,
    mintAddress: NATIVE,
    commitment: BigInt(tag.length),
    tag,
  });
  const tree = { fakeTree: true };
  const sdk = {
    VERSION: "9.9.9",
    CLOAK_PROGRAM_ID: "CloakProgram1111111111111111111111111111111",
    CLOAK_PRODUCTION_RELAY_URL: "https://relay.example",
    DEFAULT_CIRCUITS_URL: "https://circuits.example/v1",
    NATIVE_SOL_MINT: NATIVE,
    setCircuitsPath: record("setCircuitsPath", () => undefined),
    address: (value: string) => value,
    createCloakRpc: record("createCloakRpc", (url: unknown) => ({
      url,
      getLatestBlockhash: () => ({
        send: async () => ({
          value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 500n },
        }),
      }),
      sendTransaction: (wire: string, config: unknown) => ({
        send: async () => {
          calls.push({ name: "sendTransaction", args: [wire, config] });
          // What an RPC answers: the transaction's own first signature.
          return getSignatureFromTransaction(
            getTransactionDecoder().decode(new Uint8Array(Buffer.from(wire, "base64"))),
          );
        },
      }),
      getSignatureStatuses: () => ({
        send: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
      }),
      getBalance: (address: unknown) => ({
        send: async () => {
          calls.push({ name: "getBalance", args: [address] });
          return { value: 123_456n };
        },
      }),
      getAccountInfo: (address: unknown, config: unknown) => ({
        send: async () => {
          calls.push({ name: "getAccountInfo", args: [address, config] });
          const owners: Record<string, string> = { MintAccount: "TokenProgram" };
          const owner = owners[String(address)];
          return { value: owner ? { owner } : null };
        },
      }),
    })),
    loadVerifiedCircuitArtifacts: record("loadVerifiedCircuitArtifacts", async () => ({})),
    deriveSpendKey: record("deriveSpendKey", () => ({ sk_spend: new Uint8Array(32).fill(1) })),
    deriveUtxoKeypairFromSpendKey: record("deriveUtxoKeypairFromSpendKey", async () => ({
      privateKey: 5n,
      publicKey: 6n,
    })),
    getNkFromUtxoPrivateKey: record("getNkFromUtxoPrivateKey", () => nk),
    createRecoverableDepositUtxo: record(
      "createRecoverableDepositUtxo",
      async (amount: unknown) => ({
        utxo: utxo(amount as bigint, "deposit"),
        noteSalt: 77n,
      }),
    ),
    createZeroUtxo: record("createZeroUtxo", async () => utxo(0n, "zero")),
    sumUtxoAmounts: (utxos: { amount: bigint }[]) => utxos.reduce((s, u) => s + u.amount, 0n),
    transact: record("transact", async (params: { externalAmount: bigint }) => ({
      signature: "SIG_SHIELD",
      outputUtxos: [utxo(params.externalAmount, "note"), utxo(0n, "zero")],
      merkleTree: tree,
    })),
    partialWithdraw: record(
      "partialWithdraw",
      async (inputs: { amount: bigint }[], _to: unknown, amount: bigint) => ({
        signature: "SIG_PARTIAL",
        outputUtxos: [
          utxo(inputs.reduce((s, u) => s + u.amount, 0n) - amount, "change"),
          utxo(0n, "zero"),
        ],
        merkleTree: { fakeTree: "after-partial-withdraw" },
      }),
    ),
    fullWithdraw: record("fullWithdraw", async () => ({
      signature: "SIG_FULL",
      outputUtxos: [utxo(0n, "zero"), utxo(0n, "zero")],
      merkleTree: { fakeTree: "after-full-withdraw" },
    })),
    // The real swap returns no tree (index.js swapUtxo): the fake must not invent one.
    swapWithChange: record(
      "swapWithChange",
      async (inputs: { amount: bigint }[], amount: bigint) => ({
        signature: "SIG_SWAP",
        outputUtxos: [
          utxo(inputs.reduce((s, u) => s + u.amount, 0n) - amount, "change"),
          utxo(0n, "zero"),
        ],
      }),
    ),
    scanTransactions: record("scanTransactions", async () => chain.scan),
    fetchCommitments: record("fetchCommitments", async () => chain.leaves),
    discoverSwapRefunds: record("discoverSwapRefunds", async () =>
      chainOptions.refund ? [chain.refund] : [],
    ),
    // Like the real one: a note with no index cannot be checked, and says so by being skipped.
    verifyUtxos: record("verifyUtxos", async (found: { commitment: bigint; index?: number }[]) => {
      const checkable = found.filter((note) => note.index !== undefined);
      const spent = checkable.filter((note) => chain.spent.has(note.commitment));
      return {
        unspent: checkable.filter((note) => !chain.spent.has(note.commitment)),
        spent,
        skipped: [
          ...found.filter((note) => note.index === undefined),
          ...(chainOptions.unverifiable ? [utxo(1n, "unverifiable")] : []),
        ],
      };
    }),
    toComplianceReport: record("toComplianceReport", () => ({ transactions: [1, 2, 3] })),
    formatComplianceCsv: record("formatComplianceCsv", () => "type,amount\nshield,1\n"),
    signerFromSecretKey: record("signerFromSecretKey", async () => ({ address: "KeypairWallet" })),
    signerFromWalletAdapter: record("signerFromWalletAdapter", () => ({ isWalletSigner: true })),
  };
  return { sdk: { ...sdk, ...overrides } as unknown as Sdk, calls, nk, tree, chain };
}

const walletAuth = (): { kind: "wallet"; wallet: BrowserWalletHandle } => ({
  kind: "wallet",
  wallet: {
    address: FUNDER,
    signMessage: async () => new Uint8Array(64),
    signTransaction: async (bytes) => bytes,
  },
});

async function session(
  auth: ReturnType<typeof walletAuth> | { kind: "keypair"; secretKey: Uint8Array } = walletAuth(),
  chainOptions: ChainOptions = {},
  overrides: Record<string, unknown> = {},
) {
  const fake = fakeSdkModule(chainOptions, overrides);
  const loadSdk = vi.fn(async () => fake.sdk);
  const port = createCloakSdkPort({ rpcUrl: "https://rpc.example", auth, loadSdk });
  const opened = await port.openSession(new Uint8Array(32).fill(3));
  return { ...fake, loadSdk, port, session: opened };
}

const callsOf = (calls: { name: string; args: unknown[] }[], name: string) =>
  calls.filter((c) => c.name === name);

/** The arguments of the nth call to `name`; a missing call fails the test loudly. */
function argsOf<T extends unknown[]>(
  calls: { name: string; args: unknown[] }[],
  name: string,
  nth = 0,
): T {
  const call = callsOf(calls, name)[nth];
  if (!call) throw new Error(`expected call #${nth} to ${name}`);
  return call.args as T;
}

describe("createCloakSdkPort", () => {
  it("loads the SDK once, however many things ask for it", async () => {
    const { loadSdk, port, session: opened } = await session();
    await port.info();
    await port.checkEndpoints();
    await port.balanceLamports(FUNDER);
    await opened.complianceCsv();
    expect(loadSdk).toHaveBeenCalledTimes(1);
  });

  it("points the SDK at the circuits location it pins, never at ours", async () => {
    const { calls } = await session();
    expect(callsOf(calls, "setCircuitsPath")).toEqual([
      { name: "setCircuitsPath", args: ["https://circuits.example/v1"] },
    ]);
  });

  it("reports the SDK version and program id", async () => {
    const { port } = await session();
    expect(await port.info()).toEqual({
      sdkVersion: "9.9.9",
      programId: "CloakProgram1111111111111111111111111111111",
    });
  });

  it("reads the balance as a bigint", async () => {
    const { port, calls } = await session();
    await expect(port.balanceLamports(addr(4))).resolves.toBe(123_456n);
    expect(callsOf(calls, "getBalance")[0]?.args).toEqual([addr(4)]);
  });

  describe("accountOwner", () => {
    it("names the program that owns the account, or null when none exists yet", async () => {
      const { port, calls } = await session();
      await expect(port.accountOwner("MintAccount")).resolves.toBe("TokenProgram");
      await expect(port.accountOwner(addr(5))).resolves.toBeNull();
      // It asks for the owner only: a payee can be a program with megabytes of data behind it.
      expect(callsOf(calls, "getAccountInfo")[0]?.args[1]).toEqual({
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      });
    });
  });

  describe("checkEndpoints", () => {
    const portWith = (fetchImpl: typeof fetch) => {
      const fake = fakeSdkModule();
      return createCloakSdkPort({
        rpcUrl: "https://rpc.example",
        auth: walletAuth(),
        loadSdk: async () => fake.sdk,
        fetchImpl,
      });
    };
    const ok = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;

    it("is healthy when the RPC, the circuits and the relay answer", async () => {
      await expect(portWith(ok).checkEndpoints()).resolves.toEqual({
        rpc: true,
        circuits: true,
        relay: true,
      });
    });

    it("names the relay when only the relay is down", async () => {
      const down = vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      await expect(portWith(down).checkEndpoints()).resolves.toEqual({
        rpc: true,
        circuits: true,
        relay: false,
      });
      const refused = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
      expect((await portWith(refused).checkEndpoints()).relay).toBe(false);
    });
  });
});

describe("a session in wallet mode", () => {
  it("derives from the seed and hands the relay and the SDK the same viewing key", async () => {
    const { calls, nk } = await session();
    expect(callsOf(calls, "deriveSpendKey")).toHaveLength(1);
    expect(callsOf(calls, "getNkFromUtxoPrivateKey")).toHaveLength(1);
    const adapterCall = callsOf(calls, "signerFromWalletAdapter")[0];
    expect(adapterCall).toBeDefined();
    const adapter = adapterCall?.args[0] as { publicKey: { toBase58(): string } };
    expect(adapter.publicKey.toBase58()).toBe(FUNDER);
    const [, bridge] = argsOf<[unknown, { web3: object }]>(calls, "signerFromWalletAdapter");
    expect(Object.keys(bridge.web3)).toEqual(["VersionedTransaction"]);
    expect(nk).toHaveLength(32);
  });

  it("shields with a recoverable note: same nk, same salt, no cached tree on the first call", async () => {
    const { session: opened, calls, nk } = await session();
    const receipt = await opened.shield(40_000_000n);
    expect(receipt).toEqual({ signature: "SIG_SHIELD" });

    expect(callsOf(calls, "createRecoverableDepositUtxo")[0]?.args).toEqual([
      40_000_000n,
      nk,
      "So11111111111111111111111111111111111111112",
    ]);
    const [params, options] = argsOf<[Record<string, unknown>, Record<string, unknown>]>(
      calls,
      "transact",
    );
    expect(params.externalAmount).toBe(40_000_000n);
    expect(params.depositor).toBe(FUNDER);
    expect((params.outputUtxos as unknown[]).length).toBe(1);
    expect(options.chainNoteViewingKeyNk).toBe(nk);
    expect(options.chainNoteSalt).toBe(77n);
    expect(options.relayUrl).toBe("https://relay.example");
    expect(options.walletPublicKey).toBe(FUNDER);
    expect(options.depositorPublicKey).toBe(FUNDER);
    expect(options.signer).toEqual({ isWalletSigner: true });
    expect(typeof options.signMessage).toBe("function");
    expect(options).not.toHaveProperty("depositorKeypair");
    expect(options).not.toHaveProperty("cachedMerkleTree");
  });

  it("pays part of the pool with a partial withdrawal and reuses the tree and the change", async () => {
    const { session: opened, calls, tree } = await session();
    await opened.shield(40_000_000n);
    const receipt = await opened.withdrawSol({ recipient: addr(1), grossLamports: 20_000_000n });
    expect(receipt).toEqual({ signature: "SIG_PARTIAL" });
    expect(callsOf(calls, "fullWithdraw")).toHaveLength(0);

    const [inputs, to, amount, options] = argsOf<
      [{ tag: string }[], string, bigint, Record<string, unknown>]
    >(calls, "partialWithdraw");
    expect(inputs.map((n) => n.tag)).toEqual(["note"]); // the zero note is not spent
    expect(to).toBe(addr(1));
    expect(amount).toBe(20_000_000n);
    expect(options.cachedMerkleTree).toBe(tree);
  });

  it("empties the pool with a full withdrawal when the payout is everything left", async () => {
    const { session: opened, calls } = await session();
    await opened.shield(20_000_000n);
    await opened.withdrawSol({ recipient: addr(1), grossLamports: 20_000_000n });
    expect(callsOf(calls, "fullWithdraw")).toHaveLength(1);
    expect(callsOf(calls, "partialWithdraw")).toHaveLength(0);
  });

  it("refuses to spend more than the notes hold, or before anything is shielded", async () => {
    const { session: opened } = await session();
    await expect(
      opened.withdrawSol({ recipient: addr(1), grossLamports: 1n }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    await opened.shield(10_000_000n);
    await expect(
      opened.withdrawSol({ recipient: addr(1), grossLamports: 10_000_001n }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
  });

  it("swaps into ZEC to the payee's own token account, naming the payee so the relay can open it", async () => {
    const { session: opened, calls } = await session();
    await opened.shield(40_000_000n);
    await opened.withdrawSol({ recipient: addr(1), grossLamports: 20_000_000n });
    const receipt = await opened.swapToZec({
      recipient: addr(2),
      grossLamports: 20_000_000n,
      minOutputBaseUnits: 179_340n,
    });
    expect(receipt).toEqual({ signature: "SIG_SWAP" });

    const [expectedAta] = await findAssociatedTokenPda({
      mint: realSdk.address(ZEC_MINT),
      owner: realSdk.address(addr(2)),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [inputs, amount, mint, ata, minOut, , recipientWallet] = argsOf<
      [{ tag: string }[], bigint, string, string, bigint, unknown, string]
    >(calls, "swapWithChange");
    expect(inputs.map((n) => n.tag)).toEqual(["change"]);
    expect(amount).toBe(20_000_000n);
    expect(mint).toBe(ZEC_MINT);
    expect(ata).toBe(expectedAta);
    expect(minOut).toBe(179_340n);
    expect(recipientWallet).toBe(addr(2));
  });

  it("builds the CSV from the viewing key and bounds the scan only when asked", async () => {
    const { session: opened, calls, nk } = await session();
    await expect(opened.complianceCsv()).resolves.toEqual({
      csv: "type,amount\nshield,1\n",
      rows: 3,
    });
    await opened.complianceCsv({ limit: 250 });
    const scans = callsOf(calls, "scanTransactions").map(
      (c) => c.args[0] as Record<string, unknown>,
    );
    expect(scans[0]).not.toHaveProperty("limit");
    expect(scans[1]?.limit).toBe(250);
    expect(scans[0]?.viewingKeyNk).toBe(nk);
    expect(scans[0]?.walletPublicKey).toBe(FUNDER);
  });

  describe("recovery", () => {
    type Checked = {
      amount: bigint;
      commitment: bigint;
      index?: number;
      keypair: { privateKey: bigint; publicKey: bigint };
    };
    const checkedBy = (calls: { name: string; args: unknown[] }[]) =>
      argsOf<[Checked[]]>(calls, "verifyUtxos")[0];

    it("rebuilds the notes of every run, gives each its leaf, and keeps the largest two", async () => {
      const { session: opened, calls, chain } = await session();
      // The deposit was half paid out (spent); its change and an earlier run's leftover are not.
      await expect(opened.recoverSpendable()).resolves.toEqual({
        spendableLamports: 25_000_000n,
        notes: 2,
      });
      expect(new Map(checkedBy(calls).map((note) => [note.commitment, note.index]))).toEqual(
        new Map([
          [chain.deposit.commitment, 7],
          [chain.change.commitment, 8],
          [chain.leftover.commitment, 9],
        ]),
      );
    });

    it("spends the change note with its owner's key, not the zero the scan returned", async () => {
      const { session: opened, calls, chain } = await session();
      await opened.recoverSpendable();
      const checked = checkedBy(calls);
      const change = checked.find((note) => note.commitment === chain.change.commitment);
      expect(change?.keypair).toEqual({ privateKey: 11n, publicKey: 12n });
      expect(checked.every((note) => note.keypair.privateKey !== 0n)).toBe(true);
    });

    it("looks only at the run's own deposit when asked to resume it, and never at refunds", async () => {
      const { session: opened, calls, chain } = await session();
      await expect(opened.recoverSpendable({ shieldSignature: "SHIELD1" })).resolves.toEqual({
        spendableLamports: 20_000_000n, // the earlier run's 5M is not this run's money
        notes: 1,
      });
      expect(
        checkedBy(calls)
          .map((note) => String(note.commitment))
          .sort(),
      ).toEqual([chain.deposit.commitment, chain.change.commitment].map(String).sort());
      expect(callsOf(calls, "discoverSwapRefunds")).toHaveLength(0);
    });

    it("leaves out a change note whose deposit it cannot see, and then asks the relay for nothing", async () => {
      const { session: opened, calls } = await session(walletAuth(), { orphanChange: true });
      await expect(opened.recoverSpendable({ shieldSignature: "SHIELD1" })).resolves.toEqual({
        spendableLamports: 0n,
        notes: 0,
      });
      expect(callsOf(calls, "fetchCommitments")).toHaveLength(0);
    });

    it("will not count a note the relay's list does not carry", async () => {
      const { session: opened } = await session(walletAuth(), { missingLeaves: ["change"] });
      await expect(opened.recoverSpendable({ shieldSignature: "SHIELD1" })).resolves.toEqual({
        spendableLamports: 0n,
        notes: 0,
      });
    });

    it("also finds the refund a timed-out swap leaves behind, at the leaf the SDK reports", async () => {
      const { session: opened, calls, chain } = await session(walletAuth(), { refund: true });
      // change 20M, refund 15M, leftover 5M: the two largest.
      await expect(opened.recoverSpendable()).resolves.toEqual({
        spendableLamports: 35_000_000n,
        notes: 2,
      });
      const refund = checkedBy(calls).find((note) => note.commitment === chain.refund.commitment);
      expect(refund?.index).toBe(42);
      expect(refund?.keypair.privateKey).toBe(31n);
    });

    it("will not call the pool empty when a note could not be checked", async () => {
      const { session: opened } = await session(walletAuth(), { unverifiable: true });
      await expect(opened.recoverSpendable()).rejects.toMatchObject({ code: "outcome_unknown" });
    });

    it("scans without the recipient-delivery sweep, which is not this template's money", async () => {
      const { session: opened, calls } = await session();
      await opened.recoverSpendable();
      expect(argsOf<[Record<string, unknown>]>(calls, "scanTransactions")[0]).toMatchObject({
        includeRecipientDeliveries: false,
        walletPublicKey: FUNDER,
      });
    });

    it("sweeps what recovery found to one address, recovering first when it holds nothing", async () => {
      const { session: opened, calls } = await session();
      await expect(opened.sweepAll(addr(9))).resolves.toEqual({ signature: "SIG_FULL" });
      expect(callsOf(calls, "scanTransactions")).toHaveLength(1);
      const [inputs, to] = argsOf<[Checked[], string]>(calls, "fullWithdraw");
      expect(inputs.map((note) => note.amount)).toEqual([20_000_000n, 5_000_000n]);
      expect(inputs.every((note) => note.keypair.privateKey !== 0n)).toBe(true);
      expect(to).toBe(addr(9));
    });

    it("does nothing when there is nothing to sweep", async () => {
      const { session: opened, calls } = await session(walletAuth(), { orphanChange: true });
      // Only the earlier run's leftover is left once the orphan change is dropped.
      await expect(opened.sweepAll(addr(9))).resolves.toEqual({ signature: "SIG_FULL" });
      expect(argsOf<[Checked[]]>(calls, "fullWithdraw")[0].map((n) => n.amount)).toEqual([
        5_000_000n,
      ]);
    });
  });

  it("does not reuse a tree that predates a swap's change leaf", async () => {
    const { session: opened, calls } = await session();
    await opened.shield(40_000_000n);
    await opened.swapToZec({
      recipient: addr(2),
      grossLamports: 20_000_000n,
      minOutputBaseUnits: 179_340n,
    });
    await opened.withdrawSol({ recipient: addr(1), grossLamports: 20_000_000n });
    // The swap returned no tree, and the one from the shield no longer matches the pool.
    const [, , options] = argsOf<[unknown, unknown, Record<string, unknown>]>(
      calls,
      "fullWithdraw",
    );
    expect(options).not.toHaveProperty("cachedMerkleTree");
    // ...while a payout after a payout does reuse the one the first returned.
    const second = await session();
    await second.session.shield(40_000_000n);
    await second.session.withdrawSol({ recipient: addr(1), grossLamports: 20_000_000n });
    await second.session.withdrawSol({ recipient: addr(2), grossLamports: 20_000_000n });
    const reused = argsOf<[unknown, unknown, Record<string, unknown>]>(
      second.calls,
      "fullWithdraw",
    );
    expect(reused[2]).toHaveProperty("cachedMerkleTree");
  });

  it("pins every call to the SOL pool, so a note of another mint cannot be spent by accident", async () => {
    const { session: opened, calls } = await session();
    await opened.shield(10_000_000n);
    const options = callsOf(calls, "transact")[0]?.args[1] as Record<string, unknown>;
    expect(options.expectedMint).toBe("So11111111111111111111111111111111111111112");
  });

  it("zeroes the viewing key when the session is disposed", async () => {
    const { session: opened, nk } = await session();
    expect(nk.some((b) => b !== 0)).toBe(true);
    opened.dispose();
    expect(nk.every((b) => b === 0)).toBe(true);
  });

  it("passes the SDK's progress and proof percentage to the card's listener", async () => {
    const { session: opened, calls } = await session();
    const stages: string[] = [];
    await opened.shield(10_000_000n, (message) => stages.push(message));
    const options = callsOf(calls, "transact")[0]?.args[1] as {
      onProgress: (m: string) => void;
      onProofProgress: (p: number) => void;
    };
    options.onProgress("Building transaction...");
    options.onProofProgress(49.6);
    expect(stages).toEqual(["Building transaction...", "Proof 50%"]);
  });
});

describe("the commitment transaction", () => {
  const sentTransaction = (calls: { name: string; args: unknown[] }[]) => {
    const [wire] = argsOf<[string, unknown]>(calls, "sendTransaction");
    return getTransactionDecoder().decode(new Uint8Array(Buffer.from(wire, "base64")));
  };
  const carriesMemo = (tx: { messageBytes: ArrayLike<number> }) =>
    Buffer.from(Array.from(tx.messageBytes)).includes(Buffer.from(COMMITMENT_MEMO, "utf8"));

  it("is signed by the funder's wallet, sent on its own and confirmed", async () => {
    const { handle, address, seen } = await signingWallet();
    const { session: opened, calls } = await session({ kind: "wallet", wallet: handle });
    const stages: string[] = [];

    const receipt = await opened.recordCommitment(COMMITMENT_MEMO, (message) =>
      stages.push(message),
    );

    expect(seen).toHaveLength(1); // one wallet prompt
    const sent = sentTransaction(calls);
    expect(carriesMemo(sent)).toBe(true);
    expect(Object.keys(sent.signatures)).toEqual([address]);
    expect(receipt.signature).toBe(getSignatureFromTransaction(sent));
    expect(stages).toEqual(["Sending the commitment transaction"]);
    // Nothing of the SDK's own transactions is involved: no proof, no relay, no note.
    for (const name of ["transact", "partialWithdraw", "fullWithdraw", "swapWithChange"]) {
      expect(callsOf(calls, name), name).toHaveLength(0);
    }
  });

  it("is signed by the keypair when a script runs with one", async () => {
    const signer = await generateKeyPairSigner();
    const { session: opened, calls } = await session(
      { kind: "keypair", secretKey: new Uint8Array(64).fill(4) },
      {},
      { signerFromSecretKey: async () => signer },
    );

    const receipt = await opened.recordCommitment(COMMITMENT_MEMO);

    const sent = sentTransaction(calls);
    expect(carriesMemo(sent)).toBe(true);
    expect(Object.keys(sent.signatures)).toEqual([signer.address]);
    expect(sent.signatures[signer.address]).toHaveLength(64);
    expect(receipt.signature).toBe(getSignatureFromTransaction(sent));
  });

  it("lets a closed wallet prompt through, and sends nothing", async () => {
    const { handle } = await signingWallet();
    const rejection = { code: 4001, message: "User rejected the request." };
    const refusing: BrowserWalletHandle = {
      ...handle,
      signTransaction: async () => {
        throw rejection;
      },
    };
    const { session: opened, calls } = await session({ kind: "wallet", wallet: refusing });
    await expect(opened.recordCommitment(COMMITMENT_MEMO)).rejects.toBe(rejection);
    expect(callsOf(calls, "sendTransaction")).toEqual([]);
  });
});

describe("a session in keypair mode", () => {
  it("authenticates with the key itself and has no wallet signer", async () => {
    const secretKey = new Uint8Array(64).fill(4);
    const { session: opened, calls } = await session({ kind: "keypair", secretKey });
    await opened.shield(10_000_000n);
    expect(callsOf(calls, "signerFromSecretKey")[0]?.args[0]).toBe(secretKey);
    expect(callsOf(calls, "signerFromWalletAdapter")).toHaveLength(0);
    const options = callsOf(calls, "transact")[0]?.args[1] as Record<string, unknown>;
    expect(options.depositorKeypair).toEqual({ address: "KeypairWallet" });
    expect(options.walletPublicKey).toBe("KeypairWallet");
    expect(options).not.toHaveProperty("signer");
    expect(options).not.toHaveProperty("signMessage");
  });
});
