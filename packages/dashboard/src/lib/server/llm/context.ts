import type { SolanaCluster } from "@/lib/schema";
import { LAMPORTS_PER_SOL, readTreasury } from "@/lib/server/solana";
import { readState } from "@/lib/server/store";

/**
 * The subscription path runs with zero tools, so the model cannot go fetch
 * anything — we hand it a read-only snapshot instead. That is a feature, not a
 * workaround: there is no code path from the chat box to a write.
 *
 * API keys are never included. `readState` returns raw secrets, so anything
 * added here must be picked field by field, never spread.
 */
export async function buildContext(cluster: SolanaCluster, rpc: string | null): Promise<string> {
  const state = await readState();
  const lines: string[] = [`Selected cluster: ${cluster}.`];

  if (state.workflows.length === 0) {
    lines.push("The user has no workflows yet.");
  }

  for (const workflow of state.workflows) {
    const agents = state.agents.filter((a) => a.workflowId === workflow.id);
    const tag = workflow.demo ? " [demo, not on-chain]" : "";
    lines.push(`\n## Workflow "${workflow.name}"${tag}`);
    if (workflow.description) lines.push(workflow.description);

    if (agents.length === 0) {
      lines.push("No agents.");
    } else {
      for (const agent of agents) {
        lines.push(
          `- Agent "${agent.name}" (${agent.role || "no role"}), status ${agent.status}, dashboard daily limit US$ ${agent.dailyLimitUsd}.`,
        );
      }
    }

    if (!workflow.treasuryAddress) {
      lines.push("No on-chain treasury: the numbers above are dashboard labels only.");
      continue;
    }

    try {
      const view = await readTreasury(cluster, rpc, workflow.treasuryAddress);
      if (!view) {
        lines.push(`Treasury ${workflow.treasuryAddress} not found on ${cluster}.`);
        continue;
      }
      lines.push(
        `On-chain treasury ${view.address}: ${view.solVaultLamports / LAMPORTS_PER_SOL} SOL in vault, ${view.paused ? "PAUSED" : "active"}, ${view.activeSessions} active session(s).`,
      );
      for (const policy of view.policies) {
        for (const limit of policy.limits) {
          const decimals = view.decimals[limit.mint] ?? 0;
          const ceiling = view.mints.find((m) => m.mint === limit.mint);
          const scale = (raw: string) => Number(raw) / 10 ** decimals;
          lines.push(
            `  Policy "${policy.name}" for ${limit.mint}: per tx ${scale(limit.perTxMax)}, short window ${scale(limit.shortWindowMax)} every ${limit.shortWindowSeconds}s, long window ${scale(limit.longWindowMax)} every ${limit.longWindowSeconds}s.` +
              (ceiling
                ? ` Owner ceiling: per tx ${scale(ceiling.maxPerTx)}, short window ${scale(ceiling.maxShortWindow)}.`
                : ""),
          );
        }
      }
      for (const session of view.sessions) {
        lines.push(
          `  Session "${session.label}": ${session.revoked ? "revoked" : "active"}, ${session.seq} payment(s) executed, expires ${new Date(session.expiresAt * 1000).toISOString()}.`,
        );
      }
    } catch (error) {
      lines.push(
        `Failed to read on-chain treasury: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
  }

  const enabledMcps = state.mcps.filter((m) => m.enabled).map((m) => m.name);
  if (enabledMcps.length > 0) {
    // Spell out whose tools these are: they belong to the user's agents, not to
    // the assistant, which runs with no tools at all.
    lines.push(
      `\nMCPs the user enabled for their AGENTS (you have no access to any of them): ${enabledMcps.join(", ")}.`,
    );
  }

  return lines.join("\n");
}
