import { fromBaseUnits, NATIVE_MINT } from "@agent-rails/contract";
import { address } from "@solana/kit";
import { formatSol } from "../amounts.js";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { parseAddress } from "../parse.js";
import { requireOwner } from "../roles.js";
import { buildSetCeilingInstruction } from "../tx/ceiling.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

export type CeilingSetOptions = GlobalCliOptions & {
  mint: string;
  perTx: bigint;
  daily: bigint;
  lifetime?: bigint;
};

export async function runCeilingSet(options: CeilingSetOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOwner(ctx.wallet.address, snapshot.treasuryAccount, "set ceilings");

  const isSol = options.mint.toUpperCase() === "SOL";
  const mint = isSol ? address(NATIVE_MINT) : parseAddress(options.mint, "--mint");
  const mintConfig = snapshot.ceilings.find((c) => c.mint === mint);
  if (!isSol && !mintConfig) {
    throw new CliError(`Mint ${mint} is not configured on this treasury`, {
      hint: "Add the mint with init --mint or add_mint before setting its ceiling.",
    });
  }

  const daily = options.daily;
  const lifetime = options.lifetime ?? daily * 30n;
  const formatAmount = (value: bigint) =>
    isSol ? formatSol(value) : fromBaseUnits(value, mintConfig?.decimals ?? 0);
  const ceiling = {
    maxPerTx: options.perTx,
    maxShortWindow: daily,
    maxLongWindow: daily,
    maxLifetime: lifetime,
    minShortWindowSeconds: 3_600,
    minLongWindowSeconds: 86_400,
  };

  const instruction = await buildSetCeilingInstruction({
    owner: ctx.wallet,
    treasury: ctx.treasury,
    mint,
    ceiling,
    allowAnyDestination: snapshot.treasuryAccount.allowAnyDestination,
    allowCreateDestinationAta: snapshot.treasuryAccount.allowCreateDestinationAta,
  });

  ui.heading("Set ceiling");
  ui.field("Mint", mint);
  ui.field("Max / tx", formatAmount(options.perTx));
  ui.field("Max / day", formatAmount(daily));
  ui.field("Max lifetime", formatAmount(lifetime));

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: "Set ceiling", instructions: [instruction] },
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
