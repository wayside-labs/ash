import type { StoredMcp } from "@/lib/schema";
import type { BuiltinTemplateId } from "@/lib/templates/catalog";

export type WorkstationMcpSpec = {
  name: string;
  description: string;
  scope: StoredMcp["scope"];
  /** When scope is workflow or agent, matches workflow name or agent name after apply. */
  scopeName: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
};

const JUPITER_MCP: Omit<WorkstationMcpSpec, "scope" | "scopeName"> = {
  name: "Solana Jupiter",
  description: "Quotes and unsigned swaps via Jupiter (routes Raydium, Orca, and others).",
  command: "ash-integrations",
  args: ["mcp", "jupiter"],
  env: {
    JUPITER_API_BASE: "https://quote-api.jup.ag",
  },
};

// The allowlist ships empty on purpose: the connector then only lets funds return to the signing
// desk on its own chain, and the operator names every other recipient before agents can use it.
const SODAX_MCP: Omit<WorkstationMcpSpec, "scope" | "scopeName"> = {
  name: "SODAX cross-network",
  description:
    "Cross-network swaps, bridge, money market and leverage-yield vaults via SODAX (unsigned intents for the desk).",
  command: "ash-integrations",
  args: ["mcp", "sodax"],
  env: {
    SODAX_ALLOWED_DESTINATIONS: "",
  },
};

/** Extra MCP rows materialized when applying a built-in workstation template. */
export const WORKSTATION_INTEGRATION_MCPS: Partial<
  Record<BuiltinTemplateId, WorkstationMcpSpec[]>
> = {
  "builtin:solana-workstation": [
    {
      ...JUPITER_MCP,
      scope: "workflow",
      scopeName: null, // filled with workflow name at apply time
    },
    {
      ...SODAX_MCP,
      scope: "workflow",
      scopeName: null,
    },
  ],
};
