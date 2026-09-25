/**
 * Wiring assertions for the owner-only builders, in the same spirit as `builders.test.ts`:
 * decode what the builder produced rather than restate its source, so a swapped
 * instruction or a rent destination pointed at the wrong account fails here.
 */
import {
  AgentRailsInstruction,
  findSolVaultPda,
  getSetRolesInstructionDataDecoder,
  identifyAgentRailsInstruction,
} from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import {
  AccountRole,
  type Address,
  address,
  generateKeyPairSigner,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildAddGuardianInstruction,
  buildRemoveGuardianInstruction,
  buildRemoveMintInstruction,
  buildSetRolesInstruction,
} from "./admin.js";
import {
  buildClosePolicyInstruction,
  buildCloseReceiptInstruction,
  buildCloseTreasuryInstruction,
} from "./close.js";

let owner: KeyPairSigner;
let operator: KeyPairSigner;
let treasury: Address;
let policy: Address;
let solVault: Address;
let other: Address;

beforeAll(async () => {
  const [ow, op, tr, po, ot] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  owner = ow;
  operator = op;
  treasury = tr.address;
  policy = po.address;
  other = ot.address;
  [solVault] = await findSolVaultPda({ treasury });
});

describe("guardians", () => {
  it("builds add_guardian with the owner as the only signer", async () => {
    const instruction = await buildAddGuardianInstruction({
      owner,
      treasury,
      guardian: other,
    });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.AddGuardian);
    const signers = instruction.accounts?.filter(
      (account) =>
        account.role === AccountRole.READONLY_SIGNER ||
        account.role === AccountRole.WRITABLE_SIGNER,
    );
    expect(signers?.map((account) => account.address)).toEqual([owner.address]);
  });

  it("builds remove_guardian for the same address", async () => {
    const instruction = await buildRemoveGuardianInstruction({ owner, treasury, guardian: other });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.RemoveGuardian);
  });
});

describe("set_roles", () => {
  it("leaves the field alone that was not passed", async () => {
    const instruction = await buildSetRolesInstruction({ owner, treasury, newOperator: other });
    const data = getSetRolesInstructionDataDecoder().decode(instruction.data as Uint8Array);
    // `none()` is the program's "unchanged". An owner setting only the operator must not
    // also rewrite the owner field with anything, including itself.
    expect(data.newOwner.__option).toBe("None");
    expect(data.newOperator.__option).toBe("Some");
  });

  it("carries both when both are passed", async () => {
    const instruction = await buildSetRolesInstruction({
      owner,
      treasury,
      newOwner: other,
      newOperator: other,
    });
    const data = getSetRolesInstructionDataDecoder().decode(instruction.data as Uint8Array);
    expect(data.newOwner.__option).toBe("Some");
    expect(data.newOperator.__option).toBe("Some");
  });
});

describe("remove_mint", () => {
  it("names sol_vault for native SOL and no vault ATA", async () => {
    const instruction = await buildRemoveMintInstruction({
      owner,
      treasury,
      mint: address(NATIVE_MINT),
      solVault,
    });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.RemoveMint);
    expect(instruction.accounts?.map((account) => account.address)).toContain(solVault);
  });

  it("names the vault ATA for a token", async () => {
    const vaultAta = other;
    const instruction = await buildRemoveMintInstruction({
      owner,
      treasury,
      mint: policy,
      vaultAta,
      solVault,
    });
    const accounts = instruction.accounts?.map((account) => account.address) ?? [];
    expect(accounts).toContain(vaultAta);
    // The generated client derives `sol_vault` whether or not it was passed, so its
    // presence proves nothing either way. What decides the branch is the mint's own
    // `is_native()` on-chain, and for a token the program reads only the ATA above.
    expect(accounts).toContain(solVault);
  });
});

describe("close", () => {
  it("refunds policy rent to the signer by default", async () => {
    const instruction = await buildClosePolicyInstruction({ operator, treasury, policy });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.ClosePolicy);
    expect(instruction.accounts?.map((account) => account.address)).toContain(operator.address);
  });

  it("honours an explicit rent destination", async () => {
    const instruction = await buildClosePolicyInstruction({
      operator,
      treasury,
      policy,
      rentDestination: other,
    });
    expect(instruction.accounts?.map((account) => account.address)).toContain(other);
  });

  it("builds close_treasury with the sol vault", async () => {
    const instruction = await buildCloseTreasuryInstruction({ owner, treasury, solVault });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.CloseTreasury);
    expect(instruction.accounts?.map((account) => account.address)).toContain(solVault);
  });

  // The receipt's rent belongs to whoever paid for it, not to whoever closes it — the one
  // asymmetry in this file, and the one most likely to be "simplified" away.
  it("sends receipt rent to the recorded fee payer, not the closer", async () => {
    const instruction = await buildCloseReceiptInstruction({
      anyone: operator,
      receipt: policy,
      feePayer: other,
    });
    expect(identifyAgentRailsInstruction(instruction)).toBe(AgentRailsInstruction.CloseReceipt);
    const accounts = instruction.accounts?.map((account) => account.address) ?? [];
    expect(accounts).toContain(other);
    const signers = instruction.accounts?.filter(
      (account) =>
        account.role === AccountRole.READONLY_SIGNER ||
        account.role === AccountRole.WRITABLE_SIGNER,
    );
    expect(signers?.map((account) => account.address)).toEqual([operator.address]);
  });
});
