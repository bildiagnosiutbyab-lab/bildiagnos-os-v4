CREATE OR REPLACE FUNCTION public.save_work_order_legacy(p_order jsonb, p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- Timer state is owned by control_order_timer; ordinary order edits must not rewrite it.
  if v_existing.id is null and (v_seconds > 0 or v_timer is not null) then
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
end $function$;

create or replace function public.control_order_timer(p_order_id uuid, p_action text)
returns jsonb
language plpgsql
set search_path to 'public'
as $timer$
declare
  v_user uuid := auth.uid();
  v_order public.work_orders%rowtype;
  v_entry public.time_entries%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_action not in ('start', 'pause', 'reset') then raise exception 'Invalid timer action'; end if;

  select * into v_order from public.work_orders where id = p_order_id for update;
  if v_order.id is null or not public.is_workshop_member(v_order.workshop_id) then
    raise exception 'Work order unavailable';
  end if;

  select * into v_entry from public.time_entries
    where work_order_id = p_order_id and source = 'ui_state' for update;

  if p_action = 'start' then
    if v_entry.id is null then
      insert into public.time_entries
        (workshop_id, work_order_id, user_id, time_type, started_at, ended_at, duration_seconds, status, source)
      values (v_order.workshop_id, p_order_id, v_user, 'repair', v_now, null, 0, 'active', 'ui_state');
    elsif v_entry.status <> 'active' or v_entry.started_at is null then
      update public.time_entries set started_at = v_now, ended_at = null,
        status = 'active', user_id = v_user, updated_at = v_now, version = version + 1
      where id = v_entry.id;
    end if;
  elsif p_action = 'pause' then
    if v_entry.id is not null and v_entry.status = 'active' then
      v_elapsed := case when v_entry.started_at is null then 0
        else greatest(0, floor(extract(epoch from v_now - v_entry.started_at))::integer) end;
      update public.time_entries set duration_seconds = duration_seconds + v_elapsed,
        ended_at = v_now, status = 'stopped', updated_at = v_now, version = version + 1
      where id = v_entry.id;
    end if;
  else
    if v_entry.id is not null then
      update public.time_entries set duration_seconds = 0, started_at = null,
        ended_at = v_now, status = 'stopped', updated_at = v_now, version = version + 1
      where id = v_entry.id;
    end if;
  end if;

  return public.order_as_legacy_json(p_order_id);
end
$timer$;

revoke all on function public.control_order_timer(uuid,text) from public, anon;
grant execute on function public.control_order_timer(uuid,text) to authenticated;

-- Close the known legacy ghost without removing its historical row.
update public.time_entries
set status = 'stopped', ended_at = started_at,
    correction_reason = 'Legacy timer did not close; duration remains unverified',
    updated_at = now(), version = version + 1
where source = 'legacy_running_timer' and status = 'active'
  and started_at < now() - interval '1 day';
