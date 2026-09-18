create table if not exists public.catalog_imports (
  id uuid primary key default gen_random_uuid(), workshop_id uuid not null references public.workshops(id),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  source text not null check (source in ('AD Bildelar', 'BilXtra')), payload_hash text not null,
  plate_snapshot text, imported_at timestamptz not null default now(), imported_by uuid references auth.users(id),
  payload_summary jsonb not null default '{}'::jsonb, unique (work_order_id, source, payload_hash)
);
alter table public.catalog_imports enable row level security;
drop policy if exists workshop_member_access on public.catalog_imports;
create policy workshop_member_access on public.catalog_imports for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop trigger if exists audit_catalog_imports on public.catalog_imports;
create trigger audit_catalog_imports after insert or update or delete on public.catalog_imports for each row execute function public.audit_row_change();

create or replace function public.import_catalog_order_items(p_work_order_id uuid, p_source text, p_plate text, p_parts jsonb default '[]'::jsonb, p_labor_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_order public.work_orders%rowtype; v_source text := btrim(coalesce(p_source, '')); v_order_plate text; v_import_plate text; v_payload_hash text; v_supplier_id uuid; v_part jsonb; v_labor jsonb; v_quantity numeric; v_cost numeric; v_price numeric; v_discount numeric; v_hours numeric; v_rate numeric; v_sort_order integer; v_parts_imported integer := 0; v_services_imported integer := 0;
begin
  if v_source not in ('AD Bildelar', 'BilXtra') then raise exception 'Catálogo no permitido: %', v_source; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_typeof(p_labor_items) <> 'array' then raise exception 'Las piezas y los trabajos deben ser listas.'; end if;
  select * into v_order from public.work_orders where id = p_work_order_id;
  if not found then raise exception 'No se encontró la orden.'; end if;
  v_order_plate := upper(regexp_replace(coalesce(v_order.plate_snapshot, ''), '[[:space:]]', '', 'g')); v_import_plate := upper(regexp_replace(coalesce(p_plate, ''), '[[:space:]]', '', 'g'));
  if v_import_plate <> '' and v_order_plate <> '' and v_import_plate <> v_order_plate then raise exception 'La matrícula de la importación no coincide con la orden.'; end if;
  v_payload_hash := md5(concat_ws('|', v_source, v_import_plate, p_parts::text, p_labor_items::text));
  if exists (select 1 from public.catalog_imports where work_order_id = v_order.id and source = v_source and payload_hash = v_payload_hash) then raise exception 'Esta misma importación ya fue confirmada en la orden.'; end if;
  insert into public.suppliers (workshop_id, name, source_type, active) values (v_order.workshop_id, v_source, 'catalog', true) on conflict (workshop_id, name) do update set active = true returning id into v_supplier_id;
  for v_part in select value from jsonb_array_elements(p_parts) loop
    if btrim(coalesce(v_part->>'description', '')) = '' then raise exception 'Cada pieza necesita una descripción.'; end if;
    v_quantity := nullif(v_part->>'quantity', '')::numeric; if v_quantity is null or v_quantity <= 0 then raise exception 'Cada pieza necesita una cantidad mayor que cero.'; end if;
    v_cost := nullif(v_part->>'cost', '')::numeric; v_price := nullif(v_part->>'price', '')::numeric; v_discount := nullif(v_part->>'discount', '')::numeric;
    insert into public.work_order_parts (workshop_id,work_order_id,supplier_id,part_number_snapshot,description_snapshot,quantity,actual_cost,sale_price,discount_percent,vat_rate,status) values (v_order.workshop_id,v_order.id,v_supplier_id,nullif(btrim(coalesce(v_part->>'articleNumber', '')), ''),btrim(v_part->>'description'),v_quantity,v_cost,v_price,v_discount,0.25,'quote'); v_parts_imported := v_parts_imported + 1;
  end loop;
  select coalesce(max(sort_order), -1) + 1 into v_sort_order from public.work_order_services where work_order_id = v_order.id;
  for v_labor in select value from jsonb_array_elements(p_labor_items) loop
    if btrim(coalesce(v_labor->>'description', '')) = '' then raise exception 'Cada trabajo necesita una descripción.'; end if;
    v_hours := nullif(v_labor->>'hours', '')::numeric; if v_hours is null or v_hours < 0 then raise exception 'Cada trabajo necesita horas estimadas válidas.'; end if;
    v_rate := nullif(v_labor->>'hourlyRate', '')::numeric;
    insert into public.work_order_services (workshop_id,work_order_id,description,quantity,estimated_minutes,unit_price,vat_rate,status,sort_order) values (v_order.workshop_id,v_order.id,concat_ws(' · ',nullif(btrim(coalesce(v_labor->>'code', '')), ''),btrim(v_labor->>'description')),1,round(v_hours * 60)::integer,v_rate,0.25,'quote',v_sort_order); v_sort_order := v_sort_order + 1; v_services_imported := v_services_imported + 1;
  end loop;
  insert into public.catalog_imports (workshop_id,work_order_id,source,payload_hash,plate_snapshot,imported_by,payload_summary) values (v_order.workshop_id,v_order.id,v_source,v_payload_hash,nullif(p_plate, ''),auth.uid(),jsonb_build_object('parts',v_parts_imported,'services',v_services_imported));
  return jsonb_build_object('parts_imported',v_parts_imported,'services_imported',v_services_imported);
end;
$$;
revoke execute on function public.import_catalog_order_items(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_catalog_order_items(uuid, text, text, jsonb, jsonb) to authenticated;
