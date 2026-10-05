import {
  getAddAllowlistEntryInstruction,
  getAddMintInstruction,
  getCreatePolicyInstruction,
  getCreateSessionInstruction,
  getCreateTreasuryInstruction,
} from "@ash/client";
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
import { findAta, setTokenAccount, TOKEN_PROGRAM, USDC_DECIMALS, USDC_DEVNET } from "./token.js";

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
  /** Present when the fixture was set up with `usdc: true`. */
  usdc?: {
    mint: Address;
    decimals: number;
    vaultAta: Address;
    destinationAta: Address;
  };
};

/**
 * Stand up a treasury, a native-SOL ceiling, a policy, an allowlist entry and a session.
 *
 * SOL is the default because `execute_payment_sol` needs no mint, no associated token
 * accounts and no token program: two thirds less setup for the same machinery, since
 * idempotency, the receipt PDA, the audit chain and the confirmation handling are identical
 * on both paths and spec §10 separates them only on compute.
 *
 * `usdc: true` adds the token path on top, in Circle's actual devnet USDC — the fork
 * already has that mint, so the SPL leg is not a payment in a token the harness invented.
 */
export async function setupRails(
  rpcUrl: string,
  owner: KeyPairSigner,
  options?: { perTxMax?: bigint; usdc?: boolean; usdcVaultAmount?: bigint },
): Promise<RailsFixture> {
  const perTxMax = options?.perTxMax ?? 1_000_000_000n;
  const withUsdc = options?.usdc ?? false;
  // Base units. 1000 USDC in the vault, and a per-payment ceiling of 100.
  const usdcPerTx = 100_000_000n;
  const usdcVaultAmount = options?.usdcVaultAmount ?? 1_000_000_000n;
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

  const usdcVaultAta = withUsdc ? await findAta(treasury, USDC_DEVNET) : undefined;
  if (withUsdc && usdcVaultAta) {
    // The vault ATA is created by this instruction's own CPI, which is why funding it has
    // to come after — and why `add_mint` is what the CLI insists on running before a
    // policy that prices the mint.
    //
    // `vault_ata` and `token_program` are optional in the IDL because the native path omits
    // both; on the SPL path the handler refuses without them (`TokenProgramMismatch`), so a
    // token mint has to name the account its CPI is about to create.
    await sendIx(rpcUrl, owner, [
      getAddMintInstruction({
        owner,
        treasury,
        eventAuthority,
        program: programAddress,
        mint: USDC_DEVNET,
        vaultAta: usdcVaultAta,
        tokenProgram: TOKEN_PROGRAM,
        ceiling: {
          maxPerTx: usdcPerTx,
          maxShortWindow: usdcPerTx * 10n,
          maxLongWindow: usdcPerTx * 100n,
          maxLifetime: usdcPerTx * 1000n,
          minShortWindowSeconds: 60,
          minLongWindowSeconds: 120,
        },
      }),
    ]);
  }

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
          ...(withUsdc
            ? [
                {
                  mint: USDC_DEVNET,
                  perTxMax: usdcPerTx,
                  shortWindowMax: usdcPerTx * 10n,
                  shortWindowSeconds: 60,
                  longWindowMax: usdcPerTx * 100n,
                  longWindowSeconds: 120,
                  lifetimeMax: usdcPerTx * 1000n,
                },
              ]
            : []),
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

  let usdc: RailsFixture["usdc"];
  if (withUsdc && usdcVaultAta) {
    const vaultAta = usdcVaultAta;
    const destinationAta = await findAta(destination.address, USDC_DEVNET);
    // The vault gets a balance the treasury never deposited, and the destination gets an
    // account it never opened. Both are cheatcodes rather than instructions because the
    // policy is created with `createDestinationAta: false` — the payment path must not be
    // able to open accounts, so the payee's has to exist beforehand — and because nobody
    // but Circle can mint the token being paid.
    await setTokenAccount(rpcUrl, treasury, USDC_DEVNET, usdcVaultAmount);
    await setTokenAccount(rpcUrl, destination.address, USDC_DEVNET, 0n);
    usdc = { mint: USDC_DEVNET, decimals: USDC_DECIMALS, vaultAta, destinationAta };
  }

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
    ...(usdc ? { usdc } : {}),
  };
}

export { TOKEN_PROGRAM, USDC_DEVNET };
