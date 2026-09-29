-- Operator-saved workflow presets (built-in starters ship from the app catalog).

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  icon text not null default '📋',
  summary text not null default '',
  how_it_works text not null default '',
  setup_steps jsonb not null default '[]',
  agents jsonb not null default '[]',
  docs_path text,
  created_at timestamptz not null default now()
);

create index workflow_templates_org_id_idx on public.workflow_templates (org_id);

alter table public.workflow_templates enable row level security;

create policy workflow_templates_select on public.workflow_templates for select using (
  org_id in (
    select m.org_id
    from public.memberships m
    join public.identities i on i.account_id = m.account_id
    where i.auth_user_id = (select auth.uid())
  )
);

create policy workflow_templates_insert on public.workflow_templates for insert with check (
  org_id in (
    select m.org_id
    from public.memberships m
    join public.identities i on i.account_id = m.account_id
    where i.auth_user_id = (select auth.uid())
  )
);

create policy workflow_templates_update on public.workflow_templates for update using (
  org_id in (
    select m.org_id
    from public.memberships m
    join public.identities i on i.account_id = m.account_id
    where i.auth_user_id = (select auth.uid())
  )
);

create policy workflow_templates_delete on public.workflow_templates for delete using (
  org_id in (
    select m.org_id
    from public.memberships m
    join public.identities i on i.account_id = m.account_id
    where i.auth_user_id = (select auth.uid())
  )
);
