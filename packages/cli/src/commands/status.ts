import { fromBaseUnits } from "@ash/contract";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import type { Ui } from "../ui.js";

export async function runStatus(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const ctx = await loadContext(options);
  const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
  const t = snapshot.treasuryAccount;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(snapshot, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
    );
    return 0;
  }

  ui.heading("Treasury status");
  ui.blank();
  ui.field("Treasury", ctx.treasury);
  ui.field("SOL vault", snapshot.solVault);
  ui.field("Owner", t.owner);
  ui.field("Operator", t.operator);
  ui.field("Paused", t.paused ? "yes" : "no");
  ui.field("Active sessions", String(t.activeSessions));
  ui.field("Policies", String(t.policyCount));
  ui.blank();

  ui.heading("Ceilings and vault balances");
  for (const ceiling of snapshot.ceilings) {
    ui.field(ceiling.symbol, ceiling.mint);
    ui.field("  vault", fromBaseUnits(ceiling.vaultBalance, ceiling.decimals));
    ui.field("  max / tx", fromBaseUnits(ceiling.maxPerTx, ceiling.decimals));
    ui.field("  max / day", fromBaseUnits(ceiling.maxLongWindow, ceiling.decimals));
    ui.field("  max lifetime", fromBaseUnits(ceiling.maxLifetime, ceiling.decimals));
    ui.blank();
  }

  if (snapshot.policyLimits.length > 0) {
    ui.heading(`Policy ${ctx.policy}`);
    for (const limit of snapshot.policyLimits) {
      ui.field(limit.symbol, limit.mint);
      ui.field("  per tx", fromBaseUnits(limit.perTxMax, limit.decimals));
      ui.field("  per day", fromBaseUnits(limit.longWindowMax, limit.decimals));
      ui.field("  lifetime", fromBaseUnits(limit.lifetimeMax, limit.decimals));
    }
    ui.blank();
  }

  ui.heading("Sessions");
  if (snapshot.sessions.length === 0) {
    ui.info(ui.dim("No sessions on this treasury."));
  } else {
    for (const session of snapshot.sessions) {
      const state = session.revoked ? "revoked" : session.live ? "live" : "expired";
      ui.field(session.label, `${session.address} (${state})`);
      ui.field("  key", session.sessionKey);
      ui.field("  expires", new Date(session.expiresAt * 1000).toISOString());
    }
  }

  return 0;
}
