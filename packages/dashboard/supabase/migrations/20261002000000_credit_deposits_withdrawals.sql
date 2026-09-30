-- Deposit and withdrawal rails for the prepaid assistant credit (credit_ledger).
--
-- A deposit is a Solana Pay USDC transfer. The server creates an intent with a one-time
-- `reference` key, the payer's wallet includes that key in the transfer, and the server finds
-- the transaction by it, checks recipient, mint and amount on chain, then appends a `deposit`
-- row keyed by the transaction signature. Nothing a user sends can add credit: the only input
-- that matters is a finalized transfer to the operator's own address.
--
-- A withdrawal is a request the operator pays out by hand. The amount is held at request time
-- by a `withdrawal` ledger row, so it cannot also be spent in chat; a rejected request is
-- refunded by an `adjustment` row (docs/runbooks/chat-credit-billing.md).

alter table public.credit_ledger drop constraint credit_ledger_kind_check;
alter table public.credit_ledger
  add constraint credit_ledger_kind_check
  check (kind in ('starter_grant', 'deposit', 'chat_debit', 'adjustment', 'withdrawal'));

-- The sign check is unnamed in the ledger migration, so find it by its definition.
do $$
declare
  name text;
begin
  select conname into name
  from pg_constraint
  where conrelid = 'public.credit_ledger'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%chat_debit%amount_micros%';
  if name is not null then
    execute format('alter table public.credit_ledger drop constraint %I', name);
  end if;
end $$;

alter table public.credit_ledger
  add constraint credit_ledger_amount_sign_check check (
    (kind in ('chat_debit', 'withdrawal') and amount_micros <= 0)
    or (kind in ('starter_grant', 'deposit') and amount_micros >= 0)
    or kind = 'adjustment'
  );

create table public.credit_deposit_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  rail text not null check (rail in ('solana_pay_usdc')),
  cluster text not null check (cluster in ('mainnet-beta', 'devnet')),
  -- The one-time public key the transfer must include; unique so one payment cannot answer two intents.
  reference text not null unique,
  recipient text not null,
  mint text not null,
  amount_micros bigint not null check (amount_micros > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  -- Unique: a transaction credits one intent, whatever it references.
  signature text unique,
  credited_micros bigint check (credited_micros > 0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index credit_deposit_intents_org_idx on public.credit_deposit_intents (org_id, created_at desc);

create table public.credit_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  amount_micros bigint not null check (amount_micros > 0),
  destination_kind text not null check (destination_kind in ('solana_usdc', 'pix')),
  destination text not null check (length(destination) between 1 and 140),
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  -- The ledger row that holds the amount, so paying out or refunding can cite it.
  hold_idempotency_key text not null unique,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index credit_withdrawal_requests_org_idx
  on public.credit_withdrawal_requests (org_id, created_at desc);

alter table public.credit_deposit_intents enable row level security;
alter table public.credit_withdrawal_requests enable row level security;

-- Members read their org's rows. No write policy on either table, for the same reason as the
-- ledger: every write runs server-side under the service role.
create policy credit_deposit_intents_org_member_read on public.credit_deposit_intents
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );

create policy credit_withdrawal_requests_org_member_read on public.credit_withdrawal_requests
  for select using (
    org_id in (
      select org_id from public.memberships
      where account_id in (
        select account_id from public.identities where auth_user_id = (select auth.uid())
      )
    )
  );
