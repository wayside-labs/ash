import { ZEC_MINT } from "@ash/contract/template-run";
import type { MerkleTree, TransactOptions, Utxo, UtxoKeypair } from "@cloak.dev/sdk";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { RunError } from "./errors.js";
import type { SignTransactionBytes } from "./memo.js";
import type {
  ChainHealth,
  PayoutSession,
  RecoverScope,
  SdkPort,
  StageListener,
  TxReceipt,
} from "./ports.js";

/**
 * The only module that talks to `@cloak.dev/sdk`. It is loaded with a dynamic import, so the proof
 * system (snarkjs, circomlib, ~100 kB of Poseidon) reaches the browser only when a run starts.
 *
 * Every secret lives in the closure `openSession` returns: the notes, the viewing key `nk` and the
 * Merkle tree. Nothing that crosses `PayoutSession` is anything but a signature, an amount or the
 * public fingerprint, which is what the runner's leak test relies on.
 *
 * The notes are never written anywhere. Deposits are built so a scan with `nk` rebuilds them
 * (`createRecoverableDepositUtxo`), change likewise, and `nk` comes from the wallet — so a lost
 * tab loses nothing (ADR-027). The price: Cloak's relay receives `nk` when the SDK registers it,
 * and for these notes that is enough to rebuild their keys. The template's cap bounds the trust.
 */

type CloakSdk = typeof import("@cloak.dev/sdk");

export interface BrowserWalletHandle {
  readonly address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Signs serialized transaction bytes and returns the signed bytes. The wallet signs first. */
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}

export type CloakAuth =
  | { kind: "wallet"; wallet: BrowserWalletHandle }
  | { kind: "keypair"; secretKey: Uint8Array };

export interface CloakAdapterOptions {
  /** A browser-friendly mainnet RPC: the Solana public endpoint answers 403 to a browser origin. */
  rpcUrl: string;
  auth: CloakAuth;
  /** A test seam; the default is a dynamic import of the SDK. */
  loadSdk?: () => Promise<CloakSdk>;
  fetchImpl?: typeof fetch;
}

const nonZero = (utxos: readonly Utxo[]): Utxo[] => utxos.filter((utxo) => utxo.amount > 0n);

/** What a scan hands back for a note it could rebuild: everything a `Utxo` needs but its leaf. */
export type RecoveredNote = {
  amount: bigint;
  keypair: UtxoKeypair;
  blinding: bigint;
  mintAddress: Utxo["mintAddress"];
  commitment: bigint;
};

const toUtxo = (note: RecoveredNote): Utxo => ({
  amount: note.amount,
  keypair: note.keypair,
  blinding: note.blinding,
  mintAddress: note.mintAddress,
  commitment: note.commitment,
});

/**
 * Turns what a scan recovered into notes that can be spent.
 *
 * A deposit note's keys derive from `nk` and the scan returns them whole. A change note keeps the
 * key of the note it was made from, which `nk` cannot give: the scan returns it with a zero
 * private key and the right public key (`matchChangeNote` is handed `privateKey: 0n`). Spending
 * one with that zero key would build a proof that fails, and `verifyUtxos` would call it unspent
 * because the nullifier it derives from a zero key is one nobody has used. So each change note
 * takes the private key of the recovered deposit note that owns the same public key, and a change
 * note whose owner is not among them is left out rather than guessed at.
 */
export function rekeyRecovered(
  deposits: readonly RecoveredNote[],
  changes: readonly RecoveredNote[],
): Utxo[] {
  const owners = new Map<bigint, UtxoKeypair>();
  for (const deposit of deposits) owners.set(deposit.keypair.publicKey, deposit.keypair);
  const notes = deposits.map(toUtxo);
  for (const change of changes) {
    const keypair =
      change.keypair.privateKey !== 0n ? change.keypair : owners.get(change.keypair.publicKey);
    if (keypair) notes.push(toUtxo({ ...change, keypair }));
  }
  return notes;
}

/**
 * signature -> master seed -> spend key -> UTXO keypair -> nk. `nk` is the root every recoverable
 * note derives from; it is what a scan needs and what the relay is given. Deterministic: the same
 * seed always yields the same `nk`, which is the whole reason nothing has to be stored.
 */
export async function deriveSessionKeys(
  sdk: CloakSdk,
  masterSeed: Uint8Array,
): Promise<{ nk: Uint8Array; fingerprint: string }> {
  const spend = sdk.deriveSpendKey(masterSeed);
  const keypair = await sdk.deriveUtxoKeypairFromSpendKey(spend.sk_spend);
  spend.sk_spend.fill(0);
  const nk = sdk.getNkFromUtxoPrivateKey(keypair.privateKey);
  // A hash of nk, not a piece of it: enough to notice different keys, useless to anyone else.
  return { nk, fingerprint: bytesToHex(sha256(nk)).slice(0, 16) };
}

/**
 * The SDK asks a wallet-adapter for a web3.js `VersionedTransaction`, but only to hand it back to
 * `signTransaction` and read `serialize()` from the result. Wire bytes are all this dashboard
 * has (it has no web3.js), so the "transaction" is a box around the bytes.
 */
export function createWalletSigner(sdk: CloakSdk, wallet: BrowserWalletHandle) {
  const adapter = {
    publicKey: { toBase58: () => wallet.address },
    signTransaction: async (transaction: { bytes: Uint8Array }) => {
      const signed = await wallet.signTransaction(transaction.bytes);
      return { serialize: () => signed };
    },
    signMessage: (message: Uint8Array) => wallet.signMessage(message),
  };
  const web3 = { VersionedTransaction: { deserialize: (bytes: Uint8Array) => ({ bytes }) } };
  return sdk.signerFromWalletAdapter(adapter, { web3 });
}

export function createCloakSdkPort(options: CloakAdapterOptions): SdkPort {
  let loaded: Promise<CloakSdk> | undefined;
  const load = (): Promise<CloakSdk> => {
    loaded ??= (options.loadSdk ?? (() => import("@cloak.dev/sdk")))().then((sdk) => {
      // The proving files are fetched from the one location this SDK build pins, and checked
      // against pinned digests; never a URL of ours.
      sdk.setCircuitsPath(sdk.DEFAULT_CIRCUITS_URL);
      return sdk;
    });
    return loaded;
  };
  const doFetch = options.fetchImpl ?? fetch;

  const rpcOf = (sdk: CloakSdk) => sdk.createCloakRpc(options.rpcUrl);

  return {
    async info() {
      const sdk = await load();
      return { sdkVersion: sdk.VERSION, programId: sdk.CLOAK_PROGRAM_ID };
    },

    async checkEndpoints(): Promise<ChainHealth> {
      const sdk = await load();
      const [rpc, circuits, relay] = await Promise.all([
        (async () => {
          try {
            await rpcOf(sdk).getLatestBlockhash().send();
            return true;
          } catch {
            return false;
          }
        })(),
        sdk.loadVerifiedCircuitArtifacts(sdk.DEFAULT_CIRCUITS_URL).then(
          () => true,
          () => false,
        ),
        doFetch(sdk.CLOAK_PRODUCTION_RELAY_URL).then(
          (response) => response.ok,
          () => false,
        ),
      ]);
      return { rpc, circuits, relay };
    },

    async balanceLamports(address: string): Promise<bigint> {
      const sdk = await load();
      const { value } = await rpcOf(sdk).getBalance(sdk.address(address)).send();
      return BigInt(value);
    },

    async accountOwner(address: string): Promise<string | null> {
      const sdk = await load();
      // No data wanted: a payee can be a program account with megabytes behind it.
      const { value } = await rpcOf(sdk)
        .getAccountInfo(sdk.address(address), {
          encoding: "base64",
          dataSlice: { offset: 0, length: 0 },
        })
        .send();
      return value ? String(value.owner) : null;
    },

    async openSession(masterSeed: Uint8Array): Promise<PayoutSession> {
      const sdk = await load();
      const rpc = rpcOf(sdk);
      const programId = sdk.CLOAK_PROGRAM_ID;

      const { nk, fingerprint } = await deriveSessionKeys(sdk, masterSeed);

      let funder: string;
      let base: Omit<TransactOptions, "onProgress" | "onProofProgress">;
      let signCommitment: SignTransactionBytes;
      if (options.auth.kind === "wallet") {
        const wallet = options.auth.wallet;
        funder = wallet.address;
        signCommitment = (wire) => wallet.signTransaction(wire);
        const address = sdk.address(funder);
        base = {
          connection: rpc,
          programId,
          relayUrl: sdk.CLOAK_PRODUCTION_RELAY_URL,
          expectedMint: sdk.NATIVE_SOL_MINT,
          chainNoteViewingKeyNk: nk,
          signer: createWalletSigner(sdk, wallet),
          signMessage: (message) => wallet.signMessage(message),
          depositorPublicKey: address,
          walletPublicKey: address,
        };
      } else {
        const signer = await sdk.signerFromSecretKey(options.auth.secretKey);
        funder = signer.address;
        signCommitment = async (wire) => {
          const kit = await import("@solana/kit");
          const transaction = kit.getTransactionDecoder().decode(wire);
          const [signatures] = await signer.signTransactions([
            transaction as Parameters<typeof signer.signTransactions>[0][number],
          ]);
          // The encoder asks for the brands a compiled transaction carries; spreading drops them.
          const signed = {
            ...transaction,
            signatures: { ...transaction.signatures, ...signatures },
          };
          return new Uint8Array(
            kit
              .getTransactionEncoder()
              .encode(
                signed as Parameters<ReturnType<typeof kit.getTransactionEncoder>["encode"]>[0],
              ),
          );
        };
        base = {
          connection: rpc,
          programId,
          relayUrl: sdk.CLOAK_PRODUCTION_RELAY_URL,
          expectedMint: sdk.NATIVE_SOL_MINT,
          chainNoteViewingKeyNk: nk,
          depositorKeypair: signer,
          walletPublicKey: signer.address,
        };
      }

      let notes: Utxo[] = [];
      let tree: MerkleTree | undefined;

      const optsFor = (onStage?: StageListener): TransactOptions => ({
        ...base,
        ...(onStage
          ? {
              onProgress: (message: string) => onStage(message),
              onProofProgress: (percent: number) => onStage(`Proof ${Math.round(percent)}%`),
            }
          : {}),
        ...(tree ? { cachedMerkleTree: tree } : {}),
      });

      const spendable = (needed: bigint): Utxo[] => {
        const total = sdk.sumUtxoAmounts(notes);
        // The SDK spends at most two notes per transaction; a run only ever holds one or two.
        if (notes.length === 0 || notes.length > 2 || total < needed) {
          throw new RunError("outcome_unknown");
        }
        return notes;
      };

      const keep = (result: { outputUtxos: Utxo[]; merkleTree?: MerkleTree | undefined }): void => {
        notes = nonZero(result.outputUtxos);
        // Assigned even when absent: a swap returns no tree, and the one in hand predates the
        // leaf it just added, so reusing it would prove the next payout against a stale root.
        tree = result.merkleTree;
      };

      const recover = async (
        scope: RecoverScope = {},
      ): Promise<{ spendableLamports: bigint; notes: number }> => {
        const scan = await sdk.scanTransactions({
          connection: rpc,
          programId,
          viewingKeyNk: nk,
          walletPublicKey: funder,
          limit: 500,
          // Notes other people sent to this wallet are not this template's money, and the sweep of
          // that registry doubles the RPC calls on a public endpoint.
          includeRecipientDeliveries: false,
        });
        const deposits = scope.shieldSignature
          ? scan.recoveredDepositNotes.filter((note) => note.signature === scope.shieldSignature)
          : scan.recoveredDepositNotes;
        const candidates = rekeyRecovered(deposits, scan.recoveredChangeNotes);

        // `transact` treats a note with value and no leaf index as a dummy path, which proves
        // nothing, and the scan does not report indices. The relay's commitment list does.
        const leaves =
          candidates.length === 0
            ? []
            : await sdk.fetchCommitments(sdk.CLOAK_PRODUCTION_RELAY_URL, {
                mint: sdk.NATIVE_SOL_MINT,
              });
        const indexOf = new Map(leaves.map((leaf) => [BigInt(`0x${leaf.commitment}`), leaf.index]));
        const located = candidates.flatMap((note) => {
          const index = note.commitment === undefined ? undefined : indexOf.get(note.commitment);
          return index === undefined ? [] : [{ ...note, index }];
        });

        // A swap that timed out comes back as a leaf the scan above cannot see. It is derived from
        // the same viewing key and carries its own index. Only a recovery to the wallet looks: a
        // resume trusts the straight chain of its own run and nothing else.
        const refunds = scope.shieldSignature
          ? []
          : await sdk.discoverSwapRefunds(rpc, programId, nk, { limit: 500 });
        const refundNotes: Utxo[] = refunds.map((refund) => ({
          amount: refund.amount,
          keypair: refund.keypair,
          blinding: refund.blinding,
          mintAddress: sdk.NATIVE_SOL_MINT,
          commitment: refund.commitment,
          index: Number(refund.leafIndex),
        }));

        const { unspent, skipped } = await sdk.verifyUtxos(
          [...located, ...refundNotes],
          rpc,
          programId,
        );
        // A note that could not be checked is neither spendable nor gone; reading it as empty
        // would tell the operator their money is not there.
        if (skipped.length > 0) throw new RunError("outcome_unknown");
        notes = [...unspent].sort((a, b) => (a.amount < b.amount ? 1 : -1)).slice(0, 2);
        return { spendableLamports: sdk.sumUtxoAmounts(notes), notes: notes.length };
      };

      return {
        fingerprint,

        async shield(amount, onStage): Promise<TxReceipt> {
          const { utxo, noteSalt } = await sdk.createRecoverableDepositUtxo(
            amount,
            nk,
            sdk.NATIVE_SOL_MINT,
          );
          const result = await sdk.transact(
            {
              inputUtxos: [await sdk.createZeroUtxo(sdk.NATIVE_SOL_MINT)],
              outputUtxos: [utxo],
              externalAmount: amount,
              depositor: sdk.address(funder),
            },
            { ...optsFor(onStage), chainNoteSalt: noteSalt },
          );
          keep(result);
          return { signature: result.signature };
        },

        async withdrawSol({ recipient, grossLamports }, onStage): Promise<TxReceipt> {
          const inputs = spendable(grossLamports);
          const to = sdk.address(recipient);
          const result =
            sdk.sumUtxoAmounts(inputs) === grossLamports
              ? await sdk.fullWithdraw(inputs, to, optsFor(onStage))
              : await sdk.partialWithdraw(inputs, to, grossLamports, optsFor(onStage));
          keep(result);
          return { signature: result.signature };
        },

        async swapToZec(
          { recipient, grossLamports, minOutputBaseUnits },
          onStage,
        ): Promise<TxReceipt> {
          const inputs = spendable(grossLamports);
          const token = await import("@solana-program/token");
          const owner = sdk.address(recipient);
          const mint = sdk.address(ZEC_MINT);
          const [recipientAta] = await token.findAssociatedTokenPda({
            mint,
            owner,
            tokenProgram: token.TOKEN_PROGRAM_ADDRESS,
          });
          // `recipientWallet` is what lets the relay open the payee's token account if it does
          // not exist yet, so a brand-new payee needs no SOL and no earlier link to us.
          const result = await sdk.swapWithChange(
            inputs,
            grossLamports,
            mint,
            recipientAta,
            minOutputBaseUnits,
            optsFor(onStage),
            owner,
          );
          keep(result);
          return { signature: result.signature };
        },

        async recordCommitment(memo, onStage): Promise<TxReceipt> {
          // Loaded here, not at the top: a run that never commits never needs it.
          const { sendMemoTransaction } = await import("./memo.js");
          onStage?.("Sending the commitment transaction");
          return sendMemoTransaction({ rpc, memo, feePayer: funder, sign: signCommitment });
        },

        recoverSpendable: (scope) => recover(scope),

        async sweepAll(recipient, onStage): Promise<TxReceipt | null> {
          if (notes.length === 0) await recover();
          if (notes.length === 0 || sdk.sumUtxoAmounts(notes) <= 0n) return null;
          const result = await sdk.fullWithdraw(notes, sdk.address(recipient), optsFor(onStage));
          keep(result);
          return { signature: result.signature };
        },

        async complianceCsv(scanOptions): Promise<{ csv: string; rows: number }> {
          const scan = await sdk.scanTransactions({
            connection: rpc,
            programId,
            viewingKeyNk: nk,
            walletPublicKey: funder,
            includeRecipientDeliveries: false,
            ...(scanOptions?.limit ? { limit: scanOptions.limit } : {}),
          });
          const report = sdk.toComplianceReport(scan);
          return { csv: sdk.formatComplianceCsv(report), rows: report.transactions.length };
        },

        dispose(): void {
          notes = [];
          tree = undefined;
          nk.fill(0);
        },
      };
    },
  };
}
