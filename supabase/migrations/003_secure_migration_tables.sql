alter table public.order_statuses enable row level security;
alter table public.migration_runs enable row level security;
alter table public.legacy_import_records enable row level security;

drop policy if exists authenticated_read_order_statuses on public.order_statuses;
create policy authenticated_read_order_statuses
on public.order_statuses for select to authenticated using (true);

drop policy if exists owner_read_migration_runs on public.migration_runs;
create policy owner_read_migration_runs
on public.migration_runs for select to authenticated
using (exists(select 1 from public.workshop_members where user_id=auth.uid() and role='owner'));

drop policy if exists owner_read_legacy_import_records on public.legacy_import_records;
create policy owner_read_legacy_import_records
on public.legacy_import_records for select to authenticated
using (exists(select 1 from public.workshop_members where user_id=auth.uid() and role='owner'));
