import { NATIVE_MINT } from "@ash/contract/constants";
import { address } from "@solana/kit";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import { requireOwner } from "../roles.js";
import {
  buildAddGuardianInstruction,
  buildRemoveGuardianInstruction,
  buildRemoveMintInstruction,
  buildSetRolesInstruction,
} from "../tx/admin.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

/**
 * The owner-only surface: roles, guardians and the mint list.
 *
 * Every command here changes the *shape* of a treasury rather than a limit inside it, which
 * is why none of them is reachable from the operator side and none will ever be an agent
 * tool. Handing an operator the guardian list would let them appoint a pause authority the
 * owner never chose; handing them `set_roles` would let them keep the treasury.
 */

export type GuardianOptions = GlobalCliOptions & { address: string };

export async function runGuardianAdd(options: GuardianOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "add a guardian");

  const guardian = parseAddress(options.address, "<address>");
  const treasuryAccount = snapshot.treasuryAccount;
  const current = treasuryAccount.guardians.slice(0, treasuryAccount.guardianCount);
  if (current.includes(guardian)) {
    ui.info(`${guardian} is already a guardian`);
    return 0;
  }

  const instruction = await buildAddGuardianInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    guardian,
  });

  ui.heading("Add guardian");
  ui.field("Guardian", guardian);
  // Said out loud because it is the whole point of the role, and because the owner is about
  // to hand a stranger a button that stops their agents.
  ui.info(ui.dim("A guardian may pause this treasury. Only the owner may unpause it."));

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Add guardian", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: `Let ${guardian} pause this treasury?`,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ guardian, signature: result.signature ?? null })}\n`);
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export async function runGuardianRm(options: GuardianOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "remove a guardian");

  const guardian = parseAddress(options.address, "<address>");
  const treasuryAccount = snapshot.treasuryAccount;
  const current = treasuryAccount.guardians.slice(0, treasuryAccount.guardianCount);
  if (!current.includes(guardian)) {
    throw new CliError(`${guardian} is not a guardian of this treasury`, {
      hint: current.length > 0 ? `Guardians: ${current.join(", ")}` : "This treasury has none.",
    });
  }

  const instruction = await buildRemoveGuardianInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    guardian,
  });

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Remove guardian", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ guardian, removed: true, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export async function runGuardianLs(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  const treasuryAccount = snapshot.treasuryAccount;
  const guardians = treasuryAccount.guardians.slice(0, treasuryAccount.guardianCount);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ guardians }, null, 2)}\n`);
    return 0;
  }

  ui.heading("Guardians");
  if (guardians.length === 0) {
    ui.info(ui.dim("None. Only the owner can pause this treasury."));
    return 0;
  }
  for (const guardian of guardians) ui.field("Guardian", guardian);
  return 0;
}

export type RolesSetOptions = GlobalCliOptions & { owner?: string; operator?: string };

export async function runRolesSet(options: RolesSetOptions, ui: Ui): Promise<number> {
  if (!options.owner && !options.operator) {
    throw new CliError("Nothing to change", {
      hint: "Pass --owner, --operator, or both.",
    });
  }

  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "change roles");

  const newOwner = options.owner ? parseAddress(options.owner, "--owner") : undefined;
  const newOperator = options.operator ? parseAddress(options.operator, "--operator") : undefined;

  const instruction = await buildSetRolesInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    ...(newOwner ? { newOwner } : {}),
    ...(newOperator ? { newOperator } : {}),
  });

  ui.heading("Set roles");
  if (newOwner) {
    ui.field("Owner", `${snapshot.treasuryAccount.owner} → ${newOwner}`);
  }
  if (newOperator) {
    ui.field("Operator", `${snapshot.treasuryAccount.operator} → ${newOperator}`);
  }
  if (newOwner && newOwner !== ctx.wallet.address) {
    // One instruction, no undo, and the new owner is the only key that can hand it back.
    ui.info(
      ui.dim("Handing over ownership is final: this wallet loses withdraw, ceilings and unpause."),
    );
  }

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Set roles", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: newOwner
      ? `Transfer ownership of this treasury to ${newOwner}? This cannot be undone from here.`
      : `Set the operator to ${newOperator}?`,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        owner: newOwner ?? snapshot.treasuryAccount.owner,
        operator: newOperator ?? snapshot.treasuryAccount.operator,
        signature: result.signature ?? null,
      })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export type MintRmOptions = GlobalCliOptions & { mint: string };

export async function runMintRm(options: MintRmOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "remove a mint");

  const mint = parseAddress(options.mint, "<mint>");
  const ceiling = snapshot.ceilings.find((entry) => entry.mint === mint);
  if (!ceiling) {
    throw new CliError(`${mint} is not configured on this treasury`, {
      hint:
        snapshot.ceilings.length > 0
          ? `Configured mints: ${snapshot.ceilings.map((c) => c.mint).join(", ")}`
          : "This treasury has no mints configured.",
    });
  }

  // Reported before sending rather than discovered in a failed simulation: the program
  // refuses a delist while the vault still holds anything, and "why did this fail" costs
  // more than a balance read.
  if (ceiling.vaultBalance > 0n) {
    throw new CliError(`The vault for ${ceiling.symbol} still holds ${ceiling.vaultBalance}`, {
      hint: `Withdraw it first: ash withdraw --mint ${mint} --all`,
    });
  }

  // A policy that still prices this mint would be left referencing something the treasury
  // no longer accepts; the program checks it too, this just says so in words.
  if (snapshot.policyLimits.some((limit) => limit.mint === mint)) {
    throw new CliError(`The policy still carries a limit for ${ceiling.symbol}`, {
      hint: "Rewrite the policy without this mint first, then remove it.",
    });
  }

  const instruction = await buildRemoveMintInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    mint,
    ...(ceiling.vaultAta ? { vaultAta: ceiling.vaultAta } : {}),
    solVault: ctx.solVault,
  });

  ui.heading("Remove mint");
  ui.field("Mint", `${ceiling.symbol} (${mint})`);
  if (mint === address(NATIVE_MINT)) {
    ui.info(ui.dim("Native SOL: the vault must be at the rent floor, not merely empty."));
  }

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: `Remove mint ${ceiling.symbol}`, instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ mint, signature: result.signature ?? null })}\n`);
  }
  return result.sent || options.dryRun ? 0 : 130;
}
