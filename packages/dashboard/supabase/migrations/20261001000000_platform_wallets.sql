-- ADR-024: email sign-in, a platform wallet per account, external wallets as a Pro feature.
--
-- Three tables, all readable by their own account and none writable from a user session.
-- `accounts_update_self` (tenancy.sql) lets a user update any column of their own account row,
-- which is why the plan does not live there: a `plan` column on `accounts` would be a
-- self-service upgrade to Pro.

-- A magic-link sign-in is a third door beside Google and a wallet. Its subject is the
-- auth user id, not the address: the address can change, and `unique (provider, subject)`
-- must not collide when it does.
alter table public.identities drop constraint identities_provider_check;
alter table public.identities
  add constraint identities_provider_check check (provider in ('google', 'wallet', 'email'));

-- Written by billing and by operators, never by the account it describes.
create table public.account_entitlements (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  updated_at timestamptz not null default now()
);

-- One per account, created at first sign-in. `custody` says who can sign for the address,
-- and the UI reads it before offering anything that would send funds there:
--   'none'     -- the development stub; no key exists anywhere, funds sent here are lost.
--   'provider' -- an embedded-wallet vendor holds or shards the key (ADR-024, vendor TBD).
create table public.platform_wallets (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  public_key text not null unique,
  provider text not null,
  -- The vendor's own handle for the wallet, when it has one; the stub has none.
  provider_wallet_id text,
  custody text not null check (custody in ('none', 'provider')),
  -- Vendor response fields worth keeping for support, never key material. Nothing in this
  -- table is secret: the private half is either nowhere or with the vendor.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Self-custody wallets a Pro account has proven control of by signing a link message.
-- Insert is service-role only because RLS cannot check an ed25519 signature: a user session
-- that could insert here could claim any address on chain.
create table public.linked_wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  address text not null,
  -- Which extension signed, for display only. The address is the identity.
  wallet_name text not null default '',
  linked_at timestamptz not null default now(),
  unique (account_id, address)
);

create index linked_wallets_account_id_idx on public.linked_wallets (account_id);

alter table public.account_entitlements enable row level security;
alter table public.platform_wallets enable row level security;
alter table public.linked_wallets enable row level security;

create policy account_entitlements_own on public.account_entitlements
  for select using (
    account_id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

create policy platform_wallets_own on public.platform_wallets
  for select using (
    account_id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

create policy linked_wallets_own on public.linked_wallets
  for select using (
    account_id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );

-- Unlinking is the user's own decision and needs no proof beyond the session.
create policy linked_wallets_unlink_own on public.linked_wallets
  for delete using (
    account_id in (select account_id from public.identities where auth_user_id = (select auth.uid()))
  );
