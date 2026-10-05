import type { ConnectorBundle } from "@ash/contract/connector-bundle";
import { CONNECTOR_HOST_COMMAND } from "@/lib/mcp-config";
import type { StoredMcp } from "@/lib/schema";

/**
 * The MCP row a connector bundle becomes. Any non-empty env value in the bundle moves onto
 * the row, where `maskState` covers it, and is blanked in the bundle: a bundle is shown,
 * exported and stored unmasked, so it must never be where a key lives — even when the
 * operator pasted one into the file.
 */
export function connectorMcpRow(
  bundle: ConnectorBundle,
  target: { scope: StoredMcp["scope"]; scopeName: string | null; enabled: boolean },
): Omit<StoredMcp, "id"> {
  const env: Record<string, string> = {};
  const declared: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundle.env)) {
    declared[key] = "";
    env[key] = value;
  }
  return {
    name: bundle.name,
    description: bundle.description.slice(0, 280),
    enabled: target.enabled,
    scope: target.scope,
    scopeName: target.scope === "global" ? null : target.scopeName,
    command: CONNECTOR_HOST_COMMAND,
    args: [],
    env,
    connector: { ...bundle, env: declared },
    demo: false,
  };
}
