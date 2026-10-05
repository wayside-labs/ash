import { fromBaseUnits, NATIVE_MINT, toBaseUnits } from "@ash/contract";
import { address } from "@solana/kit";
import { formatSol, parseSol } from "../amounts.js";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { parseAddress } from "../parse.js";
import { requireOwner } from "../roles.js";
import { readMint } from "../token.js";
import { sendPlan } from "../tx/send.js";
import { buildWithdrawInstruction } from "../tx/withdraw.js";
import type { Ui } from "../ui.js";

export type WithdrawOptions = GlobalCliOptions & {
  amount: string;
  to: string;
  mint?: string;
};

export async function runWithdraw(options: WithdrawOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "withdraw");

  const destination = parseAddress(options.to, "--to");
  const mintAddr = options.mint
    ? options.mint.toUpperCase() === "SOL"
      ? address(NATIVE_MINT)
      : parseAddress(options.mint, "--mint")
    : address(NATIVE_MINT);

  const isNative = mintAddr === address(NATIVE_MINT);
  let amountBase: bigint;
  let displayAmount: string;
  if (isNative) {
    amountBase = parseSol(options.amount, "--amount");
    displayAmount = formatSol(amountBase);
  } else {
    const info = await readMint(ctx.rpc, mintAddr, ctx.treasury);
    amountBase = toBaseUnits(options.amount, info.decimals);
    displayAmount = `${fromBaseUnits(amountBase, info.decimals)} (mint ${info.mint})`;
  }

  const instruction = await buildWithdrawInstruction({
    rpc: ctx.rpc,
    owner: ctx.wallet,
    treasury: ctx.treasury,
    amount: amountBase,
    destination,
    ...(isNative ? {} : { mint: mintAddr }),
  });

  ui.heading("Withdraw");
  ui.field("Amount", displayAmount);
  ui.field("To", destination);

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Withdraw from treasury", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
    confirmMessage: `Withdraw ${displayAmount} to ${destination}?`,
  });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ amount: amountBase.toString(), signature: result.signature ?? null })}\n`,
    );
  }
  return result.sent || options.dryRun ? 0 : 130;
}
