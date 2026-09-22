-- ADR-017: accounts -> organizations -> workflows, with RLS as the floor.
--
-- Every policy resolves in two hops, auth.uid() -> identities.account_id ->
-- memberships.org_id, rather than trusting a claim in the JWT: a claim goes
-- stale between linking a wallet and the next token refresh, and the user would
-- not see their own state in between.
--
-- auth.uid() is wrapped in a scalar subquery throughout. Postgres then evaluates
-- it once per statement as an initplan instead of once per row, which is the
-- difference between an index lookup and a scan on every policy check.

create extension if not exists pgcrypto;

-- One person. Several ways in (identities), several orgs (memberships).
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  -- X25519 public half, base58. The private half is derived from the passkey's
  -- PRF output and never leaves the browser. Stored now, while every org has one
  -- member and nothing is shared, because wrapping an org key for a member who
  -- is not present needs their public key -- and adding the column later would
  -- mean every existing user re-enrolling their passkey (ADR-017, issue #35).
  wrap_pubkey text,
  created_at timestamptz not null default now()
);

-- Supabase's linkIdentity() covers OAuth providers only, so a wallet cannot be
-- attached to a Google account through it. This table is that join: several
-- auth.users rows, one account.
create table public.identities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'wallet')),
  -- Google's `sub`, or the base58 wallet address. Several wallets per account is
  -- the expected case: workflows record which one owns their treasury on-chain.
  subject text not null,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

create index identities_account_id_idx on public.identities (account_id);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Ships single-member. The table exists from the first migration so that
-- multi-member is a feature rather than a primary-key migration of six tables.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (account_id, org_id)
);

create index memberships_account_id_idx on public.memberships (account_id);
create index memberships_org_id_idx on public.memberships (org_id);

-- Work hangs off the org: if two members would need to see it, it is the org's.

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default '⚡',
  treasury_address text,
  -- The wallet that is `owner` on-chain for this treasury. Several workflows in
  -- one org may name different wallets of the same account.
  owner_address text,
  cluster text not null default 'devnet' check (cluster in ('devnet', 'testnet', 'mainnet-beta')),
  demo boolean not null default false,
  demo_balance_usd numeric,
  created_at timestamptz not null default now()
);

create index workflows_org_id_idx on public.workflows (org_id);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  name text not null,
  role text not null default '',
  wallet_address text,
  session_address text,
  daily_limit_usd numeric not null default 0 check (daily_limit_usd >= 0),
  pays_to text[] not null default '{}',
  receives_from text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'expired')),
  demo boolean not null default false,
  demo_balance_usd numeric,
  demo_spent_usd numeric,
  created_at timestamptz not null default now()
);

create index agents_org_id_idx on public.agents (org_id);
create index agents_workflow_id_idx on public.agents (workflow_id);

create table public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  enabled boolean not null default false,
  scope text not null default 'global' check (scope in ('global', 'workflow', 'agent')),
  scope_name text,
  command text not null default '',
  args text[] not null default '{}',
  -- Environment for a spawned runner: connection strings and API keys. Stored as
  -- ciphertext the server cannot read (issue #35). There is deliberately no
  -- plaintext column, so the interim rule -- persist no secret until the passkey
  -- path ships -- cannot be violated by forgetting.
  env_ciphertext bytea,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index mcp_servers_org_id_idx on public.mcp_servers (org_id);

create table public.rag_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  type text not null check (type in ('pdf', 'md', 'url')),
  status text not null default 'indexing' check (status in ('indexed', 'indexing', 'error')),
  scope text not null default 'global' check (scope in ('global', 'workflow', 'agent')),
  scope_name text not null default 'All',
  source text,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index rag_documents_org_id_idx on public.rag_documents (org_id);

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default '🧩',
  content text not null default '',
  scope text not null default 'global' check (scope in ('global', 'workflow', 'agent')),
  scope_name text,
  enabled boolean not null default false,
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index skills_org_id_idx on public.skills (org_id);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default '🔌',
  url text not null default '',
  connected boolean not null default false,
  created_at timestamptz not null default now()
);

create index integrations_org_id_idx on public.integrations (org_id);

-- Credentials and preferences hang off the account, not the org.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider text not null,
  -- Same rule as mcp_servers.env_ciphertext: ciphertext only, no plaintext
  -- column to forget to fill correctly.
  secret_ciphertext bytea,
  created_at timestamptz not null default now(),
  unique (account_id, provider)
);

create index api_keys_account_id_idx on public.api_keys (account_id);

create table public.profiles (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  display_name text not null default '',
  company text not null default '',
  bio text not null default '',
  email text not null default ''
);

create table public.settings (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  language text not null default 'en' check (language in ('pt-BR', 'en')),
  email_notifications boolean not null default false,
  limit_alerts boolean not null default true
);

-- RLS. No table gets a permissive fallback, and no policy is `using (true)`.

alter table public.accounts enable row level security;
alter table public.identities enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.workflows enable row level security;
alter table public.agents enable row level security;
alter table public.mcp_servers enable row level security;
alter table public.rag_documents enable row level security;
alter table public.skills enable row level security;
alter table public.integrations enable row level security;
alter table public.api_keys enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;

-- The tenancy tables below carry select policies and, for accounts, an update.
-- The absence of insert policies is deliberate, not an oversight: creating an
-- account, an organization, a membership or an identity are bootstrap and
-- invitation paths that run server-side under the service role (issue #33).
-- A user session must never be able to mint itself a membership.

-- Hop 1: the caller's account. Self-referential without recursion, because the
-- predicate is on auth_user_id and never consults the policy again.
create policy identities_self on public.identities
  for select using (auth_user_id = (select auth.uid()));

create policy accounts_self on public.accounts
  for select using (
    id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

create policy accounts_update_self on public.accounts
  for update using (
    id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

-- Hop 2: the orgs that account belongs to. Membership rows are readable, never
-- writable from a user session: joining an org is an invitation flow, not an
-- insert the joiner performs.
create policy memberships_own on public.memberships
  for select using (
    account_id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

create policy organizations_member on public.organizations
  for select using (
    id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

-- One predicate, six tables. Written per table rather than behind a security
-- definer function on purpose: a single definer function is one place where a
-- mistake exposes everything at once.
do $$
declare
  t text;
begin
  foreach t in array array[
    'workflows', 'agents', 'mcp_servers', 'rag_documents', 'skills', 'integrations'
  ] loop
    execute format($f$
      create policy %1$s_org_member on public.%1$s
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
    $f$, t);
  end loop;
end $$;

-- Account-scoped tables: the same first hop, no org involved.
do $$
declare
  t text;
begin
  foreach t in array array['api_keys', 'profiles', 'settings'] loop
    execute format($f$
      create policy %1$s_own on public.%1$s
        for all
        using (
          account_id in (
            select account_id from public.identities where auth_user_id = (select auth.uid())
          )
        )
        with check (
          account_id in (
            select account_id from public.identities where auth_user_id = (select auth.uid())
          )
        );
    $f$, t);
  end loop;
end $$;
