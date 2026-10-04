import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import type {
  ChainHealth,
  PayoutSession,
  RecoverScope,
  SdkPort,
  TxReceipt,
  WalletPort,
} from "./ports.js";

/**
 * A stand-in for Cloak that behaves like the real adapter where it matters to the runner: the
 * keys come from the seed, the notes stay inside the session, a pool survives a restart, and any
 * step can be made to fail. It also *knows its secrets*, which is what lets a test prove that
 * nothing secret leaves the session. Used by this package's tests and by the dashboard's UI suite.
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A syntactically valid, obviously fake transaction signature (88 base58 characters). */
export function fakeSignature(n: number): string {
  let out = "";
  let block = sha256(`fake-signature:${n}`);
  for (let i = 0; i < 88; i++) {
    if (i > 0 && i % 32 === 0) block = sha256(block);
    out += BASE58[(block[i % 32] ?? 0) % 58];
  }
  return out;
}

export type FakeWalletOptions = {
  address: string;
  /** `deterministic` is a real wallet; `random` is the one the run must refuse; `reject` is a closed prompt. */
  mode?: "deterministic" | "random" | "reject";
};

export type FakeWallet = WalletPort & {
  /** Every signature handed out. The first one is the root secret of the derived keys. */
  readonly signatures: Uint8Array[];
  readonly prompts: () => number;
};

export function createFakeWallet(options: FakeWalletOptions): FakeWallet {
  const mode = options.mode ?? "deterministic";
  const signatures: Uint8Array[] = [];
  let prompts = 0;
  return {
    address: options.address,
    signatures,
    prompts: () => prompts,
    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      prompts++;
      if (mode === "reject") {
        // A real wallet rejects with a plain object, not an Error.
        throw { code: 4001, message: "User rejected the request." };
      }
      let signature: Uint8Array;
      if (mode === "random") {
        signature = randomBytes(64);
      } else {
        const head = sha256(
          new Uint8Array([...message, ...new TextEncoder().encode(options.address)]),
        );
        signature = new Uint8Array([...head, ...sha256(head)]);
      }
      signatures.push(signature);
      return signature;
    },
  };
}

type FakeStep = "shield" | "withdraw" | "swap" | "scan" | "recover" | "sweep" | "commit";

export type FakeFailure = {
  at: FakeStep;
  /** For `withdraw` and `swap`: only the payout to this recipient. */
  recipient?: string;
  /** What to throw; a function receives the receipt of the step that landed (see `landed`). */
  error: unknown;
  /** How many times to fail before succeeding again. Defaults to once. */
  times?: number;
  /** The step lands on the fake chain and then throws: a reply lost on its way back. */
  landed?: boolean;
};

export type FakeSdkOptions = {
  balanceLamports?: bigint;
  health?: Partial<ChainHealth>;
  failures?: FakeFailure[];
  sdkVersion?: string;
  programId?: string;
  /** Who owns an address, for the payee check. An address not listed has no account yet. */
  owners?: Record<string, string>;
  /** How long each shield, payout or sweep takes, so a test can act while a run is in flight. */
  latencyMs?: number;
};

export type FakeSdk = SdkPort & {
  /** Ordered log of what the runner asked for, e.g. `shield:40000000`. */
  readonly calls: string[];
  /** The scope each recovery was asked with, in order; `undefined` is an unscoped one. */
  readonly scopes: (RecoverScope | undefined)[];
  /** Every memo written on-chain through `recordCommitment`, in order. */
  readonly commitments: string[];
  /** Every address whose owner was looked up. */
  readonly lookups: string[];
  /** Every secret the fake derived, in raw, hex, and base64 forms. A leak test searches for these. */
  readonly secrets: () => string[];
  readonly openSessions: () => number;
  readonly disposedSessions: () => number;
  /** Lamports sitting in the fake pool for the keys derived from `seed`. */
  poolFor(seed: Uint8Array): bigint;
};

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createFakeSdk(options: FakeSdkOptions = {}): FakeSdk {
  const calls: string[] = [];
  const scopes: (RecoverScope | undefined)[] = [];
  const commitments: string[] = [];
  const lookups: string[] = [];
  let walletBalance = options.balanceLamports ?? 1_000_000_000n;
  const secrets = new Set<string>();
  const pools = new Map<string, bigint>(); // by fingerprint, so a new session on the same keys sees it
  const failures = (options.failures ?? []).map((f) => ({ ...f, left: f.times ?? 1 }));
  let signatureCounter = 0;
  let opened = 0;
  let disposed = 0;

  const pause = (): Promise<void> =>
    options.latencyMs
      ? new Promise((resolve) => setTimeout(resolve, options.latencyMs))
      : Promise.resolve();

  const remember = (bytes: Uint8Array): void => {
    secrets.add(bytesToHex(bytes));
    secrets.add(b64(bytes));
  };

  const takeFailure = (at: FakeStep, recipient?: string): FakeFailure | undefined => {
    const hit = failures.find(
      (f) => f.at === at && f.left > 0 && (f.recipient === undefined || f.recipient === recipient),
    );
    if (hit) hit.left--;
    return hit;
  };

  /** Throws at once for an ordinary failure; a `landed` one throws only after the step took effect. */
  const maybeFail = (at: FakeStep, recipient?: string): FakeFailure | undefined => {
    const hit = takeFailure(at, recipient);
    if (hit && !hit.landed) throw hit.error;
    return hit;
  };

  const raiseLanded = (hit: FakeFailure | undefined, receipt: TxReceipt): void => {
    if (!hit) return;
    throw typeof hit.error === "function" ? hit.error(receipt) : hit.error;
  };

  const nextReceipt = (): TxReceipt => ({ signature: fakeSignature(++signatureCounter) });

  const fingerprintOf = (seed: Uint8Array): string =>
    bytesToHex(sha256(new Uint8Array([...seed, 1]))).slice(0, 16);

  return {
    calls,
    scopes,
    commitments,
    lookups,
    secrets: () => [...secrets],
    openSessions: () => opened,
    disposedSessions: () => disposed,
    poolFor: (seed) => pools.get(fingerprintOf(seed)) ?? 0n,

    async info() {
      return {
        sdkVersion: options.sdkVersion ?? "0.0.0-fake",
        programId: options.programId ?? "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW",
      };
    },
    async checkEndpoints(): Promise<ChainHealth> {
      return { circuits: true, relay: true, rpc: true, ...options.health };
    },
    async balanceLamports() {
      return walletBalance;
    },
    async accountOwner(address) {
      lookups.push(address);
      return options.owners?.[address] ?? null;
    },

    async openSession(masterSeed: Uint8Array): Promise<PayoutSession> {
      opened++;
      // Copies, because the runner zeroes the seed it passes in.
      const seed = new Uint8Array(masterSeed);
      remember(seed);
      const spendKey = sha256(new Uint8Array([...seed, 2]));
      const viewingKey = sha256(new Uint8Array([...seed, 3]));
      remember(spendKey);
      remember(viewingKey);
      const fingerprint = fingerprintOf(seed);
      let noteCounter = 0;
      const mintNote = (): void => {
        const note = sha256(new Uint8Array([...seed, 4, ++noteCounter]));
        remember(note);
      };
      const pool = (): bigint => pools.get(fingerprint) ?? 0n;
      let live = true;

      return {
        fingerprint,
        async shield(amount) {
          calls.push(`shield:${amount}`);
          await pause();
          const hit = maybeFail("shield");
          pools.set(fingerprint, pool() + amount);
          walletBalance -= amount;
          mintNote();
          const receipt = nextReceipt();
          raiseLanded(hit, receipt);
          return receipt;
        },
        async withdrawSol({ recipient, grossLamports }) {
          calls.push(`withdraw:${recipient}:${grossLamports}`);
          await pause();
          const hit = maybeFail("withdraw", recipient);
          if (pool() < grossLamports) throw new Error("insufficient shielded balance");
          pools.set(fingerprint, pool() - grossLamports);
          mintNote();
          const receipt = nextReceipt();
          raiseLanded(hit, receipt);
          return receipt;
        },
        async swapToZec({ recipient, grossLamports, minOutputBaseUnits }) {
          calls.push(`swap:${recipient}:${grossLamports}:${minOutputBaseUnits}`);
          await pause();
          const hit = maybeFail("swap", recipient);
          if (pool() < grossLamports) throw new Error("insufficient shielded balance");
          pools.set(fingerprint, pool() - grossLamports);
          mintNote();
          const receipt = nextReceipt();
          raiseLanded(hit, receipt);
          return receipt;
        },
        async recordCommitment(memo) {
          calls.push(`commit:${memo}`);
          await pause();
          maybeFail("commit");
          commitments.push(memo);
          return nextReceipt();
        },
        async recoverSpendable(scope) {
          calls.push("recover");
          scopes.push(scope);
          maybeFail("recover");
          const spendableLamports = pool();
          return { spendableLamports, notes: spendableLamports > 0n ? 1 : 0 };
        },
        async sweepAll(recipient) {
          calls.push(`sweep:${recipient}`);
          maybeFail("sweep");
          const amount = pool();
          if (amount <= 0n) return null;
          pools.set(fingerprint, 0n);
          walletBalance += amount;
          return nextReceipt();
        },
        async complianceCsv() {
          calls.push("scan");
          maybeFail("scan");
          // Rows are public facts only, like the real report: no key, no note, no blinding.
          return { csv: "type,amount,fee,signature\nshield,0,0,fake\n", rows: 1 };
        },
        dispose() {
          if (live) disposed++;
          live = false;
          spendKey.fill(0);
          viewingKey.fill(0);
        },
      };
    },
  };
}
