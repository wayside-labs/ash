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
  const lines: string[] = [`Rede selecionada: ${cluster}.`];

  if (state.workflows.length === 0) {
    lines.push("O usuário ainda não tem nenhum workflow.");
  }

  for (const workflow of state.workflows) {
    const agents = state.agents.filter((a) => a.workflowId === workflow.id);
    const tag = workflow.demo ? " [demonstração, não existe on-chain]" : "";
    lines.push(`\n## Workflow "${workflow.name}"${tag}`);
    if (workflow.description) lines.push(workflow.description);

    if (agents.length === 0) {
      lines.push("Sem agentes.");
    } else {
      for (const agent of agents) {
        lines.push(
          `- Agente "${agent.name}" (${agent.role || "sem cargo"}), status ${agent.status}, limite diário no dashboard US$ ${agent.dailyLimitUsd}.`,
        );
      }
    }

    if (!workflow.treasuryAddress) {
      lines.push("Sem treasury on-chain: os números acima são só rótulos do dashboard.");
      continue;
    }

    try {
      const view = await readTreasury(cluster, rpc, workflow.treasuryAddress);
      if (!view) {
        lines.push(`Treasury ${workflow.treasuryAddress} não encontrada em ${cluster}.`);
        continue;
      }
      lines.push(
        `Treasury on-chain ${view.address}: ${view.solVaultLamports / LAMPORTS_PER_SOL} SOL no cofre, ${view.paused ? "PAUSADA" : "ativa"}, ${view.activeSessions} sessão(ões) ativa(s).`,
      );
      for (const policy of view.policies) {
        for (const limit of policy.limits) {
          const decimals = view.decimals[limit.mint] ?? 0;
          const ceiling = view.mints.find((m) => m.mint === limit.mint);
          const scale = (raw: string) => Number(raw) / 10 ** decimals;
          lines.push(
            `  Política "${policy.name}" para ${limit.mint}: por transação ${scale(limit.perTxMax)}, janela curta ${scale(limit.shortWindowMax)} a cada ${limit.shortWindowSeconds}s, janela longa ${scale(limit.longWindowMax)} a cada ${limit.longWindowSeconds}s.` +
              (ceiling
                ? ` Teto do dono: por transação ${scale(ceiling.maxPerTx)}, janela curta ${scale(ceiling.maxShortWindow)}.`
                : ""),
          );
        }
      }
      for (const session of view.sessions) {
        lines.push(
          `  Sessão "${session.label}": ${session.revoked ? "revogada" : "ativa"}, ${session.seq} pagamento(s) executado(s), expira em ${new Date(session.expiresAt * 1000).toISOString()}.`,
        );
      }
    } catch (error) {
      lines.push(
        `Falha ao ler a treasury on-chain: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
      );
    }
  }

  const enabledMcps = state.mcps.filter((m) => m.enabled).map((m) => m.name);
  if (enabledMcps.length > 0) {
    // Spell out whose tools these are: they belong to the user's agents, not to
    // the assistant, which runs with no tools at all.
    lines.push(
      `\nMCPs que o usuário habilitou para os AGENTES dele (você não tem acesso a nenhum deles): ${enabledMcps.join(", ")}.`,
    );
  }

  return lines.join("\n");
}
