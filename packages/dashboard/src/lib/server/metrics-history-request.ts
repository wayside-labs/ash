import type { SessionContext } from "@/lib/metrics/history";
import type { SolanaCluster } from "@/lib/schema";
import { isLikelyAddress } from "@/lib/schema";
import { readDestinations, readTreasury } from "@/lib/server/solana";
import { mintSymbol } from "@/lib/utils";

function list(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function destinationLabels(
  cluster: SolanaCluster,
  rpc: string | null,
  policy: string,
): Promise<Record<string, string>> {
  try {
    const entries = await readDestinations(cluster, rpc, policy);
    return Object.fromEntries(entries.map((entry) => [entry.owner, entry.label]));
  } catch {
    return {};
  }
}

export async function buildSessionContexts(input: {
  cluster: SolanaCluster;
  rpc: string | null;
  sessions: string[];
  treasuries: string[];
  workflowId: string | null;
  agentId: string | null;
}): Promise<SessionContext[]> {
  const contexts: SessionContext[] = [];
  for (const sessionAddress of input.sessions) {
    for (const treasuryAddress of input.treasuries) {
      try {
        const treasury = await readTreasury(input.cluster, input.rpc, treasuryAddress);
        if (!treasury) continue;
        const session = treasury.sessions.find((row) => row.address === sessionAddress);
        if (!session) continue;
        const labels = await destinationLabels(input.cluster, input.rpc, session.policy);
        contexts.push({
          session: session.address,
          treasury: treasury.address,
          policy: session.policy,
          decimalsByMint: treasury.decimals,
          symbolByMint: Object.fromEntries(
            Object.keys(treasury.decimals).map((mint) => [mint, mintSymbol(mint)]),
          ),
          destinationLabels: labels,
          workflow_id: input.workflowId,
          agent_id: input.agentId,
          agent_name: session.label,
        });
        break;
      } catch {
        // One unreadable treasury must not block the others.
      }
    }
  }
  return contexts;
}

export function parseHistoryParams(url: URL) {
  return {
    rpc: url.searchParams.get("rpc"),
    sessions: list(url.searchParams.get("sessions")).filter(isLikelyAddress),
    treasuries: list(url.searchParams.get("treasuries")).filter(isLikelyAddress),
    before: url.searchParams.get("before"),
    limit: Number(url.searchParams.get("limit") ?? "20"),
    outcome: url.searchParams.get("outcome"),
    destination: url.searchParams.get("destination"),
    workflowId: url.searchParams.get("workflowId"),
    agentId: url.searchParams.get("agentId"),
  };
}
