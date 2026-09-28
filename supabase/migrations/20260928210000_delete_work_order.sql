create table if not exists public.deleted_work_order_snapshots (
  original_work_order_id uuid primary key,
  workshop_id uuid not null references public.workshops(id),
  order_number bigint not null,
  payload jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references auth.users(id)
);

alter table public.deleted_work_order_snapshots enable row level security;
revoke all on public.deleted_work_order_snapshots from public, anon;
grant select, insert on public.deleted_work_order_snapshots to authenticated;

drop policy if exists workshop_member_read_deleted_orders on public.deleted_work_order_snapshots;
create policy workshop_member_read_deleted_orders on public.deleted_work_order_snapshots
  for select to authenticated using (public.is_workshop_member(workshop_id));

create or replace function public.delete_work_order_legacy(p_order_id uuid, p_expected_version integer)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_order public.work_orders%rowtype;
  v_user uuid := auth.uid();
begin
  if v_user is null or auth.jwt()->>'email' is distinct from 'bildiagnosiutbyab@gmail.com' then
    raise exception 'ORDER_DELETE_NOT_AUTHORIZED';
  end if;

  select * into v_order from public.work_orders where id=p_order_id for update;
  if not found or not public.is_workshop_member(v_order.workshop_id) then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if p_expected_version is distinct from v_order.version then
    raise exception 'ORDER_VERSION_CONFLICT';
  end if;
  if exists(select 1 from public.invoices where work_order_id=p_order_id)
    or exists(select 1 from public.payments where work_order_id=p_order_id)
    or exists(select 1 from public.stock_movements where work_order_id=p_order_id)
    or exists(select 1 from public.work_order_parts where work_order_id=p_order_id and stock_movement_id is not null)
    or exists(select 1 from public.warranties where original_order_id=p_order_id or warranty_order_id=p_order_id)
    or exists(select 1 from public.returns where work_order_id=p_order_id)
    or exists(select 1 from public.appointments where work_order_id=p_order_id)
    or exists(select 1 from public.fortnox_links where work_order_id=p_order_id)
    or exists(select 1 from public.attachments where entity_type='work_order' and entity_id=p_order_id)
    or exists(select 1 from public.notes where entity_type='work_order' and entity_id=p_order_id)
    or exists(select 1 from public.time_entries where work_order_id=p_order_id and status='active') then
    raise exception 'ORDER_HAS_LINKED_RECORDS';
  end if;

  insert into public.deleted_work_order_snapshots(original_work_order_id,workshop_id,order_number,deleted_by,payload)
  values(p_order_id,v_order.workshop_id,v_order.order_number,v_user,
    jsonb_build_object(
      'work_order',to_jsonb(v_order),
      'services',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.work_order_services s where s.work_order_id=p_order_id),
      'parts',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.work_order_parts p where p.work_order_id=p_order_id),
      'quotes',(select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from public.quotes q where q.work_order_id=p_order_id),
      'quote_items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.quote_items i join public.quotes q on q.id=i.quote_id where q.work_order_id=p_order_id),
      'time_entries',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.time_entries t where t.work_order_id=p_order_id),
      'diagnostics',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.diagnostic_reports d where d.work_order_id=p_order_id),
      'status_history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from public.order_status_history h where h.work_order_id=p_order_id),
      'catalog_imports',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.catalog_imports c where c.work_order_id=p_order_id),
      'legacy_import_records',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.legacy_import_records l where l.work_order_id=p_order_id),
      'app_state_order',(select e from public.app_state a cross join lateral jsonb_array_elements(a.value) e where a.key='bildiagnos-orders' and e->>'relationalId'=p_order_id::text limit 1)
    ));

  delete from public.quote_items where quote_id in (select id from public.quotes where work_order_id=p_order_id);
  delete from public.quotes where work_order_id=p_order_id;
  update public.legacy_import_records set work_order_id=null where work_order_id=p_order_id;
  delete from public.work_orders where id=p_order_id;
  update public.app_state a set
    value=coalesce((select jsonb_agg(e order by ordinality) from jsonb_array_elements(a.value) with ordinality as x(e,ordinality) where e->>'relationalId' is distinct from p_order_id::text),'[]'::jsonb),
    updated_at=now(),updated_by=v_user
  where a.key='bildiagnos-orders';
  return p_order_id;
end $$;

revoke all on function public.delete_work_order_legacy(uuid,integer) from public,anon;
grant execute on function public.delete_work_order_legacy(uuid,integer) to authenticated;
