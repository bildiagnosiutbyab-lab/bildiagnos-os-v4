create table if not exists public.legacy_app_state_backups (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  payload jsonb not null,
  payload_md5 text not null,
  order_count integer not null,
  source_updated_at timestamptz,
  source_updated_by uuid,
  backed_up_at timestamptz not null default now(),
  backup_reason text not null,
  unique (source_key, payload_md5)
);
alter table public.legacy_app_state_backups enable row level security;
insert into public.legacy_app_state_backups(source_key,payload,payload_md5,order_count,source_updated_at,source_updated_by,backup_reason)
select key,value,md5(value::text),jsonb_array_length(value),updated_at,updated_by,'Pre-relational migration immutable backup'
from public.app_state where key='bildiagnos-orders'
on conflict(source_key,payload_md5) do nothing;
