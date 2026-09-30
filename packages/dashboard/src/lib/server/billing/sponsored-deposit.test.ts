import {
  AccountRole,
  address,
  getAddressFromPublicKey,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM, transferCheckedData, USDC_MINTS } from "@/lib/solana-pay";

vi.mock("@/lib/server/solana", () => ({
  rpcFor: () => ({
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: "4NCYB3kRT8sCNodPNuCZo8VUh4xqpBQxsxed2wd9xaD4",
          lastValidBlockHeight: 100n,
        },
      }),
    }),
  }),
}));

const { associatedTokenAddress, buildSponsoredDeposit, depositInstructions, feePayer } =
  await import("./sponsored-deposit");

const RECIPIENT = address("5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD");
const CUSTOMER = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const REFERENCE = address("G2RakfbvN5nS3p6NR2PSk7fRBHPE2gub7N2bDuQfDvsP");
const MINT = address(USDC_MINTS.devnet);

describe("transferCheckedData", () => {
  it("encodes tag 12, the amount little-endian, and the decimals", () => {
    expect([...transferCheckedData(5_000_000n, 6)]).toEqual([12, 64, 75, 76, 0, 0, 0, 0, 0, 6]);
  });

  it("refuses zero and anything past u64", () => {
    expect(() => transferCheckedData(0n, 6)).toThrow();
    expect(() => transferCheckedData(2n ** 64n, 6)).toThrow();
  });
});

describe("depositInstructions", () => {
  it("opens the recipient's account at the fee payer's cost, then moves exactly the amount", async () => {
    const payer = address("11111111111111111111111111111112");
    const [create, transfer] = await depositInstructions({
      feePayer: payer,
      customer: CUSTOMER,
      recipient: RECIPIENT,
      mint: MINT,
      reference: REFERENCE,
      amountMicros: 5_000_000,
    });
    const destination = await associatedTokenAddress(RECIPIENT, MINT);

    expect(create?.accounts?.[0]).toEqual({ address: payer, role: AccountRole.WRITABLE_SIGNER });
    expect(create?.accounts?.[1]?.address).toBe(destination);

    expect(transfer?.programAddress).toBe(TOKEN_PROGRAM);
    expect(transfer?.accounts?.map((a) => a.address)).toEqual([
      await associatedTokenAddress(CUSTOMER, MINT),
      MINT,
      destination,
      CUSTOMER,
      REFERENCE,
    ]);
    // The customer signs the transfer; the fee payer signs nothing that moves tokens.
    expect(transfer?.accounts?.[3]?.role).toBe(AccountRole.READONLY_SIGNER);
    expect(transfer?.accounts?.[4]?.role).toBe(AccountRole.READONLY);
    expect(transfer?.data).toEqual(transferCheckedData(5_000_000n, 6));
  });
});

describe("buildSponsoredDeposit", () => {
  const saved = process.env.SOLANA_PAY_FEE_PAYER_KEY;
  afterEach(() => {
    process.env.SOLANA_PAY_FEE_PAYER_KEY = saved;
  });

  async function withFeePayer() {
    // The route loads a solana-keygen style array (secret then public), so the test builds one.
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const { createKeyPairFromPrivateKeyBytes } = await import("@solana/kit");
    const kp = await createKeyPairFromPrivateKeyBytes(secret, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    process.env.SOLANA_PAY_FEE_PAYER_KEY = JSON.stringify([...secret, ...pub]);
    return getAddressFromPublicKey(kp.publicKey);
  }

  const config = {
    recipient: RECIPIENT,
    cluster: "devnet" as const,
    mint: MINT,
    rpcUrl: null,
  };

  it("puts the platform in the fee payer slot, signed, and leaves the customer to sign", async () => {
    const payer = await withFeePayer();
    const wire = await buildSponsoredDeposit(
      config,
      { reference: REFERENCE, amountMicros: 5_000_000 },
      CUSTOMER,
    );
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect(message.staticAccounts[0]).toBe(payer);
    expect(tx.signatures[payer]).not.toBeNull();
    expect(tx.signatures[CUSTOMER]).toBeNull();
    expect(Object.keys(tx.signatures)).toHaveLength(2);
  });

  it("refuses to build a payment from the recipient or the fee payer itself", async () => {
    const payer = await withFeePayer();
    await expect(
      buildSponsoredDeposit(config, { reference: REFERENCE, amountMicros: 1 }, RECIPIENT),
    ).rejects.toThrow();
    await expect(
      buildSponsoredDeposit(config, { reference: REFERENCE, amountMicros: 1 }, payer),
    ).rejects.toThrow();
  });

  it("is off without a key", () => {
    delete process.env.SOLANA_PAY_FEE_PAYER_KEY;
    expect(feePayer()).toBeNull();
  });
});
