import { type Address, address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

/**
 * SPL token setup for the surfnet, done with Surfpool's cheatcodes rather than with the
 * token program.
 *
 * The surfnet forks devnet, so Circle's devnet USDC mint is already there — real decimals,
 * real mint authority, fetched from the cluster on first read. That makes the SPL leg of
 * this suite a payment in the actual token the product talks about, not in a stand-in the
 * harness minted for itself.
 *
 * What the harness cannot do is mint USDC, because it is not Circle. `surfnet_setTokenAccount`
 * writes the token account directly, which is the same move `install-program.ts` makes for
 * the loader: a surfnet owns its ledger, so state that would take an authority we do not
 * have can simply be placed.
 */

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Circle's devnet USDC, resolved out of the fork rather than created here. */
export const USDC_DEVNET = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_DECIMALS = 6;

const addr = getAddressEncoder();

export async function findAta(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addr.encode(owner), addr.encode(TOKEN_PROGRAM), addr.encode(mint)],
  });
  return ata;
}

/**
 * Create or overwrite `owner`'s associated token account for `mint`, with `amount` base
 * units in it.
 *
 * Used for two different jobs and they are worth telling apart: funding the treasury's
 * vault, which is state a deposit would otherwise have to produce, and bringing the
 * destination's account into existence, which matters because the policy is created with
 * `createDestinationAta: false` — the payment path must not be able to open accounts, so
 * the payee's account has to exist before the first payment.
 */
export async function setTokenAccount(
  rpcUrl: string,
  owner: Address,
  mint: Address,
  amount: bigint,
): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_setTokenAccount",
      // A number, not a bigint: JSON has no other integer, and these amounts are small
      // enough that the double is exact.
      params: [owner, mint, { amount: Number(amount) }],
    }),
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (body.error) {
    throw new Error(`surfnet_setTokenAccount(${owner}, ${mint}) failed: ${body.error.message}`);
  }
}

export async function tokenBalance(rpcUrl: string, ata: Address): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountBalance",
      params: [ata, { commitment: "confirmed" }],
    }),
  });
  const body = (await response.json()) as {
    result?: { value?: { amount?: string } };
    error?: { message?: string };
  };
  // An account that does not exist is a zero balance here, not an error: the assertions
  // that use this care about the difference before and after a payment.
  if (body.error) return 0n;
  return BigInt(body.result?.value?.amount ?? "0");
}
