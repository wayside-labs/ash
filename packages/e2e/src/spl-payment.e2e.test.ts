import { readFileSync } from "node:fs";
import { getExecutePaymentInstructionAsync } from "@agent-rails/client";
import { deriveIntentId } from "@agent-rails/contract";
import { address, createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findEventAuthority,
  findReceiptPda,
  type RailsFixture,
  sendIx,
  setupRails,
} from "./harness/rails.js";
import { PROGRAM_ID, type Surfnet, startSurfnet } from "./harness/surfnet.js";
import { TOKEN_PROGRAM, tokenBalance } from "./harness/token.js";

/**
 * `execute_payment` — the SPL path — against a real validator, in Circle's devnet USDC.
 *
 * Until this file the token path had never touched a network: layers 1 and 2 execute it in
 * LiteSVM and layer 5 only ever paid in SOL, on the argument that the two paths differ only
 * in compute (spec §10). That argument is right about the policy engine and wrong about
 * everything the token path adds on top — two associated token accounts, a mint whose
 * decimals the program reads, a CPI into a token program, and a transfer that can fail for
 * reasons the native path has no equivalent of.
 *
 * The mint is the real one, resolved out of the devnet fork. What the harness fakes is only
 * the balances, because nobody but Circle can mint that token.
 */
describe("execute_payment (SPL) against a surfnet", () => {
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
    fixture = await setupRails(surfnet.rpcUrl, owner, { usdc: true });
  }, 180_000);

  afterAll(() => surfnet?.stop());

  it("configures the mint and funds the vault", async () => {
    expect(fixture.usdc, "the fixture should carry its USDC addresses").toBeDefined();
    const usdc = fixture.usdc as NonNullable<RailsFixture["usdc"]>;

    // The mint came from the fork, not from the harness: six decimals is Circle's number.
    expect(usdc.decimals).toBe(6);
    expect(await tokenBalance(surfnet.rpcUrl, usdc.vaultAta)).toBe(1_000_000_000n);
    expect(await tokenBalance(surfnet.rpcUrl, usdc.destinationAta)).toBe(0n);
  });

  it("settles a token payment and moves units to the destination", async () => {
    const usdc = fixture.usdc as NonNullable<RailsFixture["usdc"]>;
    const amount = 25_000_000n; // 25 USDC, under the 100 per-transaction ceiling.

    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: usdc.mint,
      amount,
      reference: "e2e-spl-happy-path",
    });
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();

    const vaultBefore = await tokenBalance(surfnet.rpcUrl, usdc.vaultAta);

    await sendIx(surfnet.rpcUrl, owner, [
      await getExecutePaymentInstructionAsync({
        feePayer: owner,
        sessionKey: fixture.sessionKey,
        treasury: fixture.treasury,
        policy: fixture.policy,
        session: fixture.session,
        allowlistEntry: fixture.allowlistEntry,
        mint: usdc.mint,
        destinationOwner: fixture.destination.address,
        destinationAta: usdc.destinationAta,
        receipt,
        tokenProgram: TOKEN_PROGRAM,
        eventAuthority,
        program: address(PROGRAM_ID),
        intent: {
          intentId,
          mint: usdc.mint,
          destinationOwner: fixture.destination.address,
          amount,
          expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
          memo: new Uint8Array(),
        },
      }),
    ]);

    expect(await tokenBalance(surfnet.rpcUrl, usdc.destinationAta)).toBe(amount);
    expect(await tokenBalance(surfnet.rpcUrl, usdc.vaultAta)).toBe(vaultBefore - amount);

    const receiptAccount = await rpc.getAccountInfo(receipt, { encoding: "base64" }).send();
    expect(receiptAccount.value?.owner).toBe(PROGRAM_ID);
  });

  // The receipt is the whole idempotency story, and it has to hold on the token path too:
  // the second attempt addresses the same PDA and dies at account creation, before any
  // transfer CPI runs.
  it("refuses the same payment twice", async () => {
    const usdc = fixture.usdc as NonNullable<RailsFixture["usdc"]>;
    const amount = 25_000_000n;
    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: usdc.mint,
      amount,
      reference: "e2e-spl-happy-path",
    });
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();
    const before = await tokenBalance(surfnet.rpcUrl, usdc.destinationAta);

    await expect(
      sendIx(surfnet.rpcUrl, owner, [
        await getExecutePaymentInstructionAsync({
          feePayer: owner,
          sessionKey: fixture.sessionKey,
          treasury: fixture.treasury,
          policy: fixture.policy,
          session: fixture.session,
          allowlistEntry: fixture.allowlistEntry,
          mint: usdc.mint,
          destinationOwner: fixture.destination.address,
          destinationAta: usdc.destinationAta,
          receipt,
          tokenProgram: TOKEN_PROGRAM,
          eventAuthority,
          program: address(PROGRAM_ID),
          intent: {
            intentId,
            mint: usdc.mint,
            destinationOwner: fixture.destination.address,
            amount,
            expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
            memo: new Uint8Array(),
          },
        }),
      ]),
    ).rejects.toThrow();

    expect(await tokenBalance(surfnet.rpcUrl, usdc.destinationAta)).toBe(before);
  });

  it("refuses an amount above the per-transaction ceiling", async () => {
    const usdc = fixture.usdc as NonNullable<RailsFixture["usdc"]>;
    const amount = 500_000_000n; // 500 USDC against a ceiling of 100.
    const intentId = deriveIntentId({
      session: fixture.session,
      destination: fixture.destination.address,
      mint: usdc.mint,
      amount,
      reference: "e2e-spl-over-ceiling",
    });
    const receipt = await findReceiptPda(fixture.session, intentId);
    const eventAuthority = await findEventAuthority();
    const before = await tokenBalance(surfnet.rpcUrl, usdc.destinationAta);

    await expect(
      sendIx(surfnet.rpcUrl, owner, [
        await getExecutePaymentInstructionAsync({
          feePayer: owner,
          sessionKey: fixture.sessionKey,
          treasury: fixture.treasury,
          policy: fixture.policy,
          session: fixture.session,
          allowlistEntry: fixture.allowlistEntry,
          mint: usdc.mint,
          destinationOwner: fixture.destination.address,
          destinationAta: usdc.destinationAta,
          receipt,
          tokenProgram: TOKEN_PROGRAM,
          eventAuthority,
          program: address(PROGRAM_ID),
          intent: {
            intentId,
            mint: usdc.mint,
            destinationOwner: fixture.destination.address,
            amount,
            expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
            memo: new Uint8Array(),
          },
        }),
      ]),
    ).rejects.toThrow();

    expect(await tokenBalance(surfnet.rpcUrl, usdc.destinationAta)).toBe(before);
  });
});
