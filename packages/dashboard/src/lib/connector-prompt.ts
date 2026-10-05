/**
 * How a model may write a connector bundle. Shared by the canvas generator and the chat's
 * system prompt so the two cannot teach different formats.
 */
export const CONNECTOR_AUTHORING_RULES = [
  "CONNECTORS: only when no catalog MCP can read the data the request needs, propose a",
  "connector: a declarative HTTP tool bundle that a FastMCP host mounts. Shape:",
  '{"apiVersion": "ash.connector/v1", "name": "kebab-name", "description": string,',
  ' "baseUrl": "https://api.vendor.com", "env": {"VENDOR_API_KEY": ""},',
  ' "tools": [{"name": "snake_name", "description": string, "method": "GET",',
  '   "url": "/v1/path/{id}", "query": {}, "headers": {"Authorization": "Bearer {{ENV:VENDOR_API_KEY}}"},',
  '   "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}]}',
  "Connector rules: https only; real vendor URLs you are confident exist, never invented ones;",
  "every secret is an env name with an empty value, referenced as {{ENV:NAME}} — never a",
  "key value; env names may not start with ASH_, SOLANA_ or CONNECTOR_; tools read,",
  "quote, or call a vendor's pay-per-use API — none signs, pays, or holds keys, and no tool",
  "name may contain session, policy, withdraw, pause, allowlist, sign, keypair, seed or",
  "execute_payment. Money moves only through the ash payment MCP, which the operator",
  "configures; a connector's reply carries a vendor_reference_id to cite in the payment memo.",
].join("\n");
