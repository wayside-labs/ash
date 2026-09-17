import { stringifyRpcError } from "@agent-rails/sdk";
import {
  AccountRole,
  type Address,
  address,
  addSignersToInstruction,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Instruction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import { CliError } from "./errors.js";

export type Rpc = ReturnType<typeof createSolanaRpc>;

export const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");

export function connect(rpcUrl: string): Rpc {
  return createSolanaRpc(rpcUrl);
}

/**
 * Sign, send, and poll one transaction to `confirmed` over plain HTTP.
 *
 * HTTP-only rather than `sendAndConfirmTransactionFactory` for the same reason the E2E
 * harness is: the confirm factory needs a websocket subscription transport, and requiring
 * one would mean a `--rpc` that works for reads but fails at the first write. A bootstrap
 * command must work against whatever URL the developer already has.
 */
export async function sendTransaction(
  rpc: Rpc,
  feePayer: TransactionSigner,
  instructions: Instruction[],
  options: { timeoutMs?: number; label: string },
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
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

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new CliError(`${options.label} failed on-chain: ${stringifyRpcError(status.err)}`, {
        hint: `Inspect the transaction: ${signature}`,
      });
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await sleep(400);
  }

  // Never reported as a failure. The transaction may still land, and telling a developer
  // that a treasury was not created when it was is how a re-run creates a second one.
  throw new CliError(`${options.label} was not confirmed within ${timeoutMs / 1000}s`, {
    hint:
      `The transaction may still land. Check ${signature}, then re-run init — ` +
      "it resumes from whatever already exists on-chain.",
  });
}

/** Which of these accounts currently exist. Drives the resume logic in `bootstrap.ts`. */
export async function accountsExist(rpc: Rpc, addresses: Address[]): Promise<boolean[]> {
  if (addresses.length === 0) return [];
  const { value } = await rpc
    .getMultipleAccounts(addresses, {
      commitment: "confirmed",
      encoding: "base64",
      // A zero-length slice: this probe asks whether the accounts exist, not what is in them.
      dataSlice: { offset: 0, length: 0 },
    })
    .send();
  return addresses.map((_, i) => value[i] != null);
}

export async function getBalance(rpc: Rpc, account: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(account, { commitment: "confirmed" }).send();
  return BigInt(value);
}

/**
 * Assert the program is actually deployed here before anything is signed.
 *
 * This check exists because the failure it prevents is genuinely unreadable: with no
 * program at the address, `create_treasury` comes back as `ProgramAccountNotFound`, which
 * reads like a bug in the CLI rather than "you pointed this at a cluster that has no
 * Agent Rails on it". It is the single most likely first-run failure, since the program id
 * is declared in the source long before it is deployed to any given cluster.
 */
export async function assertProgramDeployed(
  rpc: Rpc,
  programAddress: Address,
  rpcUrl: string,
): Promise<void> {
  const { value } = await rpc
    .getAccountInfo(programAddress, { commitment: "confirmed", encoding: "base64" })
    .send();

  if (value == null) {
    throw new CliError(`Agent Rails (${programAddress}) is not deployed at ${rpcUrl}`, {
      hint:
        "Point --rpc at a cluster where the program is deployed, or run a local surfnet:\n" +
        "  surfpool start -n devnet --no-studio\n" +
        "  agent-rails init --rpc http://127.0.0.1:8899",
    });
  }
  if (!value.executable) {
    throw new CliError(`${programAddress} exists at ${rpcUrl} but is not an executable program`, {
      hint: "The address is occupied by a non-program account. Check the cluster.",
    });
  }
}

/**
 * A System transfer, built by hand rather than by adding `@solana-program/system`.
 *
 * The SOL vault is a system-owned PDA with zero data bytes, so funding it really is just a
 * transfer: a four-byte discriminator and a little-endian u64. The same reasoning as the
 * E2E harness — a dependency is not worth twelve bytes of instruction data on a package
 * whose whole job is to be `npx`-able.
 */
export function transferSol(
  source: TransactionSigner,
  destination: Address,
  amount: bigint,
): Instruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, amount, true);
  return addSignersToInstruction([source], {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: source.address, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
  });
}

/**
 * Ask the cluster faucet for SOL, and report failure rather than throwing.
 *
 * Devnet's faucet is rate-limited per IP and refuses far more often than it obliges, so a
 * throw here would abort a bootstrap over something the developer can fix in ten seconds
 * at faucet.solana.com. The caller decides whether the resulting balance is enough.
 */
export async function tryAirdrop(
  rpcUrl: string,
  recipient: Address,
  amount: bigint,
): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  // `requestAirdrop` exists only on a cluster-branded RPC type, because mainnet has no
  // faucet. Branding the URL devnet is what makes the method visible; a cluster that has no
  // faucet then refuses at runtime, which this function already reports rather than throws.
  const rpc = createSolanaRpc(devnet(rpcUrl));
  try {
    const signature = await rpc.requestAirdrop(recipient, lamports(amount)).send();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) return { ok: false, reason: stringifyRpcError(status.err) };
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return { ok: true, signature };
      }
      await sleep(400);
    }
    return { ok: false, reason: "the airdrop was not confirmed in time" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
