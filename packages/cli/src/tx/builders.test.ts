/**
 * The `tx/*` builders are thin, and the risk in a thin builder is wiring: the wrong
 * instruction for the branch, the wrong PDA, or rent sent to the wrong account. These
 * assert the wiring against the generated client rather than restating the source —
 * `identifyAshInstruction` decodes the data the builder actually produced.
 */
import {
  AshInstruction,
  findEntryPda,
  findSolVaultPda,
  getCreateSessionInstructionDataDecoder,
  identifyAshInstruction,
} from "@ash/client";
import { AUTH_MODE_DIRECT_SIGNER, NATIVE_MINT } from "@ash/contract";
import {
  AccountRole,
  type Address,
  address,
  generateKeyPairSigner,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { findEventAuthority } from "../bootstrap.js";
import { buildPolicyInput, mintLimitFromDraft } from "../planners/policy.js";
import {
  buildAddAllowlistEntryInstruction,
  buildRemoveAllowlistEntryInstruction,
} from "./allowlist.js";
import { buildSetCeilingInstruction } from "./ceiling.js";
import { buildPauseInstruction, buildUnpauseInstruction } from "./controls.js";
import { buildDepositInstructions } from "./funding.js";
import { buildPolicyWriteInstruction } from "./policy.js";
import {
  buildCloseSessionInstruction,
  buildCreateSessionInstruction,
  buildRevokeSessionInstruction,
} from "./session.js";
import { buildWithdrawInstruction } from "./withdraw.js";

let operator: KeyPairSigner;
let owner: KeyPairSigner;
let guardian: KeyPairSigner;
let treasury: Address;
let policy: Address;
let session: Address;
let destinationOwner: Address;
let eventAuthority: Address;

beforeAll(async () => {
  const [op, ow, gu, tr, po, se, de] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  operator = op;
  owner = ow;
  guardian = gu;
  treasury = tr.address;
  policy = po.address;
  session = se.address;
  destinationOwner = de.address;
  eventAuthority = await findEventAuthority();
});

/** The account entry for `who`, or undefined when the instruction never mentions it. */
function accountFor(
  instruction: { accounts?: readonly { address: Address; role: number }[] },
  who: Address,
) {
  return instruction.accounts?.find((account) => account.address === who);
}

function isSigner(role: number): boolean {
  return role === AccountRole.READONLY_SIGNER || role === AccountRole.WRITABLE_SIGNER;
}

const CEILING = {
  maxPerTx: 100n,
  maxShortWindow: 1_000n,
  maxLongWindow: 1_000n,
  maxLifetime: 10_000n,
  minShortWindowSeconds: 3_600,
  minLongWindowSeconds: 86_400,
};

describe("allowlist builders", () => {
  it("derives the entry PDA and carries it into the instruction", async () => {
    const { entry, instruction } = await buildAddAllowlistEntryInstruction({
      operator,
      treasury,
      policy,
      destinationOwner,
      label: "vendor",
    });
    const [expected] = await findEntryPda({ policy, destinationOwner });
    expect(entry).toBe(expected);
    expect(accountFor(instruction, entry)).toBeDefined();
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.AddAllowlistEntry);
  });

  it("requires the operator to sign, not the owner", async () => {
    const { instruction } = await buildAddAllowlistEntryInstruction({
      operator,
      treasury,
      policy,
      destinationOwner,
      label: "vendor",
    });
    expect(isSigner(accountFor(instruction, operator.address)?.role ?? -1)).toBe(true);
    expect(accountFor(instruction, owner.address)).toBeUndefined();
  });

  // Rent from a closed entry goes back to whoever paid it, which is the operator that
  // opened it — not the treasury, whose lamports are the agent's spendable balance.
  it("returns entry rent to the operator on removal", async () => {
    const instruction = await buildRemoveAllowlistEntryInstruction({
      operator,
      treasury,
      policy,
      destinationOwner,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.RemoveAllowlistEntry);
    const rent = accountFor(instruction, operator.address);
    expect(rent).toBeDefined();
    expect(accountFor(instruction, treasury)?.role).not.toBe(AccountRole.WRITABLE_SIGNER);
  });

  it("targets the same entry PDA for add and remove", async () => {
    const { entry } = await buildAddAllowlistEntryInstruction({
      operator,
      treasury,
      policy,
      destinationOwner,
      label: "vendor",
    });
    const removal = await buildRemoveAllowlistEntryInstruction({
      operator,
      treasury,
      policy,
      destinationOwner,
    });
    expect(accountFor(removal, entry)).toBeDefined();
  });
});

describe("buildSetCeilingInstruction", () => {
  // The ceiling is the owner's instrument; an operator signature here would invert the
  // privilege direction the whole program is built on.
  it("is signed by the owner", async () => {
    const instruction = await buildSetCeilingInstruction({
      owner,
      treasury,
      mint: address(NATIVE_MINT),
      ceiling: CEILING,
      allowAnyDestination: false,
      allowCreateDestinationAta: false,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.SetCeiling);
    expect(isSigner(accountFor(instruction, owner.address)?.role ?? -1)).toBe(true);
  });

  it("carries the event authority for the audit chain", async () => {
    const instruction = await buildSetCeilingInstruction({
      owner,
      treasury,
      mint: address(NATIVE_MINT),
      ceiling: CEILING,
      allowAnyDestination: true,
      allowCreateDestinationAta: true,
    });
    expect(accountFor(instruction, eventAuthority)).toBeDefined();
  });
});

describe("pause controls", () => {
  // Pause is owner-or-guardian, unpause is owner-only: a guardian can stop the agent but
  // cannot restart it, so the kill switch stays one-way for the role that isn't the owner.
  it("lets a guardian sign the pause", async () => {
    const instruction = await buildPauseInstruction(guardian, treasury);
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.Pause);
    expect(isSigner(accountFor(instruction, guardian.address)?.role ?? -1)).toBe(true);
  });

  it("builds a distinct unpause instruction", async () => {
    const instruction = await buildUnpauseInstruction(owner, treasury);
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.Unpause);
    expect(isSigner(accountFor(instruction, owner.address)?.role ?? -1)).toBe(true);
  });
});

describe("buildPolicyWriteInstruction", () => {
  const args = buildPolicyInput(
    [
      mintLimitFromDraft(address(NATIVE_MINT), {
        perTxMax: 50n,
        shortWindowMax: 500n,
        shortWindowSeconds: 3_600,
        longWindowMax: 500n,
        longWindowSeconds: 86_400,
        lifetimeMax: 5_000n,
      }),
    ],
    1,
    false,
    false,
  );

  // `exists` is read from the chain, not the manifest, and picking the wrong branch is the
  // difference between "account already in use" and a silent no-op.
  it("creates when the policy is absent", async () => {
    const instruction = await buildPolicyWriteInstruction({
      operator,
      treasury,
      policy,
      policyName: "default",
      args,
      exists: false,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.CreatePolicy);
  });

  it("updates when the policy already exists", async () => {
    const instruction = await buildPolicyWriteInstruction({
      operator,
      treasury,
      policy,
      policyName: "default",
      args,
      exists: true,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.UpdatePolicy);
  });

  it("is signed by the operator on both branches", async () => {
    for (const exists of [false, true]) {
      const instruction = await buildPolicyWriteInstruction({
        operator,
        treasury,
        policy,
        policyName: "default",
        args,
        exists,
      });
      expect(isSigner(accountFor(instruction, operator.address)?.role ?? -1)).toBe(true);
    }
  });
});

describe("session builders", () => {
  it("creates a direct-signer session", async () => {
    const sessionKey = await generateKeyPairSigner();
    const instruction = await buildCreateSessionInstruction({
      operator,
      treasury,
      policy,
      session,
      sessionKey: sessionKey.address,
      label: "agent",
      expiresAt: 1_800_000_000n,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.CreateSession);

    const data = getCreateSessionInstructionDataDecoder().decode(instruction.data);
    expect(data.authMode).toBe(AUTH_MODE_DIRECT_SIGNER);
    expect(data.sessionKey).toBe(sessionKey.address);
    expect(data.expiresAt).toBe(1_800_000_000n);
    expect(data.label).toHaveLength(32);

    // The session key is data, not a signer: creating a session must not require the agent.
    expect(accountFor(instruction, sessionKey.address)).toBeUndefined();
  });

  // Revoke takes `authority` rather than `operator`, which is what lets the owner kill a
  // session the operator issued.
  it("revokes under a generic authority", async () => {
    const instruction = await buildRevokeSessionInstruction({
      authority: owner,
      treasury,
      policy,
      session,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.RevokeSession);
    expect(isSigner(accountFor(instruction, owner.address)?.role ?? -1)).toBe(true);
  });

  it("closes to the nominated rent destination", async () => {
    const instruction = await buildCloseSessionInstruction({
      operator,
      treasury,
      policy,
      session,
      rentDestination: owner.address,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.CloseSession);
    expect(accountFor(instruction, owner.address)).toBeDefined();
  });
});

describe("buildDepositInstructions", () => {
  // A deposit is a plain system transfer into the SOL vault PDA. Sending it to the treasury
  // account instead would credit rent, not spendable balance.
  it("transfers to the SOL vault PDA, not the treasury", async () => {
    const [solVault] = await findSolVaultPda({ treasury });
    const instructions = await buildDepositInstructions(owner, treasury, 1_000n);
    expect(instructions).toHaveLength(1);
    expect(accountFor(instructions[0] as never, solVault)).toBeDefined();
    expect(accountFor(instructions[0] as never, treasury)).toBeUndefined();
  });
});

describe("buildWithdrawInstruction", () => {
  // The native branch needs no RPC: there is no mint to read and no ATA to derive, so the
  // destination is the wallet itself rather than a token account.
  it("withdraws SOL straight to the destination", async () => {
    const instruction = await buildWithdrawInstruction({
      rpc: undefined as never,
      owner,
      treasury,
      amount: 1_000n,
      destination: destinationOwner,
    });
    expect(identifyAshInstruction(instruction)).toBe(AshInstruction.Withdraw);
    expect(accountFor(instruction, destinationOwner)).toBeDefined();
    expect(isSigner(accountFor(instruction, owner.address)?.role ?? -1)).toBe(true);
  });

  it("treats an explicit native mint the same as no mint at all", async () => {
    const [implicit, explicit] = await Promise.all([
      buildWithdrawInstruction({
        rpc: undefined as never,
        owner,
        treasury,
        amount: 1_000n,
        destination: destinationOwner,
      }),
      buildWithdrawInstruction({
        rpc: undefined as never,
        owner,
        treasury,
        amount: 1_000n,
        destination: destinationOwner,
        mint: address(NATIVE_MINT),
      }),
    ]);
    expect(explicit.accounts?.map((a) => a.address)).toEqual(
      implicit.accounts?.map((a) => a.address),
    );
  });
});
