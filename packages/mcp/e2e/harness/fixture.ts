import { readFile } from "node:fs/promises";
import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  findPolicyPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
  getAddAllowlistEntryInstructionAsync,
  getAddMintInstruction,
  getCreatePolicyInstructionAsync,
  getCreateSessionInstructionAsync,
  getCreateTreasuryInstructionAsync,
} from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import { findEventAuthorityPda } from "@agent-rails/sdk";
import {
  type Address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  type Instruction,
  type KeyPairSigner,
  pipe,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";

/**
 * A funded treasury paying native SOL to one allowlisted destination.
 *
 * Native SOL rather than an SPL mint on purpose: `add_mint` treats the native sentinel as a
 * mint that need not exist, so the fixture needs no mint account, no ATAs and no token
 * program — which keeps the setup out of the way of what the suite is actually testing.
 */

export const VENDOR_LABEL = "acme-hosting";

export type Fixture = {
  rpcUrl: string;
  treasury: Address;
  policy: Address;
  session: Address;
  solVault: Address;
  vendor: Address;
  allowlistEntry: Address;
  sessionKey: KeyPairSigner;
  feePayer: KeyPairSigner;
  owner: KeyPairSigner;
  /**
   * The vault balance once setup is done.
   *
   * Observed, not assumed: `create_treasury` seeds the sol_vault with its rent-exempt
   * floor, so this is the funding transfer plus that floor, and a test that subtracts from
   * the transfer amount alone is off by exactly the floor.
   */
  initialVaultLamports: bigint;
  /** The floor `execute_payment_sol` refuses to spend below. */
  rentExemptFloor: bigint;
};

function padded(text: string, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(new TextEncoder().encode(text));
  return bytes;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

export async function createFixture(options: {
  rpcUrl: string;
  payerKeypairPath: string;
}): Promise<Fixture> {
  const rpc = createSolanaRpc(options.rpcUrl);
  const sendTransaction = sendTransactionWithoutConfirmingFactory({ rpc });

  const payerBytes = Uint8Array.from(
    JSON.parse(await readFile(options.payerKeypairPath, "utf8")) as number[],
  );
  // Owner and operator are the same key here. The separation is an on-chain property
  // (ADR-002) and is exercised by the Rust lifecycle tests; collapsing it keeps this
  // fixture to the accounts the payment path actually reads.
  const owner = await createKeyPairSignerFromBytes(payerBytes);
  const sessionKey = await generateKeyPairSigner();
  const vendorSigner = await generateKeyPairSigner();
  const createKey = await generateKeyPairSigner();

  const [eventAuthority] = await findEventAuthorityPda();
  const send = async (instructions: Instruction[]) => {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    await sendTransaction(signed, { commitment: "confirmed" });
    await confirm(rpc, signature);
    return signature;
  };

  const [treasury] = await findTreasuryPda({ createKey: createKey.address });
  const [solVault] = await findSolVaultPda({ treasury });

  await send([
    await getCreateTreasuryInstructionAsync({
      payer: owner,
      createKey,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      owner: owner.address,
      operator: owner.address,
      recoveryDestination: owner.address,
      allowAnyDestination: false,
      allowCreateDestinationAta: false,
    }),
  ]);

  await send([
    getAddMintInstruction({
      owner,
      treasury,
      mint: NATIVE_MINT as Address,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      ceiling: {
        maxPerTx: 5n * LAMPORTS_PER_SOL,
        maxShortWindow: 10n * LAMPORTS_PER_SOL,
        maxLongWindow: 20n * LAMPORTS_PER_SOL,
        maxLifetime: 50n * LAMPORTS_PER_SOL,
        minShortWindowSeconds: 60,
        minLongWindowSeconds: 60,
      },
    }),
  ]);

  const policyName = padded("e2e-policy");
  const [policy] = await findPolicyPda({ treasury, name: policyName });

  await send([
    await getCreatePolicyInstructionAsync({
      operator: owner,
      treasury,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      name: policyName,
      args: {
        mintLimits: [
          {
            mint: NATIVE_MINT as Address,
            perTxMax: 2n * LAMPORTS_PER_SOL,
            shortWindowMax: 5n * LAMPORTS_PER_SOL,
            shortWindowSeconds: 3_600,
            longWindowMax: 10n * LAMPORTS_PER_SOL,
            longWindowSeconds: 86_400,
            lifetimeMax: 20n * LAMPORTS_PER_SOL,
          },
        ],
        // Allowlist mode: the destination must be a label the operator registered, which
        // is the configuration every injection defense in the blueprint assumes.
        destinationMode: 1,
        requireMemo: false,
        createDestinationAta: false,
      },
    }),
  ]);

  await send([
    await getAddAllowlistEntryInstructionAsync({
      operator: owner,
      treasury,
      policy,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      destinationOwner: vendorSigner.address,
      label: padded(VENDOR_LABEL),
      perTxMaxOverride: 0n,
    }),
  ]);

  const [session] = await findSessionPda({ treasury, sessionKey: sessionKey.address });
  await send([
    await getCreateSessionInstructionAsync({
      operator: owner,
      treasury,
      policy,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      sessionKey: sessionKey.address,
      label: padded("e2e-agent"),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3_600),
      authMode: 0,
    }),
  ]);

  // The vault is a plain system-owned PDA for native SOL, so funding it is a transfer.
  const vaultFunding = 10n * LAMPORTS_PER_SOL;
  await transferLamports(options.rpcUrl, options.payerKeypairPath, solVault, vaultFunding);

  // The session key and fee payer need lamports of their own to pay transaction fees.
  const feePayer = sessionKey;
  await transferLamports(
    options.rpcUrl,
    options.payerKeypairPath,
    sessionKey.address,
    LAMPORTS_PER_SOL,
  );

  const [allowlistEntry] = await import("@agent-rails/client").then((client) =>
    client.findEntryPda({ policy, destinationOwner: vendorSigner.address }),
  );

  const initialVaultLamports = await lamportsOf(options.rpcUrl, solVault);
  // Not every Kit RPC method wraps its answer: `getBalance` returns an envelope and this
  // one returns the lamports directly.
  const rentExemptFloor = await rpc.getMinimumBalanceForRentExemption(0n).send();

  return {
    rpcUrl: options.rpcUrl,
    treasury,
    policy,
    session,
    solVault,
    vendor: vendorSigner.address,
    allowlistEntry,
    sessionKey,
    feePayer,
    owner,
    initialVaultLamports,
    rentExemptFloor,
  };
}

async function confirm(rpc: ReturnType<typeof createSolanaRpc>, signature: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value } = await rpc
      .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
      .send();
    const status = value[0];
    if (status?.err) throw new Error(`fixture transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`fixture transaction ${signature} never confirmed`);
}

async function transferLamports(
  rpcUrl: string,
  fromKeypairPath: string,
  to: Address,
  lamports: bigint,
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  await run("solana", [
    "transfer",
    to,
    String(Number(lamports) / Number(LAMPORTS_PER_SOL)),
    "--url",
    rpcUrl,
    "--keypair",
    fromKeypairPath,
    "--allow-unfunded-recipient",
    "--commitment",
    "confirmed",
  ]);
}

export async function lamportsOf(rpcUrl: string, address: Address): Promise<bigint> {
  const rpc = createSolanaRpc(rpcUrl);
  const { value } = await rpc.getBalance(address).send();
  return value;
}
