import { readFileSync } from "node:fs";
import { getExecutePaymentSolInstruction } from "@ash/client";
import { deriveIntentId } from "@ash/contract";
import { isAshError, sendPayment } from "@ash/sdk";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BlindingProxy, startBlindingProxy } from "./harness/blinding-proxy.js";
import {
  findEventAuthority,
  findReceiptPda,
  NATIVE_MINT,
  type RailsFixture,
  sendIx,
  setupRails,
  transferSol,
} from "./harness/rails.js";
import { PROGRAM_ID, type Surfnet, startSurfnet } from "./harness/surfnet.js";

/**
 * The failure that makes idempotency worth having.
 *
 * A payment is broadcast and lands; the confirmation never comes back. The client cannot
 * distinguish that from a payment that never happened, and if it guesses "denied" the agent
 * retries and pays twice. Two mechanisms stop that, and this is the only test that exercises
 * both against a validator: the SDK classifies the outcome as `indeterminate` rather than
 * denied, and the on-chain `IntentReceipt` refuses the retry even if the agent ignores it.
 *
 * `litesvm` cannot produce this state at all — there is no confirmation to withhold.
 */
describe("a dropped confirmation over a real validator", () => {
  let surfnet: Surfnet;
  let proxy: BlindingProxy;
  let fixture: RailsFixture;
  let rpc: ReturnType<typeof createSolanaRpc>;
  let owner: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;

  const amount = 125_000_000n;

  beforeAll(async () => {
    surfnet = await startSurfnet();
    proxy = await startBlindingProxy(surfnet.rpcUrl);
    rpc = createSolanaRpc(surfnet.rpcUrl);
    owner = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(surfnet.payerKeypairPath, "utf8"))),
    );
    fixture = await setupRails(surfnet.rpcUrl, owner);
    await sendIx(surfnet.rpcUrl, owner, [transferSol(owner, fixture.solVault, 5_000_000_000n)]);
  });

  afterAll(async () => {
    await proxy?.stop();
    surfnet?.stop();
  });

  async function buildPayment(intentId: Uint8Array) {
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();
    const instruction = getExecutePaymentSolInstruction({
      feePayer: owner,
      sessionKey: fixture.sessionKey,
      treasury: fixture.treasury,
      policy: fixture.policy,
      session: fixture.session,
      allowlistEntry: fixture.allowlistEntry,
      solVault: fixture.solVault,
      destinationOwner: fixture.destination.address,
      receipt,
      eventAuthority,
      program: address(PROGRAM_ID),
      intent: {
        intentId,
        mint: NATIVE_MINT,
        destinationOwner: fixture.destination.address,
        amount,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
        memo: new Uint8Array(),
      },
    });
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstruction(instruction, m),
    );
    return { message, receipt, lastValidBlockHeight: blockhash.lastValidBlockHeight };
  }

  it("reports indeterminate — never denied — when the status read is blinded", async () => {
    // Deterministic by construction: the same business fact yields the same id, which is
    // what makes the retry below collide instead of paying again (ADR-004).
    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: NATIVE_MINT,
      amount,
      reference: "invoice-4711",
    });
    const { message, receipt, lastValidBlockHeight } = await buildPayment(intentId);

    const before = await rpc.getBalance(fixture.destination.address).send();

    proxy.blindAllStatuses();
    const failure = await sendPayment({
      rpc: createSolanaRpc(proxy.url) as never,
      transactionMessage: message as never,
      lastValidBlockHeight,
      confirmTimeoutMs: 8_000,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    proxy.clearBlind();

    expect(failure, "a blinded confirmation must not resolve successfully").not.toBeNull();
    if (!isAshError(failure)) throw new Error(`expected AshError, got ${failure}`);

    // The whole point. "denied" reads as an invitation to retry; this one must not.
    expect(failure.outcome).toBe("indeterminate");
    expect(failure.reasonCode).toBe("UNRESOLVED_OUTCOME");
    expect(failure.signature).toBeDefined();

    // The client was blinded; the money was not. The transfer really did land.
    let landed = false;
    for (let i = 0; i < 40 && !landed; i += 1) {
      const after = await rpc.getBalance(fixture.destination.address).send();
      landed = after.value - before.value === amount;
      if (!landed) await new Promise((r) => setTimeout(r, 250));
    }
    expect(landed, "the payment the client could not see must still have settled").toBe(true);

    const receiptAccount = await rpc.getAccountInfo(receipt, { encoding: "base64" }).send();
    expect(receiptAccount.value?.owner, "the receipt is what makes the retry collide").toBe(
      PROGRAM_ID,
    );

    // The client did poll for the status rather than giving up on the send.
    expect(proxy.calls).toContain("getSignatureStatuses");
  });

  it("refuses the retry on-chain when the agent ignores the warning and pays again", async () => {
    // Same business fact, therefore the same intent_id, therefore the same receipt PDA.
    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: NATIVE_MINT,
      amount,
      reference: "invoice-4711",
    });
    const before = await rpc.getBalance(fixture.destination.address).send();

    const retry = await sendIx(surfnet.rpcUrl, owner, [
      await buildPaymentInstruction(intentId),
    ]).then(
      () => null,
      (error: unknown) => error,
    );

    expect(retry, "a second payment on a spent intent_id must fail").not.toBeNull();
    expect(String(retry)).toMatch(/already in use|custom program error|failed/i);

    const after = await rpc.getBalance(fixture.destination.address).send();
    expect(after.value - before.value, "no second transfer may occur").toBe(0n);
  });

  async function buildPaymentInstruction(intentId: Uint8Array) {
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();
    return getExecutePaymentSolInstruction({
      feePayer: owner,
      sessionKey: fixture.sessionKey,
      treasury: fixture.treasury,
      policy: fixture.policy,
      session: fixture.session,
      allowlistEntry: fixture.allowlistEntry,
      solVault: fixture.solVault,
      destinationOwner: fixture.destination.address,
      receipt,
      eventAuthority,
      program: address(PROGRAM_ID),
      intent: {
        intentId,
        mint: NATIVE_MINT,
        destinationOwner: fixture.destination.address,
        amount,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
        memo: new Uint8Array(),
      },
    });
  }
});
