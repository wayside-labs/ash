-- ADR-022: agent-side processes report to the dashboard; a person decides what they ask.
--
-- Three org-scoped tables. The ingest route authenticates by bearer token and writes with
-- the service role, so agent_events and reviews carry no insert policy: a user session can
-- read and decide, never fabricate what an agent reported.

create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  -- Looked up by hash; the token itself is kept (same class as mcp_servers.env) because the
  -- runner export has to hand it to the agent's MCP.
  token_hash text not null unique,
  token text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index ingest_tokens_org_id_idx on public.ingest_tokens (org_id);
-- One live token per workflow: issuing a new one must retire the old in the same breath.
create unique index ingest_tokens_one_live_idx
  on public.ingest_tokens (workflow_id) where revoked_at is null;

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  kind text not null check (
    kind in ('payment_denied', 'headroom_low', 'payment_review_required', 'limit_increase_requested')
  ),
  event jsonb not null,
  received_at timestamptz not null default now()
);

create index agent_events_org_received_idx on public.agent_events (org_id, received_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  kind text not null check (kind in ('payment', 'limit_increase')),
  intent_id text check (intent_id is null or intent_id ~ '^[0-9a-f]{32}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  event jsonb not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.accounts (id) on delete set null,
  expires_at timestamptz not null,
  check ((kind = 'payment') = (intent_id is not null))
);

create index reviews_org_created_idx on public.reviews (org_id, created_at desc);
-- An approval is bound to exactly one intent per workflow.
create unique index reviews_workflow_intent_idx
  on public.reviews (workflow_id, intent_id) where intent_id is not null;

alter table public.ingest_tokens enable row level security;
alter table public.agent_events enable row level security;
alter table public.reviews enable row level security;

-- Same two-hop membership predicate as the tenancy migration, spelled out per table.
create policy ingest_tokens_org_member on public.ingest_tokens
  for all
  using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  )
  with check (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

create policy agent_events_org_read on public.agent_events
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

create policy reviews_org_read on public.reviews
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

-- Deciding is the one write a member makes, and only on a pending row.
create policy reviews_org_decide on public.reviews
  for update
  using (
    status = 'pending'
    and org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  )
  with check (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

-- 1.3: integrations become notification channels.
alter table public.integrations
  add column if not exists kind text not null default 'webhook'
    check (kind in ('webhook', 'slack', 'telegram', 'email')),
  add column if not exists target text not null default '',
  add column if not exists events text[] not null
    default array['payment_denied', 'headroom_low', 'payment_review_required', 'limit_increase_requested'],
  add column if not exists enabled boolean not null default true,
  add column if not exists last_delivery_at timestamptz,
  add column if not exists last_error text;

-- The single alert webhook becomes the org's first channel. settings is account-scoped, so
-- each org takes the webhook of its earliest member that set one.
insert into public.integrations (org_id, name, icon, kind, target, events, url, connected)
select distinct on (m.org_id)
  m.org_id,
  'Alert webhook',
  '🔔',
  case when s.alert_webhook_url like 'https://hooks.slack.com/%' then 'slack' else 'webhook' end,
  s.alert_webhook_url,
  array['payment_denied', 'headroom_low'],
  '',
  true
from public.settings s
join public.memberships m on m.account_id = s.account_id
where s.alert_webhook_url <> ''
order by m.org_id, m.created_at;

-- Delivered through the channel from now on; leaving it set would alert twice.
update public.settings set alert_webhook_url = '' where alert_webhook_url <> '';
