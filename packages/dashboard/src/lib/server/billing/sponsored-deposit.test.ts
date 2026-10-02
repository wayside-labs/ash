import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Instruction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from "@solana/kit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM, transferCheckedData, USDC_MINTS } from "@/lib/solana-pay";

// What the cluster was asked to send, base64 as the RPC receives it.
const sent = vi.hoisted(() => ({ wires: [] as string[] }));

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
    sendTransaction: (wire: string) => ({
      send: async () => {
        sent.wires.push(wire);
        return "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
      },
    }),
  }),
}));

const {
  associatedTokenAddress,
  buildSponsoredDeposit,
  completeSponsoredDeposit,
  depositInstructions,
  feePayer,
  MAX_PRIORITY_FEE_LAMPORTS,
  SponsoredDepositRefused,
  verifySponsoredDeposit,
} = await import("./sponsored-deposit");

const RECIPIENT = address("5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD");
const CUSTOMER = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const REFERENCE = address("G2RakfbvN5nS3p6NR2PSk7fRBHPE2gub7N2bDuQfDvsP");
const MINT = address(USDC_MINTS.devnet);
const LIGHTHOUSE = address("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
const COMPUTE_BUDGET = address("ComputeBudget111111111111111111111111111111");
const AMOUNT = 5_000_000;

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
      amountMicros: AMOUNT,
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

/** The route loads a solana-keygen style array (secret then public), so the test builds one. */
async function withFeePayer() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const kp = await createKeyPairFromPrivateKeyBytes(secret, true);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  process.env.SOLANA_PAY_FEE_PAYER_KEY = JSON.stringify([...secret, ...pub]);
  return getAddressFromPublicKey(kp.publicKey);
}

const config = { recipient: RECIPIENT, cluster: "devnet" as const, mint: MINT, rpcUrl: null };
const intent = { reference: REFERENCE, recipient: RECIPIENT, mint: MINT, amountMicros: AMOUNT };

describe("buildSponsoredDeposit", () => {
  afterEach(() => {
    delete process.env.SOLANA_PAY_FEE_PAYER_KEY;
  });

  it("puts the platform in the fee payer slot and leaves every signature to come", async () => {
    const payer = await withFeePayer();
    const wire = await buildSponsoredDeposit(config, intent, CUSTOMER);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect(message.staticAccounts[0]).toBe(payer);
    // Nothing signed here: the wallet signs first, then `submit` reads it before the fee payer.
    expect(tx.signatures[payer]).toBeNull();
    expect(tx.signatures[CUSTOMER]).toBeNull();
    expect(Object.keys(tx.signatures)).toHaveLength(2);
  });

  it("refuses to build a payment from the recipient or the fee payer itself", async () => {
    const payer = await withFeePayer();
    await expect(buildSponsoredDeposit(config, intent, RECIPIENT)).rejects.toThrow();
    await expect(buildSponsoredDeposit(config, intent, payer)).rejects.toThrow();
  });

  it("is off without a key", () => {
    expect(feePayer()).toBeNull();
  });
});

describe("verifySponsoredDeposit", () => {
  let customerKeys: CryptoKeyPair;
  let customer: Address;
  let payerKeys: CryptoKeyPair;
  let payer: Address;

  beforeAll(async () => {
    customerKeys = await generateKeyPair();
    customer = await getAddressFromPublicKey(customerKeys.publicKey);
    payerKeys = await generateKeyPair();
    payer = await getAddressFromPublicKey(payerKeys.publicKey);
  });

  const expected = () => ({
    feePayer: payer,
    recipient: RECIPIENT,
    mint: MINT,
    reference: REFERENCE,
    amountMicros: AMOUNT,
  });

  const deposit = (amountMicros = AMOUNT) =>
    depositInstructions({
      feePayer: payer,
      customer,
      recipient: RECIPIENT,
      mint: MINT,
      reference: REFERENCE,
      amountMicros,
    });

  async function compiled(feePayerAddress: Address, instructions: Instruction[]) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayerAddress, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("4NCYB3kRT8sCNodPNuCZo8VUh4xqpBQxsxed2wd9xaD4"),
            lastValidBlockHeight: 100n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    return compileTransaction(message);
  }

  /** What a wallet hands back: the message signed by `signers`, as wire bytes. */
  async function signedBy(
    signers: CryptoKeyPair[],
    instructions: Instruction[],
    feePayerAddress = payer,
  ): Promise<Uint8Array> {
    const tx = await partiallySignTransaction(
      signers,
      await compiled(feePayerAddress, instructions),
    );
    return new Uint8Array(getTransactionEncoder().encode(tx));
  }

  const refused = (wire: Uint8Array) =>
    expect(verifySponsoredDeposit(wire, expected())).rejects.toBeInstanceOf(
      SponsoredDepositRefused,
    );

  const computeBudget = (tag: number, value: bigint, bytes: 4 | 8): Instruction => {
    const data = new Uint8Array(1 + bytes);
    data[0] = tag;
    const view = new DataView(data.buffer);
    if (bytes === 4) view.setUint32(1, Number(value), true);
    else view.setBigUint64(1, value, true);
    return { programAddress: COMPUTE_BUDGET, data };
  };

  it("accepts the transfer it built once the customer has signed it", async () => {
    const wire = await signedBy([customerKeys], await deposit());
    await expect(verifySponsoredDeposit(wire, expected())).resolves.toMatchObject({ customer });
  });

  it("refuses a transfer the customer has not signed", async () => {
    await refused(await signedBy([], await deposit()));
  });

  it("refuses a customer signature over a different message", async () => {
    const asked = getTransactionDecoder().decode(await signedBy([], await deposit()));
    const other = getTransactionDecoder().decode(
      await signedBy([customerKeys], await deposit(AMOUNT + 1)),
    );
    const forged = {
      messageBytes: asked.messageBytes,
      signatures: { ...asked.signatures, [customer]: other.signatures[customer] },
    } as Transaction;
    await refused(new Uint8Array(getTransactionEncoder().encode(forged)));
  });

  it("refuses an amount other than the intent's", async () => {
    await refused(await signedBy([customerKeys], await deposit(AMOUNT - 1)));
  });

  it("refuses a transaction the fee payer has already signed", async () => {
    await refused(await signedBy([customerKeys, payerKeys], await deposit()));
  });

  it("refuses another fee payer", async () => {
    const otherKeys = await generateKeyPair();
    const other = await getAddressFromPublicKey(otherKeys.publicKey);
    await refused(await signedBy([customerKeys], await deposit(), other));
  });

  it("refuses any added instruction that names the fee payer", async () => {
    const drain: Instruction = {
      programAddress: address("11111111111111111111111111111111"),
      accounts: [
        { address: payer, role: AccountRole.WRITABLE_SIGNER },
        { address: customer, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]),
    };
    await refused(await signedBy([customerKeys], [...(await deposit()), drain]));
  });

  it("refuses a third signer, which would be another fee", async () => {
    const extraKeys = await generateKeyPair();
    const memo: Instruction = {
      programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      accounts: [
        {
          address: await getAddressFromPublicKey(extraKeys.publicKey),
          role: AccountRole.READONLY_SIGNER,
        },
      ],
      data: new TextEncoder().encode("hi"),
    };
    await refused(await signedBy([customerKeys, extraKeys], [...(await deposit()), memo]));
  });

  it("lets a wallet add Lighthouse assertions that leave the fee payer out", async () => {
    const assertion = (who: Address): Instruction => ({
      programAddress: LIGHTHOUSE,
      accounts: [{ address: who, role: AccountRole.READONLY }],
      data: new Uint8Array([7, 1]),
    });
    const kept = await signedBy([customerKeys], [...(await deposit()), assertion(customer)]);
    await expect(verifySponsoredDeposit(kept, expected())).resolves.toMatchObject({ customer });
    await refused(await signedBy([customerKeys], [...(await deposit()), assertion(payer)]));
  });

  it("accepts a modest priority fee and refuses one past the cap", async () => {
    const modest = [computeBudget(2, 100_000n, 4), computeBudget(3, 1_000n, 8)];
    const ok = await signedBy([customerKeys], [...modest, ...(await deposit())]);
    await expect(verifySponsoredDeposit(ok, expected())).resolves.toMatchObject({ customer });

    // With no limit set, the runtime's default of 200k units per instruction is what is billed.
    const pricePastCap = (MAX_PRIORITY_FEE_LAMPORTS * 1_000_000n) / 400_000n + 1n;
    await refused(
      await signedBy([customerKeys], [computeBudget(3, pricePastCap, 8), ...(await deposit())]),
    );
  });

  it("refuses bytes that are not a transaction", async () => {
    await refused(new Uint8Array([1, 2, 3]));
  });
});

describe("completeSponsoredDeposit", () => {
  afterEach(() => {
    delete process.env.SOLANA_PAY_FEE_PAYER_KEY;
    sent.wires = [];
  });

  it("adds the fee payer's signature to what the wallet signed, and sends it", async () => {
    const payer = await withFeePayer();
    const customerKeys = await generateKeyPair();
    const customer = await getAddressFromPublicKey(customerKeys.publicKey);

    const unsigned = getTransactionDecoder().decode(
      getBase64Encoder().encode(await buildSponsoredDeposit(config, intent, customer)),
    );
    const byWallet = await partiallySignTransaction([customerKeys], unsigned);
    const wire = getBase64Decoder().decode(getTransactionEncoder().encode(byWallet));

    await completeSponsoredDeposit(config, intent, wire);

    expect(sent.wires).toHaveLength(1);
    const onChain = getTransactionDecoder().decode(getBase64Encoder().encode(sent.wires[0] ?? ""));
    expect(onChain.signatures[payer]).not.toBeNull();
    expect(onChain.signatures[customer]).not.toBeNull();
  });

  it("sends nothing when the wallet's transaction is refused", async () => {
    await withFeePayer();
    await expect(completeSponsoredDeposit(config, intent, "AQID")).rejects.toBeInstanceOf(
      SponsoredDepositRefused,
    );
    expect(sent.wires).toHaveLength(0);
  });
});
