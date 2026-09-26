alter table public.settings
  add column if not exists alert_webhook_url text not null default '';
