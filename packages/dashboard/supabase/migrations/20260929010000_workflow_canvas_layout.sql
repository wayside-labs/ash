-- Plan phase 2: the canvas stores only its layout. The graph is derived from agents,
-- pays_to and MCP scope, so nothing here can disagree with what the runner export uses.
alter table public.workflows
  add column if not exists canvas_layout jsonb not null default '{"positions": {}, "hidden": []}'::jsonb;
