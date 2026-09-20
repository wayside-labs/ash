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
 * The only boundary where a stored secret could leak to the browser. Every
 * route that returns state goes through here — /apis shows a mask, and the
 * chat route reads the raw secret server-side without ever echoing it.
 */
export function maskState(state: DashboardState): MaskedState {
  return {
    ...state,
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
