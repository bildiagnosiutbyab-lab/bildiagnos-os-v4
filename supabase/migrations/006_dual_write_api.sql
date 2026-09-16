create unique index if not exists one_ui_state_time_entry_per_order
on public.time_entries(work_order_id) where source='ui_state';

create or replace function public.map_order_status_es(raw_status text)
returns text language sql immutable as $$ select case raw_status
  when 'Abierta' then 'open' when 'En diagnóstico' then 'diagnosis'
  when 'Esperando piezas' then 'waiting_parts' when 'En reparación' then 'repair'
  when 'Terminada' then 'completed' when 'Pagada' then 'paid'
  when 'Cancelada' then 'cancelled' when 'Garantía' then 'warranty' else 'open' end $$;
create or replace function public.map_order_status_code(raw_status text)
returns text language sql immutable as $$ select case raw_status
  when 'open' then 'Abierta' when 'diagnosis' then 'En diagnóstico'
  when 'waiting_parts' then 'Esperando piezas' when 'repair' then 'En reparación'
  when 'completed' then 'Terminada' when 'paid' then 'Pagada'
  when 'cancelled' then 'Cancelada' when 'warranty' then 'Garantía' else 'Abierta' end $$;

create or replace function public.order_as_legacy_json(target_order uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'id', coalesce(wo.legacy_order_id,wo.id::text), 'relationalId',wo.id,
  'version',wo.version, 'customer',wo.customer_name_snapshot,
  'plate',wo.plate_snapshot, 'vehicle',coalesce(wo.vehicle_snapshot,''),
  'mileage',coalesce(wo.mileage_raw,''), 'requestedWork',coalesce(wo.requested_work,''),
  'diagnosis',coalesce((select dr.summary from diagnostic_reports dr where dr.work_order_id=wo.id order by dr.created_at desc limit 1),''),
  'dtc',coalesce((select dr.raw_dtc_text from diagnostic_reports dr where dr.work_order_id=wo.id order by dr.created_at desc limit 1),''),
  'status',public.map_order_status_code(wo.status_code),
  'accumulatedSeconds',coalesce((select te.duration_seconds from time_entries te where te.work_order_id=wo.id and te.source='ui_state' order by te.updated_at desc limit 1),
    (select coalesce(sum(te.duration_seconds),0) from time_entries te where te.work_order_id=wo.id and te.source='legacy_accumulated'),0),
  'timerStartedAt',(select case when te.status='active' then (extract(epoch from te.started_at)*1000)::bigint::text else null end from time_entries te where te.work_order_id=wo.id and te.source='ui_state' order by te.updated_at desc limit 1),
  'createdAt',to_char(wo.created_at at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS'),
  'updatedAt',to_char(wo.updated_at at time zone 'Europe/Stockholm','YYYY-MM-DD HH24:MI:SS')
) from work_orders wo where wo.id=target_order;
$$;

create or replace function public.list_work_orders_legacy()
returns setof jsonb language sql stable security invoker set search_path=public as $$
  select public.order_as_legacy_json(wo.id) from work_orders wo
  where public.is_workshop_member(wo.workshop_id) order by wo.created_at desc;
$$;

create or replace function public.save_work_order_legacy(p_order jsonb, p_expected_version integer default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_workshop uuid; v_user uuid:=auth.uid(); v_customer uuid; v_vehicle uuid; v_order uuid;
  v_existing work_orders%rowtype; v_status text; v_plate text; v_plate_norm text;
  v_customer_name text; v_vehicle_text text; v_legacy_id text; v_mileage integer;
  v_old_status text; v_service uuid; v_diag uuid; v_timer timestamptz;
  v_seconds integer:=greatest(coalesce((p_order->>'accumulatedSeconds')::integer,0),0);
  v_result jsonb;
begin
  select workshop_id into v_workshop from workshop_members where user_id=v_user order by created_at limit 1;
  if v_workshop is null then raise exception 'No workshop membership'; end if;
  v_legacy_id:=coalesce(nullif(p_order->>'id',''),extract(epoch from clock_timestamp())::bigint::text);
  v_customer_name:=coalesce(nullif(btrim(p_order->>'customer'),''),'Cliente sin nombre');
  v_plate:=upper(coalesce(nullif(btrim(p_order->>'plate'),''),'SIN-MATRICULA'));
  v_plate_norm:=upper(regexp_replace(v_plate,'[^A-Z0-9ÅÄÖ]','','g'));
  v_vehicle_text:=nullif(btrim(p_order->>'vehicle'),'');
  v_status:=public.map_order_status_es(p_order->>'status');
  v_mileage:=case when regexp_replace(coalesce(p_order->>'mileage',''),'[^0-9]','','g') ~ '^[0-9]+$'
    and regexp_replace(coalesce(p_order->>'mileage',''),'[^0-9]','','g')<>''
    then regexp_replace(p_order->>'mileage','[^0-9]','','g')::integer else null end;
  v_timer:=public.parse_legacy_timestamp(p_order->>'timerStartedAt');

  select * into v_existing from work_orders where workshop_id=v_workshop and legacy_order_id=v_legacy_id for update;
  if v_existing.id is not null and p_expected_version is not null and v_existing.version<>p_expected_version then
    raise exception using errcode='40001',message='ORDER_VERSION_CONFLICT';
  end if;

  select id into v_customer from customers where workshop_id=v_workshop and lower(btrim(display_name))=lower(v_customer_name) order by created_at limit 1;
  if v_customer is null then
    insert into customers(workshop_id,display_name,legacy_name,created_by,updated_by)
    values(v_workshop,v_customer_name,v_customer_name,v_user,v_user) returning id into v_customer;
  end if;
  insert into vehicles(workshop_id,registration_plate,registration_plate_normalized,raw_description,created_by,updated_by)
  values(v_workshop,v_plate,v_plate_norm,v_vehicle_text,v_user,v_user)
  on conflict(workshop_id,registration_plate_normalized) do update set raw_description=coalesce(excluded.raw_description,vehicles.raw_description),updated_at=now(),updated_by=v_user
  returning id into v_vehicle;
  insert into customer_vehicles(workshop_id,customer_id,vehicle_id)
  select v_workshop,v_customer,v_vehicle where not exists(select 1 from customer_vehicles where customer_id=v_customer and vehicle_id=v_vehicle and valid_to is null);

  if v_existing.id is null then
    insert into work_orders(workshop_id,legacy_order_id,customer_id,vehicle_id,status_code,mileage,mileage_raw,requested_work,
      customer_name_snapshot,plate_snapshot,vehicle_snapshot,opened_at,migration_source,created_by,updated_by)
    values(v_workshop,v_legacy_id,v_customer,v_vehicle,v_status,v_mileage,p_order->>'mileage',p_order->>'requestedWork',
      v_customer_name,v_plate,v_vehicle_text,coalesce(public.parse_legacy_timestamp(p_order->>'createdAt'),now()),'dual_write',v_user,v_user)
    returning id into v_order;
    insert into order_status_history(workshop_id,work_order_id,to_status,source,changed_by) values(v_workshop,v_order,v_status,'dual_write',v_user);
  else
    v_order:=v_existing.id; v_old_status:=v_existing.status_code;
    update work_orders set customer_id=v_customer,vehicle_id=v_vehicle,status_code=v_status,mileage=v_mileage,
      mileage_raw=p_order->>'mileage',requested_work=p_order->>'requestedWork',customer_name_snapshot=v_customer_name,
      plate_snapshot=v_plate,vehicle_snapshot=v_vehicle_text,updated_at=now(),updated_by=v_user,version=version+1 where id=v_order;
    if v_old_status is distinct from v_status then
      insert into order_status_history(workshop_id,work_order_id,from_status,to_status,source,changed_by)
      values(v_workshop,v_order,v_old_status,v_status,'dual_write',v_user);
    end if;
  end if;

  select id into v_service from work_order_services where work_order_id=v_order order by created_at limit 1;
  if nullif(btrim(p_order->>'requestedWork'),'') is not null then
    if v_service is null then insert into work_order_services(workshop_id,work_order_id,description) values(v_workshop,v_order,p_order->>'requestedWork') returning id into v_service;
    else update work_order_services set description=p_order->>'requestedWork' where id=v_service; end if;
  end if;
  select id into v_diag from diagnostic_reports where work_order_id=v_order order by created_at limit 1;
  if nullif(btrim(p_order->>'diagnosis'),'') is not null or nullif(btrim(p_order->>'dtc'),'') is not null then
    if v_diag is null then insert into diagnostic_reports(workshop_id,work_order_id,vehicle_id,mileage,summary,raw_dtc_text,created_by)
      values(v_workshop,v_order,v_vehicle,v_mileage,nullif(btrim(p_order->>'diagnosis'),''),nullif(btrim(p_order->>'dtc'),''),v_user) returning id into v_diag;
    else update diagnostic_reports set vehicle_id=v_vehicle,mileage=v_mileage,summary=nullif(btrim(p_order->>'diagnosis'),''),raw_dtc_text=nullif(btrim(p_order->>'dtc'),'') where id=v_diag; end if;
  end if;

  if exists(select 1 from time_entries where work_order_id=v_order and source='ui_state') then
    update time_entries set duration_seconds=v_seconds,started_at=v_timer,ended_at=case when v_timer is null then now() else null end,
      status=case when v_timer is null then 'stopped' else 'active' end,updated_at=now(),version=version+1
    where work_order_id=v_order and source='ui_state';
  else
    insert into time_entries(workshop_id,work_order_id,service_id,user_id,time_type,started_at,ended_at,duration_seconds,status,source)
    values(v_workshop,v_order,v_service,v_user,'repair',v_timer,case when v_timer is null then now() else null end,v_seconds,
      case when v_timer is null then 'stopped' else 'active' end,'ui_state');
  end if;

  select public.order_as_legacy_json(v_order) into v_result;
  update app_state set value=(select jsonb_agg(case when elem->>'id'=v_legacy_id then v_result else elem end order by ordinality)
    from jsonb_array_elements(value) with ordinality x(elem,ordinality)),updated_at=now(),updated_by=v_user
  where key='bildiagnos-orders' and exists(select 1 from jsonb_array_elements(value) e where e->>'id'=v_legacy_id);
  if not found then
    insert into app_state(key,value,updated_at,updated_by) values('bildiagnos-orders',jsonb_build_array(v_result),now(),v_user)
    on conflict(key) do update set value=app_state.value||jsonb_build_array(v_result),updated_at=now(),updated_by=v_user;
  end if;
  return v_result;
end $$;

revoke all on function public.map_order_status_es(text) from public,anon;
revoke all on function public.map_order_status_code(text) from public,anon;
revoke all on function public.order_as_legacy_json(uuid) from public,anon;
revoke all on function public.list_work_orders_legacy() from public,anon;
revoke all on function public.save_work_order_legacy(jsonb,integer) from public,anon;
grant execute on function public.map_order_status_es(text),public.map_order_status_code(text),public.order_as_legacy_json(uuid),public.list_work_orders_legacy(),public.save_work_order_legacy(jsonb,integer) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='work_orders') then
    alter publication supabase_realtime add table public.work_orders;
  end if;
end $$;
