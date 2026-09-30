-- Prepaid credit for the hosted assistant: one append-only ledger per org, the
-- balance is its sum. Hosted billing only — nothing here reaches the on-chain
-- program, which charges no fee of any kind (docs/research/revenue-model-analysis.md).
--
-- The org pays, not the account: work already hangs off the org ("if two members
-- would need to see it, it is the org's"), and a shared team balance is the case
-- multi-member exists for. account_id records who spent.
--
-- Amounts are integer micro-USD. A float balance drifts; a bigint one does not.

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  kind text not null check (kind in ('starter_grant', 'deposit', 'chat_debit', 'adjustment')),
  -- Signed: credits positive, debits negative. The check pins the sign to the
  -- kind so a bug cannot record a debit that adds money.
  amount_micros bigint not null,
  model text,
  prompt_tokens integer check (prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens >= 0),
  raw_cost_micros bigint check (raw_cost_micros >= 0),
  markup_bps integer check (markup_bps >= 0),
  markup_micros bigint check (markup_micros >= 0),
  -- The upstream never reported a cost (aborted stream) and the charge came
  -- from list prices. Kept so a dispute can tell measured from estimated.
  estimated boolean not null default false,
  note text,
  -- Replays of the same credit or debit are a unique violation, not a second
  -- row: `starter:<org>` for the grant, the request id for a chat turn, the
  -- provider's transaction id for a deposit.
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (
    (kind = 'chat_debit' and amount_micros <= 0)
    or (kind in ('starter_grant', 'deposit') and amount_micros >= 0)
    or kind = 'adjustment'
  )
);

create index credit_ledger_org_created_idx on public.credit_ledger (org_id, created_at desc);

alter table public.credit_ledger enable row level security;

-- Members read their org's ledger. There is no insert, update or delete policy,
-- and that absence is the whole security model: a user session that could
-- insert here could mint itself credit. Every write runs server-side under the
-- service role (src/lib/server/billing/ledger.ts).
create policy credit_ledger_org_member_read on public.credit_ledger
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

-- Summed in the database rather than paging every row to the server per turn.
-- security invoker, so the caller's RLS applies when it is ever called with a
-- user session; the server calls it with the service role.
create function public.credit_balance(p_org_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount_micros), 0)::bigint
  from public.credit_ledger
  where org_id = p_org_id;
$$;
