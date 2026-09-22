import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { requireOwner, requirePauseAuthority } from "../roles.js";
import { buildPauseInstruction, buildUnpauseInstruction } from "../tx/controls.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

export async function runPause(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requirePauseAuthority(ctx.wallet.address, snapshot.treasuryAccount);

  if (snapshot.treasuryAccount.paused) {
    ui.info("Treasury is already paused");
    return 0;
  }

  const instruction = await buildPauseInstruction(ctx.wallet, ctx.treasury);
  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Pause treasury", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: "Pause this treasury? Agents cannot pay while paused.",
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ paused: true, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export async function runUnpause(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "unpause");

  if (!snapshot.treasuryAccount.paused) {
    ui.info("Treasury is not paused");
    return 0;
  }

  const instruction = await buildUnpauseInstruction(ctx.wallet, ctx.treasury);
  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Unpause treasury", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: "Unpause this treasury?",
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ paused: false, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}
