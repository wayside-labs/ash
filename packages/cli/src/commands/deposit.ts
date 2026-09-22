import { formatSol } from "../amounts.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { fundingLine, shortfall } from "../funding.js";
import { getBalance } from "../rpc.js";
import { buildDepositInstructions } from "../tx/funding.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

export type DepositOptions = GlobalCliOptions & { amount: bigint };

export async function runDeposit(options: DepositOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const held = await getBalance(ctx.rpc, ctx.solVault);
  const moving = shortfall(options.amount, held);

  if (options.json && !options.dryRun) {
    // json output after send
  }

  ui.heading("Deposit");
  ui.field("Vault", fundingLine(options.amount, held, moving, formatSol));

  if (moving === 0n) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ deposited: "0", vault: held.toString() })}\n`);
    } else {
      ui.succeed("Vault already at target");
    }
    return 0;
  }

  const instructions = await buildDepositInstructions(ctx.wallet, ctx.treasury, moving);
  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Deposit SOL to vault", instructions },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: `Deposit ${formatSol(moving)} to the vault?`,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ deposited: moving.toString(), signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun || moving === 0n ? 0 : 130;
}
