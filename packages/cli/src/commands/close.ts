import { fetchMaybeIntentReceipt } from "@agent-rails/client";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import { requireOperatorOrOwner, requireOwner } from "../roles.js";
import {
  buildClosePolicyInstruction,
  buildCloseReceiptInstruction,
  buildCloseTreasuryInstruction,
} from "../tx/close.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

/**
 * Rent reclamation, for accounts whose work is over.
 *
 * The program refuses every one of these while the account is still load-bearing — a policy
 * with live sessions, a treasury with a funded vault, a receipt inside its grace window.
 * These handlers read the state first anyway, because a refusal that arrives as a
 * simulation error costs a round trip and says less.
 */

export type ClosePolicyOptions = GlobalCliOptions & { rentTo?: string };

export async function runClosePolicy(options: ClosePolicyOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "close a policy");

  if (!snapshot.policy) throw new CliError(`No policy account at ${ctx.policy}`);

  const live = snapshot.sessions.filter((session) => session.policy === ctx.policy && session.live);
  if (live.length > 0) {
    throw new CliError(`${live.length} live session(s) still reference this policy`, {
      hint: `Revoke and close them first: ${live.map((s) => s.address).join(", ")}`,
    });
  }

  const instruction = await buildClosePolicyInstruction({
    operator: ctx.wallet,
    treasury: ctx.treasury,
    policy: ctx.policy,
    ...(options.rentTo ? { rentDestination: parseAddress(options.rentTo, "--rent-to") } : {}),
  });

  ui.heading("Close policy");
  ui.field("Policy", `${ctx.policyName} (${ctx.policy})`);

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Close policy", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: `Close policy "${ctx.policyName}"? Agents bound to it stop being able to pay.`,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ closed: ctx.policy, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export type CloseTreasuryOptions = GlobalCliOptions & { rentTo?: string };

export async function runCloseTreasury(options: CloseTreasuryOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "close the treasury");

  const funded = snapshot.ceilings.filter((ceiling) => ceiling.vaultBalance > 0n);
  if (funded.length > 0) {
    throw new CliError("The vault still holds funds", {
      hint: `Withdraw first: ${funded.map((c) => `${c.symbol} ${c.vaultBalance}`).join(", ")}`,
    });
  }
  if (snapshot.treasuryAccount.activeSessions > 0) {
    throw new CliError(`${snapshot.treasuryAccount.activeSessions} session(s) are still open`);
  }
  if (snapshot.treasuryAccount.policyCount > 0) {
    throw new CliError(`${snapshot.treasuryAccount.policyCount} policy account(s) still exist`, {
      hint: "agent-rails close policy",
    });
  }

  const instruction = await buildCloseTreasuryInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    solVault: ctx.solVault,
    ...(options.rentTo ? { rentDestination: parseAddress(options.rentTo, "--rent-to") } : {}),
  });

  ui.heading("Close treasury");
  ui.field("Treasury", ctx.treasury);
  // The manifest on disk keeps naming this address afterwards, and `init` resumes from the
  // chain rather than from the file, so a re-run creates a new treasury instead of failing.
  ui.info(ui.dim("The manifest still names this treasury; a later `init` will create a new one."));

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Close treasury", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: "Close this treasury for good?",
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ closed: ctx.treasury, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}

export type CloseReceiptOptions = GlobalCliOptions & { receipt: string };

export async function runCloseReceipt(options: CloseReceiptOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const receipt = parseAddress(options.receipt, "--receipt");

  const account = await fetchMaybeIntentReceipt(ctx.rpc, receipt, { commitment: "confirmed" });
  if (!account.exists) throw new CliError(`No receipt account at ${receipt}`);

  // The rent goes back to whoever paid for it, which is recorded on the receipt and is not
  // necessarily the wallet closing it — the program enforces this, and naming the address
  // here is what stops an operator expecting the refund themselves.
  const feePayer = account.data.feePayer;

  const instruction = await buildCloseReceiptInstruction({
    anyone: ctx.wallet,
    receipt,
    feePayer,
  });

  ui.heading("Close receipt");
  ui.field("Receipt", receipt);
  ui.field("Rent goes to", feePayer);
  ui.field("Expires at", new Date(Number(account.data.expiresAt) * 1000).toISOString());
  // Closing it deletes the only on-chain record of that payment's idempotency, and with it
  // the link of the audit chain that receipt pinned. Export before reclaiming rent.
  ui.info(ui.dim("Export the audit chain first: this receipt is a link in it."));

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Close receipt", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ closed: receipt, rentTo: feePayer, signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}
