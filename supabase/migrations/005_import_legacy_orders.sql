create or replace function public.parse_legacy_timestamp(raw_value text)
returns timestamptz language plpgsql immutable as $$
begin
  if raw_value is null or btrim(raw_value)='' then return null; end if;
  if raw_value ~ '^[0-9]{11,}$' then return to_timestamp(raw_value::numeric/1000.0); end if;
  return raw_value::timestamp at time zone 'Europe/Stockholm';
exception when others then return null;
end $$;
revoke all on function public.parse_legacy_timestamp(text) from public, anon, authenticated;

do $$
declare
  v_workshop uuid; v_owner uuid; v_run uuid; v_customer uuid; v_vehicle uuid; v_order uuid;
  v_diag uuid; v_service uuid; v_status text; v_created timestamptz; v_timer timestamptz;
  v_item jsonb; v_idx integer; v_plate text; v_plate_norm text; v_customer_name text;
  v_vehicle_text text; v_legacy_id text; v_mileage integer; v_seconds integer;
begin
  select id into v_workshop from public.workshops where name='Bildiagnos i Utby AB' order by created_at limit 1;
  select user_id into v_owner from public.workshop_members where workshop_id=v_workshop and role='owner' order by created_at limit 1;
  if v_workshop is null or v_owner is null then raise exception 'Workshop or owner account missing'; end if;

  insert into public.migration_runs(migration_name,source_key,source_checksum,expected_count,status)
  select '005_import_legacy_orders','bildiagnos-orders',md5(value::text),jsonb_array_length(value),'running'
  from public.app_state where key='bildiagnos-orders'
  on conflict(migration_name) do update set started_at=now(),status='running',details='{}'::jsonb
  returning id into v_run;

  for v_item,v_idx in
    select elem,ordinality::integer from public.app_state s,
      jsonb_array_elements(s.value) with ordinality x(elem,ordinality)
    where s.key='bildiagnos-orders' order by ordinality
  loop
    v_legacy_id := v_item->>'id';
    if exists(select 1 from public.work_orders where workshop_id=v_workshop and legacy_order_id=v_legacy_id) then
      select id into v_order from public.work_orders where workshop_id=v_workshop and legacy_order_id=v_legacy_id;
      insert into public.legacy_import_records(migration_run_id,source_key,source_index,legacy_order_id,raw_payload,payload_md5,work_order_id,status,imported_at)
      values(v_run,'bildiagnos-orders',v_idx,v_legacy_id,v_item,md5(v_item::text),v_order,'imported',now())
      on conflict(migration_run_id,source_index) do update set work_order_id=excluded.work_order_id,status='imported',imported_at=now();
      continue;
    end if;

    v_customer_name := coalesce(nullif(btrim(v_item->>'customer'),''),'Cliente sin nombre');
    v_plate := upper(coalesce(nullif(btrim(v_item->>'plate'),''),'SIN-MATRICULA-'||v_idx));
    v_plate_norm := upper(regexp_replace(v_plate,'[^A-Z0-9ÅÄÖ]','','g'));
    v_vehicle_text := nullif(btrim(v_item->>'vehicle'),'');
    v_created := coalesce(public.parse_legacy_timestamp(v_item->>'createdAt'),now());
    v_timer := public.parse_legacy_timestamp(v_item->>'timerStartedAt');
    v_seconds := case when coalesce(v_item->>'accumulatedSeconds','') ~ '^[0-9]+$' then (v_item->>'accumulatedSeconds')::integer else 0 end;
    v_mileage := case when regexp_replace(coalesce(v_item->>'mileage',''),'[^0-9]','','g') ~ '^[0-9]+$'
      and regexp_replace(coalesce(v_item->>'mileage',''),'[^0-9]','','g')<>''
      then regexp_replace(v_item->>'mileage','[^0-9]','','g')::integer else null end;
    v_status := case v_item->>'status'
      when 'Abierta' then 'open' when 'En diagnóstico' then 'diagnosis'
      when 'Esperando piezas' then 'waiting_parts' when 'En reparación' then 'repair'
      when 'Terminada' then 'completed' when 'Pagada' then 'paid'
      when 'Cancelada' then 'cancelled' when 'Garantía' then 'warranty' else 'open' end;

    select id into v_customer from public.customers
    where workshop_id=v_workshop and lower(btrim(display_name))=lower(v_customer_name)
    order by created_at limit 1;
    if v_customer is null then
      insert into public.customers(workshop_id,display_name,legacy_name,needs_review,created_at,updated_at,created_by,updated_by)
      values(v_workshop,v_customer_name,v_customer_name,v_customer_name='Cliente sin nombre',v_created,v_created,v_owner,v_owner)
      returning id into v_customer;
    end if;

    insert into public.vehicles(workshop_id,registration_plate,registration_plate_normalized,raw_description,created_at,updated_at,created_by,updated_by)
    values(v_workshop,v_plate,v_plate_norm,v_vehicle_text,v_created,v_created,v_owner,v_owner)
    on conflict(workshop_id,registration_plate_normalized) do update
      set raw_description=coalesce(public.vehicles.raw_description,excluded.raw_description)
    returning id into v_vehicle;

    insert into public.customer_vehicles(workshop_id,customer_id,vehicle_id,relationship_type,valid_from,is_primary)
    select v_workshop,v_customer,v_vehicle,'owner',v_created,true
    where not exists(select 1 from public.customer_vehicles where customer_id=v_customer and vehicle_id=v_vehicle and valid_to is null);

    insert into public.work_orders(
      workshop_id,legacy_order_id,customer_id,vehicle_id,status_code,mileage,mileage_raw,requested_work,
      customer_name_snapshot,plate_snapshot,vehicle_snapshot,opened_at,migration_source,needs_review,
      created_at,updated_at,created_by,updated_by)
    values(v_workshop,v_legacy_id,v_customer,v_vehicle,v_status,v_mileage,v_item->>'mileage',v_item->>'requestedWork',
      v_customer_name,v_plate,v_vehicle_text,v_created,'app_state/bildiagnos-orders',v_timer is not null,
      v_created,v_created,v_owner,v_owner) returning id into v_order;

    insert into public.order_status_history(workshop_id,work_order_id,to_status,source,changed_at,changed_by)
    values(v_workshop,v_order,v_status,'legacy_import',v_created,v_owner);

    if nullif(btrim(v_item->>'requestedWork'),'') is not null then
      insert into public.work_order_services(workshop_id,work_order_id,description,status,created_at)
      values(v_workshop,v_order,v_item->>'requestedWork','planned',v_created) returning id into v_service;
    end if;

    if nullif(btrim(v_item->>'diagnosis'),'') is not null or nullif(btrim(v_item->>'dtc'),'') is not null then
      insert into public.diagnostic_reports(workshop_id,work_order_id,vehicle_id,mileage,summary,raw_dtc_text,created_by,created_at)
      values(v_workshop,v_order,v_vehicle,v_mileage,nullif(btrim(v_item->>'diagnosis'),''),nullif(btrim(v_item->>'dtc'),''),v_owner,v_created)
      returning id into v_diag;
      if nullif(btrim(v_item->>'dtc'),'') is not null then
        insert into public.diagnostic_dtcs(workshop_id,diagnostic_report_id,dtc_code,raw_code,status)
        values(v_workshop,v_diag,upper(btrim(v_item->>'dtc')),v_item->>'dtc','legacy');
      end if;
    end if;

    if v_seconds>0 then
      insert into public.time_entries(workshop_id,work_order_id,service_id,user_id,time_type,duration_seconds,status,source,created_at,updated_at)
      values(v_workshop,v_order,v_service,v_owner,'repair',v_seconds,'stopped','legacy_accumulated',v_created,v_created);
    end if;
    if v_timer is not null then
      insert into public.time_entries(workshop_id,work_order_id,service_id,user_id,time_type,started_at,duration_seconds,status,source,created_at,updated_at)
      values(v_workshop,v_order,v_service,v_owner,'repair',v_timer,0,'active','legacy_running_timer',v_created,v_created);
    end if;

    insert into public.legacy_import_records(migration_run_id,source_key,source_index,legacy_order_id,raw_payload,payload_md5,customer_id,vehicle_id,work_order_id,status,imported_at)
    values(v_run,'bildiagnos-orders',v_idx,v_legacy_id,v_item,md5(v_item::text),v_customer,v_vehicle,v_order,'imported',now());
  end loop;

  update public.migration_runs set imported_count=(select count(*) from public.legacy_import_records where migration_run_id=v_run and status='imported'),
    status=case when (select count(*) from public.legacy_import_records where migration_run_id=v_run and status='imported')=expected_count then 'completed' else 'failed' end,
    completed_at=now() where id=v_run;
end $$;
