import { loadDestinationIndex, normalizeLabel } from "@ash/sdk";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import { requireOperatorOrOwner } from "../roles.js";
import {
  buildAddAllowlistEntryInstruction,
  buildRemoveAllowlistEntryInstruction,
} from "../tx/allowlist.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

export type DestAddOptions = GlobalCliOptions & { label: string; owner: string };

export async function runDestAdd(options: DestAddOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "edit the allowlist");

  const owner = parseAddress(options.owner, "--owner");
  const normalized = normalizeLabel(options.label);
  const index = await loadDestinationIndex({
    rpc: ctx.rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: ctx.policy,
  });
  if (index.entries.some((e) => e.normalizedLabel === normalized)) {
    throw new CliError(`Destination label "${options.label}" is already registered`, {
      hint: "Pick a different label or remove the existing entry first.",
    });
  }

  const { entry, instruction } = await buildAddAllowlistEntryInstruction({
    operator: ctx.wallet,
    treasury: ctx.treasury,
    policy: ctx.policy,
    destinationOwner: owner,
    label: options.label,
  });

  ui.heading("Add destination");
  ui.field("Label", options.label);
  ui.field("Owner", owner);
  ui.field("Entry PDA", entry);

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Add allowlist entry", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ entry, signature: result.signature ?? null })}\n`);
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export type DestRmOptions = GlobalCliOptions & { label: string };

export async function runDestRm(options: DestRmOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "edit the allowlist");

  const index = await loadDestinationIndex({
    rpc: ctx.rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: ctx.policy,
  });
  const normalized = normalizeLabel(options.label);
  const match = index.entries.find((e) => e.normalizedLabel === normalized);
  if (!match) {
    throw new CliError(`No allowlist entry for label "${options.label}"`);
  }

  const instruction = await buildRemoveAllowlistEntryInstruction({
    operator: ctx.wallet,
    treasury: ctx.treasury,
    policy: ctx.policy,
    destinationOwner: match.owner,
  });

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: `Remove destination ${match.label}`, instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ removed: match.label, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export async function runDestLs(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const index = await loadDestinationIndex({
    rpc: ctx.rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
    policy: ctx.policy,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(index.entries, null, 2)}\n`);
    return 0;
  }

  ui.heading("Allowlisted destinations");
  if (index.entries.length === 0) {
    ui.info(ui.dim("No destinations registered."));
    return 0;
  }
  for (const entry of index.entries) {
    ui.field(entry.label, entry.owner);
  }
  return 0;
}
