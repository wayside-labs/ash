/**
 * The seams of a private payout. The runner sees only these, and every method returns public data
 * (signatures, amounts, a fingerprint): the notes, the spend key and the viewing key live inside
 * whatever implements `PayoutSession` and never cross this boundary, so the runner cannot leak
 * what it never holds.
 */

/** The operator's wallet, as far as the runner needs it. */
export interface WalletPort {
  readonly address: string;
  /** Raw 64-byte Ed25519 signature over `message`; the caller normalises wallet-specific shapes. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface ChainHealth {
  circuits: boolean;
  relay: boolean;
  rpc: boolean;
}

export interface TxReceipt {
  signature: string;
}

/** A short, fixed-vocabulary status the card can show while the SDK proves and submits. */
export type StageListener = (message: string) => void;

/** What a recovery may trust as belonging to the run it serves. */
export interface RecoverScope {
  /**
   * Only the notes that descend from this deposit: the money of one run. A resume passes it, so a
   * note left by an earlier run cannot stand in for a payout that landed without being recorded.
   * Without it the scan answers for every note the wallet's keys can rebuild, swap refunds
   * included, which is what a recovery to the wallet wants.
   */
  shieldSignature?: string;
}

export interface PayoutSession {
  /**
   * A short hash of the derived viewing key: it cannot be inverted, and it is all a later run needs
   * to notice that the wallet now derives different keys, before any funds are shielded.
   */
  readonly fingerprint: string;
  shield(amountLamports: bigint, onStage?: StageListener): Promise<TxReceipt>;
  withdrawSol(
    args: { recipient: string; grossLamports: bigint },
    onStage?: StageListener,
  ): Promise<TxReceipt>;
  swapToZec(
    args: { recipient: string; grossLamports: bigint; minOutputBaseUnits: bigint },
    onStage?: StageListener,
  ): Promise<TxReceipt>;
  /**
   * Writes `memo` on-chain in a transaction of its own (SPL Memo program), signed by the funder.
   * Nothing to do with a payout: it is how a hash of the privacy text is committed before the
   * text is revealed.
   */
  recordCommitment(memo: string, onStage?: StageListener): Promise<TxReceipt>;
  /** Rebuilds spendable notes from the chain with the derived viewing key. */
  recoverSpendable(scope?: RecoverScope): Promise<{ spendableLamports: bigint; notes: number }>;
  /** Withdraws everything spendable to `recipient`; `null` when there is nothing to move. */
  sweepAll(recipient: string, onStage?: StageListener): Promise<TxReceipt | null>;
  /** CSV of this wallet's Cloak history, from the viewing key. Holds no key material. */
  complianceCsv(options?: { limit?: number }): Promise<{ csv: string; rows: number }>;
  /** Drops every secret the session holds. */
  dispose(): void;
}

export interface SdkPort {
  info(): Promise<{ sdkVersion: string; programId: string }>;
  checkEndpoints(): Promise<ChainHealth>;
  balanceLamports(address: string): Promise<bigint>;
  /** The program that owns `address`, or `null` when no account exists there yet. */
  accountOwner(address: string): Promise<string | null>;
  /** Derives the session's keys from `masterSeed`; the caller zeroes the seed afterwards. */
  openSession(masterSeed: Uint8Array): Promise<PayoutSession>;
}
