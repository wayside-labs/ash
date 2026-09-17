import {
  getAddAllowlistEntryInstruction,
  getAddMintInstruction,
  getCreatePolicyInstruction,
  getCreateSessionInstruction,
  getCreateTreasuryInstruction,
} from "@agent-rails/client";
import {
  AccountRole,
  type Address,
  address,
  addSignersToInstruction,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  type Instruction,
  type KeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { PROGRAM_ID } from "./surfnet.js";

/** The sentinel mint that selects the `execute_payment_sol` path (program constants.rs). */
export const NATIVE_MINT = address("So11111111111111111111111111111111111111112");

const programAddress = address(PROGRAM_ID);
const addr = getAddressEncoder();
const utf8 = (s: string) => new TextEncoder().encode(s);

/** `name` and `label` are fixed 32-byte fields, zero-padded (MAX_NAME_LEN). */
export function fixed32(value: string): Uint8Array {
  const buf = new Uint8Array(32);
  buf.set(utf8(value).subarray(0, 32));
  return buf;
}

export async function findTreasuryPda(createKey: Address) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("treasury"), addr.encode(createKey)],
  });
  return a;
}

export async function findSolVaultPda(treasury: Address) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("sol_vault"), addr.encode(treasury)],
  });
  return a;
}

export async function findPolicyPda(treasury: Address, name: Uint8Array) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("policy"), addr.encode(treasury), name],
  });
  return a;
}

export async function findSessionPda(treasury: Address, sessionKey: Address) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("session"), addr.encode(treasury), addr.encode(sessionKey)],
  });
  return a;
}

export async function findAllowlistPda(policy: Address, destinationOwner: Address) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("allow"), addr.encode(policy), addr.encode(destinationOwner)],
  });
  return a;
}

export async function findReceiptPda(session: Address, intentId: Uint8Array) {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("receipt"), addr.encode(session), intentId],
  });
  return a;
}

export async function findEventAuthority() {
  const [a] = await getProgramDerivedAddress({
    programAddress,
    seeds: [utf8("__event_authority")],
  });
  return a;
}

export type Rpc = ReturnType<typeof createSolanaRpc>;

/**
 * Sign, send, and poll to confirmation over plain HTTP.
 *
 * Deliberately not `sendAndConfirmTransactionFactory`: that needs a websocket subscription
 * transport, and the blinding proxy these tests run through is HTTP-only. Setup and the
 * payment under test therefore reach the validator the same way.
 */
export async function sendIx(
  rpcUrl: string,
  payer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const rpc = createSolanaRpc(rpcUrl);
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);

  await rpc
    .sendTransaction(wire, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
    })
    .send();

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`setup transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`setup transaction ${signature} never confirmed`);
}

/**
 * A System transfer, built by hand rather than by adding `@solana-program/system`.
 *
 * The SOL vault is a system-owned PDA with zero data bytes, so depositing into it really is
 * just a transfer — four bytes of discriminator and a little-endian u64. Pulling in a
 * dependency for that would widen the supply-chain surface cargo-deny and pnpm audit gate,
 * for eleven bytes of instruction data.
 */
export function transferSol(
  source: KeyPairSigner,
  destination: Address,
  lamports: bigint,
): Instruction {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  // `addSignersToInstruction` rather than a hand-written signer meta: the base `Instruction`
  // type deliberately does not carry signers, and casting past that was hiding the fact that
  // the harness was asserting a shape the type system knows how to produce.
  return addSignersToInstruction([source], {
    programAddress: address("11111111111111111111111111111111"),
    accounts: [
      { address: source.address, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  });
}

export type RailsFixture = {
  owner: KeyPairSigner;
  treasury: Address;
  solVault: Address;
  policy: Address;
  policyName: Uint8Array;
  session: Address;
  sessionKey: KeyPairSigner;
  destination: KeyPairSigner;
  allowlistEntry: Address;
};

/**
 * Stand up a treasury, a native-SOL ceiling, a policy, an allowlist entry and a session.
 *
 * The SOL path is chosen over SPL deliberately: `execute_payment_sol` needs no mint, no
 * associated token accounts and no token program, which removes about two thirds of the
 * setup without removing any of the machinery under test. Idempotency, the receipt PDA,
 * the audit chain and the confirmation handling are identical on both paths — spec §10
 * budgets them separately only for compute.
 */
export async function setupRails(
  rpcUrl: string,
  owner: KeyPairSigner,
  options?: { perTxMax?: bigint },
): Promise<RailsFixture> {
  const perTxMax = options?.perTxMax ?? 1_000_000_000n;
  const createKey = await generateKeyPairSigner();
  const sessionKey = await generateKeyPairSigner();
  const destination = await generateKeyPairSigner();
  const eventAuthority = await findEventAuthority();

  const treasury = await findTreasuryPda(createKey.address);
  const solVault = await findSolVaultPda(treasury);
  const policyName = fixed32("e2e");
  const policy = await findPolicyPda(treasury, policyName);
  const session = await findSessionPda(treasury, sessionKey.address);
  const allowlistEntry = await findAllowlistPda(policy, destination.address);

  await sendIx(rpcUrl, owner, [
    getCreateTreasuryInstruction({
      payer: owner,
      createKey,
      treasury,
      solVault,
      eventAuthority,
      program: programAddress,
      owner: owner.address,
      operator: owner.address,
      recoveryDestination: owner.address,
      allowAnyDestination: false,
      allowCreateDestinationAta: false,
    }),
  ]);

  await sendIx(rpcUrl, owner, [
    getAddMintInstruction({
      owner,
      treasury,
      eventAuthority,
      program: programAddress,
      mint: NATIVE_MINT,
      ceiling: {
        maxPerTx: perTxMax,
        maxShortWindow: perTxMax * 10n,
        maxLongWindow: perTxMax * 100n,
        maxLifetime: perTxMax * 1000n,
        minShortWindowSeconds: 60,
        minLongWindowSeconds: 120,
      },
    }),
  ]);

  await sendIx(rpcUrl, owner, [
    getCreatePolicyInstruction({
      operator: owner,
      treasury,
      policy,
      eventAuthority,
      program: programAddress,
      name: policyName,
      args: {
        mintLimits: [
          {
            mint: NATIVE_MINT,
            perTxMax,
            shortWindowMax: perTxMax * 10n,
            shortWindowSeconds: 60,
            longWindowMax: perTxMax * 100n,
            longWindowSeconds: 120,
            lifetimeMax: perTxMax * 1000n,
          },
        ],
        destinationMode: 1,
        requireMemo: false,
        createDestinationAta: false,
      },
    }),
  ]);

  await sendIx(rpcUrl, owner, [
    getAddAllowlistEntryInstruction({
      operator: owner,
      treasury,
      policy,
      entry: allowlistEntry,
      eventAuthority,
      program: programAddress,
      destinationOwner: destination.address,
      label: fixed32("dest"),
      // 0 is the sentinel for "no override" (state.rs: effective_per_tx).
      perTxMaxOverride: 0n,
    }),
  ]);

  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
  await sendIx(rpcUrl, owner, [
    getCreateSessionInstruction({
      operator: owner,
      treasury,
      policy,
      session,
      eventAuthority,
      program: programAddress,
      sessionKey: sessionKey.address,
      label: fixed32("e2e-session"),
      expiresAt,
      authMode: 0,
    }),
  ]);

  return {
    owner,
    treasury,
    solVault,
    policy,
    policyName,
    session,
    sessionKey,
    destination,
    allowlistEntry,
  };
}
