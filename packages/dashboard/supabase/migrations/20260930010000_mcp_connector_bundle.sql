-- Declarative connector bundle for rows served by services/connector-host (FastMCP).
-- Holds env *names* and tool templates only; values stay in env_ciphertext. The dashboard
-- re-validates it on read with @ash/contract's connectorBundleSchema.
alter table public.mcp_servers add column connector jsonb;
