import type { StoredAgent } from "@/lib/schema";
import type { SessionView } from "@/lib/server/solana";

/** Agent that can spend from the workflow vault (dashboard label or on-chain later). */
export function isPayingAgent(agent: Pick<StoredAgent, "dailyLimitUsd" | "paysTo">): boolean {
  return agent.dailyLimitUsd > 0 || agent.paysTo.length > 0;
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Match dashboard agent name to an on-chain session label. */
export function findSessionForAgent(
  agent: Pick<StoredAgent, "name" | "sessionAddress">,
  sessions: SessionView[],
): SessionView | undefined {
  if (agent.sessionAddress) {
    const byAddress = sessions.find((s) => s.address === agent.sessionAddress);
    if (byAddress) return byAddress;
  }
  const name = normalizeLabel(agent.name);
  return sessions.find((s) => !s.revoked && normalizeLabel(s.label) === name);
}

/** Hot signing key: stored wallet first, else matched session_key from chain. */
export function resolveAgentSigningKey(
  agent: Pick<StoredAgent, "name" | "walletAddress" | "sessionAddress">,
  sessions?: SessionView[],
): string | null {
  if (agent.walletAddress) return agent.walletAddress;
  const session = sessions ? findSessionForAgent(agent, sessions) : undefined;
  return session?.sessionKey ?? null;
}

/** Session PDA when known in store or discoverable on-chain. */
export function resolveAgentSessionAddress(
  agent: Pick<StoredAgent, "name" | "sessionAddress">,
  sessions?: SessionView[],
): string | null {
  if (agent.sessionAddress) return agent.sessionAddress;
  const session = sessions ? findSessionForAgent(agent, sessions) : undefined;
  return session?.address ?? null;
}
