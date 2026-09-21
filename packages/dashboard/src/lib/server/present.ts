import type { DashboardState } from "@/lib/schema";

export type MaskedApiKey = {
  id: string;
  provider: string;
  keyMasked: string;
  status: "connected" | "disconnected";
  createdAt: string;
};

export type MaskedState = Omit<DashboardState, "apiKeys"> & { apiKeys: MaskedApiKey[] };

/**
 * What the browser sees in place of a stored MCP env value. Fixed-width on
 * purpose: a PATCH that echoes it back means "keep what is on disk", which is
 * what lets the edit dialog round-trip a secret it was never shown.
 */
export const MASKED_ENV_VALUE = "\u2022".repeat(12);

/**
 * The only boundary where a stored secret could leak to the browser. Every
 * route that returns state goes through here — /apis shows a mask, and the
 * chat route reads the raw secret server-side without ever echoing it.
 */
export function maskState(state: DashboardState): MaskedState {
  return {
    ...state,
    mcps: state.mcps.map((mcp) => ({
      ...mcp,
      // Keys stay readable — the dialog has to render the shape of the env
      // block — but no value crosses the wire. An unset key masks to nothing,
      // so the dialog shows an empty field rather than claiming a value it has.
      env: Object.fromEntries(
        Object.entries(mcp.env).map(([key, value]) => [key, value ? MASKED_ENV_VALUE : ""]),
      ),
    })),
    apiKeys: state.apiKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      keyMasked: maskSecret(key.secret),
      status: key.secret ? "connected" : "disconnected",
      createdAt: key.createdAt,
    })),
  };
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  const head = secret.slice(0, Math.min(7, Math.max(0, secret.length - 4)));
  const tail = secret.slice(-4);
  return `${head}${"•".repeat(12)}${tail}`;
}

/**
 * Folds an env block coming back from the browser onto the stored one: a value
 * left at `MASKED_ENV_VALUE` was never revealed, so it keeps its stored value.
 * Keys the patch drops are deleted — the dialog sends the whole block.
 */
export function restoreMaskedEnv(
  incoming: Record<string, string>,
  stored: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(incoming).map(([key, value]) => [
      key,
      value === MASKED_ENV_VALUE ? (stored[key] ?? "") : value,
    ]),
  );
}
