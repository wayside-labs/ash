import { readFileSync } from "node:fs";
import { getExecutePaymentSolInstruction } from "@ash/client";
import { deriveIntentId } from "@ash/contract";
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * The happy path, end to end, against a real validator.
 *
 * Everything below layer 5 of the ADR-008 pyramid executes instructions without a network:
 * `litesvm` has no blockhash that expires and no confirmation to wait on. This is the only
 * place the client's transport assumptions are tested at all.
 */
describe("execute_payment_sol against a surfnet", () => {
  let surfnet: Surfnet;
  let fixture: RailsFixture;
  let rpc: ReturnType<typeof createSolanaRpc>;
  let owner: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;

  beforeAll(async () => {
    surfnet = await startSurfnet();
    rpc = createSolanaRpc(surfnet.rpcUrl);
    owner = await createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(readFileSync(surfnet.payerKeypairPath, "utf8"))),
    );
    fixture = await setupRails(surfnet.rpcUrl, owner);

    // Fund the SOL vault. It is a system-owned PDA with no data, so a deposit is a plain
    // transfer.
    await sendIx(surfnet.rpcUrl, owner, [transferSol(owner, fixture.solVault, 5_000_000_000n)]);
  });

  afterAll(() => surfnet?.stop());

  it("deploys the program and stands up a treasury, policy and session", async () => {
    const program = await rpc.getAccountInfo(address(PROGRAM_ID), { encoding: "base64" }).send();
    expect(program.value?.executable).toBe(true);

    for (const account of [fixture.treasury, fixture.policy, fixture.session]) {
      const info = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
      expect(info.value, `${account} should exist on the surfnet`).not.toBeNull();
      expect(info.value?.owner).toBe(PROGRAM_ID);
    }

    const vault = await rpc.getBalance(fixture.solVault).send();
    expect(vault.value).toBeGreaterThan(0n);
  });

  it("settles a payment and moves lamports to the destination", async () => {
    const amount = 250_000_000n;
    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: NATIVE_MINT,
      amount,
      reference: "e2e-happy-path",
    });
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();

    const before = await rpc.getBalance(fixture.destination.address).send();

    await sendIx(surfnet.rpcUrl, owner, [
      getExecutePaymentSolInstruction({
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
      }),
    ]);

    const after = await rpc.getBalance(fixture.destination.address).send();
    expect(after.value - before.value).toBe(amount);

    // The receipt is the idempotency record; without it a retry has nothing to collide with.
    const receiptAccount = await rpc.getAccountInfo(receipt, { encoding: "base64" }).send();
    expect(receiptAccount.value?.owner).toBe(PROGRAM_ID);
  });
});
