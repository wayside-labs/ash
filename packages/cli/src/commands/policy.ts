import { fetchMaybePolicy } from "@ash/client";
import { fromBaseUnits, NATIVE_MINT } from "@ash/contract";
import { address } from "@solana/kit";
import { parseHumanAmount, SOL_DECIMALS } from "../amounts.js";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { CliError } from "../errors.js";
import { decodeFixedName } from "../names.js";
import { parseAddress } from "../parse.js";
import {
  applyLimitDelta,
  buildPolicyInput,
  preflightPolicyLeqCeiling,
} from "../planners/policy.js";
import { requireOperatorOrOwner } from "../roles.js";
import { buildPolicyWriteInstruction } from "../tx/policy.js";
import { sendPlan } from "../tx/send.js";
import type { Ui } from "../ui.js";

export type PolicyShowOptions = GlobalCliOptions;

export async function runPolicyShow(options: PolicyShowOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  const policyAccount = await fetchMaybePolicy(ctx.rpc, ctx.policy, { commitment: "confirmed" });

  if (!policyAccount.exists) {
    throw new Error(`No policy at ${ctx.policy}`);
  }

  const view = {
    address: ctx.policy,
    name: decodeFixedName(policyAccount.data.name),
    destinationMode: policyAccount.data.destinationMode,
    requireMemo: policyAccount.data.requireMemo,
    createDestinationAta: policyAccount.data.createDestinationAta,
    limits: snapshot.policyLimits,
  };

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(view, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
    );
    return 0;
  }

  ui.heading(`Policy ${view.name}`);
  ui.field("Address", ctx.policy);
  for (const limit of view.limits) {
    ui.field(limit.symbol, limit.mint);
    ui.field("  per tx", fromBaseUnits(limit.perTxMax, limit.decimals));
    ui.field("  per day", fromBaseUnits(limit.longWindowMax, limit.decimals));
    ui.field("  lifetime", fromBaseUnits(limit.lifetimeMax, limit.decimals));
  }
  return 0;
}

export type PolicySetOptions = GlobalCliOptions & {
  perTx?: string;
  daily?: string;
  lifetime?: string;
  mint?: string;
};

export async function runPolicySet(options: PolicySetOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  requireOperatorOrOwner(ctx.wallet.address, snapshot.treasuryAccount, "update policy");

  const policyAccount = await fetchMaybePolicy(ctx.rpc, ctx.policy, { commitment: "confirmed" });
  const exists = policyAccount.exists;
  const currentLimits = exists
    ? policyAccount.data.mintLimits.slice(0, policyAccount.data.mintCount)
    : snapshot.policyLimits.map((l) => ({
        mint: l.mint,
        perTxMax: l.perTxMax,
        shortWindowMax: l.shortWindowMax,
        shortWindowSeconds: l.shortWindowSeconds,
        longWindowMax: l.longWindowMax,
        longWindowSeconds: l.longWindowSeconds,
        lifetimeMax: l.lifetimeMax,
        approvalThreshold: 0n,
        cooldownSeconds: 0,
        reserved: new Uint8Array(12),
      }));

  if (currentLimits.length === 0) {
    throw new Error("No policy limits to update — run init first.");
  }

  const targetMint = options.mint
    ? options.mint.toUpperCase() === "SOL"
      ? address(NATIVE_MINT)
      : parseAddress(options.mint, "--mint")
    : address(NATIVE_MINT);

  const ceiling = snapshot.ceilings.find((c) => c.mint === targetMint);
  const isSol = targetMint === address(NATIVE_MINT);
  // Parsing a token limit needs that mint's decimals. Guessing them is the bug this replaced:
  // a 9-decimal guess on a 6-decimal mint writes a limit a thousand times too large.
  if (!isSol && !ceiling) {
    throw new CliError(`Mint ${targetMint} is not configured on this treasury`, {
      hint: "The owner adds the mint and its ceiling first; a policy cannot price an unknown mint.",
    });
  }
  const decimals = isSol ? SOL_DECIMALS : (ceiling?.decimals ?? SOL_DECIMALS);

  const updated = currentLimits.map((limit) => {
    if (limit.mint !== targetMint) return limit;
    const daily =
      options.daily !== undefined
        ? parseHumanAmount(options.daily, decimals, "--daily")
        : limit.longWindowMax;
    const perTx =
      options.perTx !== undefined
        ? parseHumanAmount(options.perTx, decimals, "--per-tx")
        : limit.perTxMax;
    const lifetime =
      options.lifetime !== undefined
        ? parseHumanAmount(options.lifetime, decimals, "--lifetime")
        : limit.lifetimeMax;
    return applyLimitDelta(limit, {
      perTxMax: perTx,
      shortWindowMax: daily,
      longWindowMax: daily,
      lifetimeMax: lifetime,
      shortWindowSeconds: limit.shortWindowSeconds,
      longWindowSeconds: limit.longWindowSeconds,
    });
  });

  const policyInput = buildPolicyInput(
    updated,
    exists ? policyAccount.data.destinationMode : 1,
    exists ? policyAccount.data.requireMemo : false,
    exists ? policyAccount.data.createDestinationAta : false,
  );

  preflightPolicyLeqCeiling(policyInput, snapshot.treasuryAccount, (mint) => {
    const c = snapshot.ceilings.find((x) => x.mint === mint);
    return c?.symbol ?? mint;
  });

  const instruction = await buildPolicyWriteInstruction({
    operator: ctx.wallet,
    treasury: ctx.treasury,
    policy: ctx.policy,
    policyName: ctx.policyName,
    args: policyInput,
    exists,
  });

  ui.heading("Update policy");
  const limit = updated.find((l) => l.mint === targetMint);
  ui.field("Mint", targetMint);
  if (limit) {
    ui.field("Per tx", fromBaseUnits(limit.perTxMax, decimals));
    ui.field("Per day", fromBaseUnits(limit.longWindowMax, decimals));
  }

  const result = await sendPlan({
    rpc: ctx.rpc,
    feePayer: ctx.wallet,
    plan: { label: exists ? "Update policy" : "Create policy", instructions: [instruction] },
    ui,
    yes: options.yes,
    json: options.json,
    dryRun: options.dryRun,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ signature: result.signature ?? null })}\n`);
  }
  return result.sent || options.dryRun ? 0 : 130;
}
