import { AGENT_RAILS_PROGRAM_ADDRESS, fetchMaybeTreasury } from "@agent-rails/client";
import { loadDestinationIndex } from "@agent-rails/sdk";
import { formatSol } from "../amounts.js";
import { readTreasurySnapshot } from "../chain/read.js";
import type { GlobalCliOptions } from "../cli-options.js";
import { loadContext } from "../context.js";
import { mcpEntryExists } from "../mcp-entry.js";
import { walletRoles } from "../roles.js";
import { assertProgramDeployed, getBalance } from "../rpc.js";
import type { Ui } from "../ui.js";
import { loadIfPresent } from "../wallet.js";

type Check = { name: string; ok: boolean; detail: string; hint?: string | undefined };

export async function runDoctor(options: GlobalCliOptions, ui: Ui): Promise<number> {
  const checks: Check[] = [];
  const rpcUrl = options.rpc;

  try {
    const ctx = await loadContext(options);
    await assertProgramDeployed(ctx.rpc, AGENT_RAILS_PROGRAM_ADDRESS, rpcUrl);
    checks.push({ name: "Program deployed", ok: true, detail: AGENT_RAILS_PROGRAM_ADDRESS });

    const roles = walletRoles(
      ctx.wallet.address,
      (await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy)).treasuryAccount,
    );
    checks.push({
      name: "Wallet role",
      ok: roles.length > 0,
      detail: roles.length > 0 ? roles.join(", ") : "none",
      hint: roles.length === 0 ? "This wallet is not owner, operator, or guardian." : undefined,
    });

    const manifest = ctx.manifest;
    if (manifest) {
      const sessionKeyPath = manifest.sessionKeypairPath;
      const sessionKey = await loadIfPresent(sessionKeyPath);
      const sessionKeyAddr = sessionKey?.address ?? manifest.sessionKey;
      const treasuryAccount = await fetchMaybeTreasury(ctx.rpc, ctx.treasury);
      const owner = treasuryAccount.exists ? treasuryAccount.data.owner : undefined;
      const privileged =
        sessionKeyAddr === owner ||
        sessionKeyAddr === ctx.wallet.address ||
        sessionKeyAddr === manifest.owner;
      checks.push({
        name: "Session key ≠ owner",
        ok: !privileged,
        detail: sessionKeyAddr,
        hint: privileged
          ? "Regenerate the session key — privileged keys are rejected on-chain."
          : undefined,
      });

      const feePayerBalance = await getBalance(ctx.rpc, manifest.feePayer as never);
      checks.push({
        name: "Fee payer funded",
        ok: feePayerBalance > 0n,
        detail: formatSol(feePayerBalance),
        hint:
          feePayerBalance === 0n ? "Fund the fee payer or re-run init --fee-budget." : undefined,
      });
    } else {
      checks.push({
        name: "Manifest",
        ok: false,
        detail: "missing",
        hint: "Run init for this cluster.",
      });
    }

    const snapshot = await readTreasurySnapshot(ctx.rpc, ctx.treasury, ctx.policy);
    const manifestSession = manifest?.session;
    const session = manifestSession
      ? snapshot.sessions.find((s) => s.address === manifestSession)
      : snapshot.sessions.find((s) => s.live);
    checks.push({
      name: "Session live",
      ok: session?.live === true,
      detail: session ? `${session.label} (${session.address})` : "no live session",
      hint: session?.live ? undefined : "Create or rotate a session: agent-rails session create",
    });

    const destIndex = await loadDestinationIndex({
      rpc: ctx.rpc as Parameters<typeof loadDestinationIndex>[0]["rpc"],
      policy: ctx.policy,
    });
    checks.push({
      name: "Allowlist non-empty",
      ok: destIndex.entries.length > 0,
      detail: `${destIndex.entries.length} destination(s)`,
      hint:
        destIndex.entries.length === 0 ? "agent-rails dest add --label ... --owner ..." : undefined,
    });

    const mcpOk = mcpEntryExists(options.mcpEntry);
    checks.push({
      name: "MCP entry exists",
      ok: mcpOk,
      detail: mcpOk ? "built" : "missing",
      hint: mcpOk ? undefined : "pnpm --filter @agent-rails/mcp build",
    });
  } catch (error) {
    checks.push({
      name: "Bootstrap",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      hint: "Run agent-rails init for this cluster.",
    });
  }

  const failed = checks.filter((c) => !c.ok);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ checks, ok: failed.length === 0 }, null, 2)}\n`);
    return failed.length === 0 ? 0 : 1;
  }

  ui.heading("Agent Rails doctor");
  ui.blank();
  for (const check of checks) {
    if (check.ok) ui.succeed(check.name, check.detail);
    else ui.fail(`${check.name}: ${check.detail}`);
    if (!check.ok && check.hint) ui.info(ui.dim(`  ${check.hint}`));
  }
  ui.blank();
  if (failed.length > 0) {
    ui.fail(`${failed.length} check(s) failed`);
    return 1;
  }
  ui.succeed("All checks passed");
  return 0;
}
