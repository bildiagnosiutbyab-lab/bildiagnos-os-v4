alter function public.parse_legacy_timestamp(text) set search_path=public;
alter function public.map_order_status_es(text) set search_path=public;
alter function public.map_order_status_code(text) set search_path=public;

drop policy if exists self_read_profile on public.profiles;
create policy self_read_profile on public.profiles for select to authenticated using (id=(select auth.uid()));
drop policy if exists self_update_profile on public.profiles;
create policy self_update_profile on public.profiles for update to authenticated
using (id=(select auth.uid())) with check (id=(select auth.uid()));
drop policy if exists member_read_memberships on public.workshop_members;
create policy member_read_memberships on public.workshop_members for select to authenticated
using (user_id=(select auth.uid()));

do $$
declare r record; idx_name text;
begin
  for r in
    select n.nspname schema_name,c.relname table_name,
      string_agg(a.attname,',' order by k.ordinality) columns_csv,
      string_agg(format('%I',a.attname),',' order by k.ordinality) quoted_columns
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral unnest(con.conkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
    where con.contype='f' and n.nspname='public'
    group by n.nspname,c.relname,con.oid
  loop
    idx_name:=left('idx_'||r.table_name||'_'||replace(r.columns_csv,',','_'),63);
    execute format('create index if not exists %I on %I.%I (%s)',idx_name,r.schema_name,r.table_name,r.quoted_columns);
  end loop;
end $$;
