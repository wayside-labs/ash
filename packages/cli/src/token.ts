import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenAddress,
  TOKEN_PROGRAM_ADDRESS,
} from "@agent-rails/sdk";
import {
  AccountRole,
  type Address,
  address,
  addSignersToInstruction,
  getAddressEncoder,
  getBase64Encoder,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { CliError } from "./errors.js";
import type { Rpc } from "./rpc.js";
import { SYSTEM_PROGRAM_ADDRESS } from "./rpc.js";

export const TOKEN_2022_PROGRAM_ADDRESS = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** SPL Token `Mint`: the base layout Token-2022 also starts with. */
const MINT_ACCOUNT_SIZE = 82;
const MINT_DECIMALS_OFFSET = 44;

const addressEncoder = getAddressEncoder();

export type MintInfo = {
  mint: Address;
  /** Owner of the mint account: SPL Token or Token-2022. `add_mint` requires these to match. */
  tokenProgram: Address;
  decimals: number;
  /** ATA of the *treasury* PDA, which is what the program derives and writes into. */
  vaultAta: Address;
};

/**
 * Read a mint off the chain so the CLI can derive the vault ATA and convert amounts.
 *
 * The token program is read from the account's owner rather than taken as a flag: `add_mint`
 * requires `mint.owner == token_program`, and the vault ATA is derived from the token program
 * too, so guessing it wrong produces a `TokenProgramMismatch` or a silently different ATA.
 * The chain already knows which it is.
 */
export async function readMint(rpc: Rpc, mint: Address, treasury: Address): Promise<MintInfo> {
  const { value } = await rpc
    .getAccountInfo(mint, { commitment: "confirmed", encoding: "base64" })
    .send();

  if (value == null) {
    throw new CliError(`No account at ${mint}`, {
      hint: "Check the mint address, and that it exists on this cluster.",
    });
  }

  const owner = value.owner as Address;
  if (owner !== TOKEN_PROGRAM_ADDRESS && owner !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new CliError(`${mint} is not an SPL Token or Token-2022 mint`, {
      hint: `It is owned by ${owner}.`,
    });
  }

  const data = getBase64Encoder().encode(value.data[0]);
  if (data.length < MINT_ACCOUNT_SIZE) {
    throw new CliError(`${mint} is too small to be a mint account`, {
      hint: `Expected at least ${MINT_ACCOUNT_SIZE} bytes, found ${data.length}.`,
    });
  }

  const decimals = data[MINT_DECIMALS_OFFSET];
  if (decimals === undefined) {
    throw new CliError(`Could not read decimals from ${mint}`);
  }

  const [vaultAta] = await findAssociatedTokenAddress({
    owner: treasury,
    mint,
    tokenProgram: owner,
  });

  return { mint, tokenProgram: owner, decimals, vaultAta };
}

/**
 * The instructions that bring a brand-new SPL mint into existence.
 *
 * Hand-rolled rather than pulling in `@solana-program/token`, for the same reason the SOL
 * transfer is: this is three fixed-layout instructions totalling under a hundred bytes of
 * data, against a dependency on a package whose other ninety per cent this CLI will never
 * call. The layouts are stable — they are consensus, not API.
 */
export function createMintInstructions(input: {
  payer: TransactionSigner;
  mint: TransactionSigner;
  mintAuthority: Address;
  decimals: number;
  rentLamports: bigint;
}): Instruction[] {
  return [
    createAccountInstruction({
      payer: input.payer,
      newAccount: input.mint,
      lamports: input.rentLamports,
      space: BigInt(MINT_ACCOUNT_SIZE),
      owner: TOKEN_PROGRAM_ADDRESS,
    }),
    initializeMint2Instruction({
      mint: input.mint.address,
      decimals: input.decimals,
      mintAuthority: input.mintAuthority,
    }),
  ];
}

/** System `CreateAccount` (instruction 0). */
function createAccountInstruction(input: {
  payer: TransactionSigner;
  newAccount: TransactionSigner;
  lamports: bigint;
  space: bigint;
  owner: Address;
}): Instruction {
  const data = new Uint8Array(52);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, true);
  view.setBigUint64(4, input.lamports, true);
  view.setBigUint64(12, input.space, true);
  data.set(addressEncoder.encode(input.owner), 20);

  return addSignersToInstruction([input.payer, input.newAccount], {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: input.newAccount.address, role: AccountRole.WRITABLE_SIGNER },
    ],
    data,
  });
}

/**
 * SPL Token `InitializeMint2` (instruction 20).
 *
 * `InitializeMint2` rather than `InitializeMint`, because the original takes the rent
 * sysvar as an account and this one does not.
 */
function initializeMint2Instruction(input: {
  mint: Address;
  decimals: number;
  mintAuthority: Address;
}): Instruction {
  const data = new Uint8Array(67);
  data[0] = 20;
  data[1] = input.decimals;
  data.set(addressEncoder.encode(input.mintAuthority), 2);
  // `COption<Pubkey>` freeze authority, set to `None`. A freeze authority on a throwaway
  // devnet mint is a foot-gun with no upside: it can freeze the vault's own ATA.
  data[34] = 0;

  return {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: [{ address: input.mint, role: AccountRole.WRITABLE }],
    data: data.subarray(0, 35),
  };
}

/** SPL Token `MintTo` (instruction 7). */
export function mintToInstruction(input: {
  mint: Address;
  destination: Address;
  authority: TransactionSigner;
  amount: bigint;
}): Instruction {
  const data = new Uint8Array(9);
  data[0] = 7;
  new DataView(data.buffer).setBigUint64(1, input.amount, true);

  return addSignersToInstruction([input.authority], {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.mint, role: AccountRole.WRITABLE },
      { address: input.destination, role: AccountRole.WRITABLE },
      { address: input.authority.address, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  });
}

/** Rent for a mint account, read from the cluster rather than hardcoded. */
export async function mintRentLamports(rpc: Rpc): Promise<bigint> {
  const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(MINT_ACCOUNT_SIZE)).send();
  return BigInt(lamports);
}

/** Balance of a token account, or 0 when it does not exist yet. */
export async function tokenBalance(rpc: Rpc, tokenAccount: Address): Promise<bigint> {
  try {
    const { value } = await rpc
      .getTokenAccountBalance(tokenAccount, { commitment: "confirmed" })
      .send();
    return BigInt(value.amount);
  } catch {
    // The ATA is created by `add_mint`, so on a first run it legitimately does not exist.
    return 0n;
  }
}

/**
 * Associated Token Account `CreateIdempotent` (instruction 1).
 *
 * Needed because the CLI deliberately leaves `allow_create_destination_ata` false on the
 * treasury: that flag lets the *program* open a token account mid-payment, which is a
 * permission the strictest treasury should not carry just so a first payment can land.
 * Creating the destination's account here instead costs the operator a one-off rent
 * payment at setup and leaves the payment path with no account-creation power at all.
 *
 * Permissionless by design — anyone may open anyone's associated token account — so this
 * works whether the destination is the generated demo key or a third party who has never
 * touched this mint. `CreateIdempotent` rather than `Create` so a re-run is a no-op
 * rather than a failure.
 */
export function createAssociatedTokenAccountIdempotentInstruction(input: {
  payer: TransactionSigner;
  owner: Address;
  mint: Address;
  associatedAccount: Address;
  tokenProgram: Address;
}): Instruction {
  return addSignersToInstruction([input.payer], {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: input.associatedAccount, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: input.tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  });
}
