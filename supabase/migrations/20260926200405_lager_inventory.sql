-- Lager is additive; no existing article, order or stock row is changed here.
alter table public.parts add column if not exists lamp_type text;
alter table public.parts add column if not exists voltage text;
alter table public.parts add column if not exists wattage text;
alter table public.parts add column if not exists color text;
alter table public.parts add column if not exists manufacturer_part_number text;
alter table public.parts add column if not exists sale_price numeric(12,2);
alter table public.stock_movements add column if not exists inventory_item_id uuid references public.inventory_items(id);
alter table public.stock_movements add column if not exists work_order_part_id uuid;
alter table public.stock_movements add column if not exists reason text;
alter table public.stock_movements add column if not exists plate_snapshot text;
create index if not exists lager_parts_barcode_idx on public.parts(workshop_id,barcode);
create index if not exists lager_movements_item_date_idx on public.stock_movements(inventory_item_id,occurred_at desc);
create index if not exists lager_movements_order_line_idx on public.stock_movements(work_order_part_id);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.lager_authorize(p_workshop uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workshop_members
    where workshop_id=p_workshop and user_id=auth.uid() and role in ('owner','admin','technician')
  ) then raise exception 'Sin permiso para cambiar Lager' using errcode='42501'; end if;
end $$;

create or replace function private.lager_move(p_item uuid, p_delta numeric, p_reason text,
  p_order uuid default null, p_line uuid default null, p_type text default 'manual') returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_item public.inventory_items%rowtype; v_order public.work_orders%rowtype; v_id uuid;
begin
  if p_delta is null or p_delta=0 or p_delta<>round(p_delta,3) or p_reason is null or btrim(p_reason)='' then
    raise exception 'Cantidad o motivo inválido'; end if;
  select * into v_item from public.inventory_items where id=p_item for update;
  if not found then raise exception 'Artículo de inventario no encontrado'; end if;
  perform private.lager_authorize(v_item.workshop_id);
  if v_item.quantity+p_delta<0 then raise exception 'Stock insuficiente'; end if;
  if p_order is not null then
    select * into v_order from public.work_orders where id=p_order and workshop_id=v_item.workshop_id;
    if not found then raise exception 'La orden no pertenece al taller'; end if;
  end if;
  update public.inventory_items set quantity=quantity+p_delta,version=version+1 where id=p_item;
  insert into public.stock_movements(workshop_id,part_id,location_id,work_order_id,
    inventory_item_id,work_order_part_id,movement_type,quantity,reference,reason,plate_snapshot,created_by)
  values(v_item.workshop_id,v_item.part_id,v_item.location_id,p_order,p_item,p_line,p_type,p_delta,
    p_reason,p_reason,case when p_order is not null then v_order.plate_snapshot end,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function private.lager_create(p_data jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_wid uuid; v_part uuid; v_loc uuid; v_item uuid; v_supplier uuid; v_qty numeric;
begin
  select workshop_id into v_wid from public.workshop_members
    where user_id=auth.uid() and role in ('owner','admin','technician') order by created_at limit 1;
  if v_wid is null then raise exception 'Sin permiso para crear artículos'; end if;
  if nullif(btrim(p_data->>'description'),'') is null or nullif(btrim(p_data->>'location'),'') is null then
    raise exception 'Nombre y ubicación requeridos'; end if;
  v_qty := coalesce((p_data->>'quantity')::numeric,0);
  if v_qty<0 or v_qty<>round(v_qty,3) then raise exception 'Cantidad inválida'; end if;
  if nullif(btrim(p_data->>'barcode'),'') is not null and exists (
    select 1 from public.parts where workshop_id=v_wid and barcode=p_data->>'barcode'
  ) then raise exception 'EAN ya registrado; usa el artículo existente'; end if;
  insert into public.parts(workshop_id,description,lamp_type,brand,voltage,wattage,color,barcode,
    manufacturer_part_number,internal_number,sale_price)
  values(v_wid,btrim(p_data->>'description'),nullif(btrim(p_data->>'lamp_type'),''),
    nullif(btrim(p_data->>'brand'),''),nullif(btrim(p_data->>'voltage'),''),
    nullif(btrim(p_data->>'wattage'),''),nullif(btrim(p_data->>'color'),''),
    nullif(btrim(p_data->>'barcode'),''),nullif(btrim(p_data->>'manufacturer_part_number'),''),
    nullif(btrim(p_data->>'internal_number'),''),(p_data->>'sale_price')::numeric)
  returning id into v_part;
  insert into public.inventory_locations(workshop_id,name) values(v_wid,btrim(p_data->>'location'))
    on conflict(workshop_id,name) do update set name=excluded.name returning id into v_loc;
  insert into public.inventory_items(workshop_id,part_id,location_id,quantity,minimum_quantity,average_cost)
    values(v_wid,v_part,v_loc,0,coalesce((p_data->>'minimum_quantity')::numeric,0),(p_data->>'cost_price')::numeric)
    returning id into v_item;
  if nullif(btrim(p_data->>'supplier'),'') is not null then
    insert into public.suppliers(workshop_id,name) values(v_wid,btrim(p_data->>'supplier'))
      on conflict(workshop_id,name) do update set name=excluded.name returning id into v_supplier;
    insert into public.supplier_parts(workshop_id,supplier_id,part_id,supplier_part_number,cost_price)
      values(v_wid,v_supplier,v_part,nullif(btrim(p_data->>'supplier_part_number'),''),(p_data->>'cost_price')::numeric);
  end if;
  if v_qty>0 then perform private.lager_move(v_item,v_qty,'Inventario inicial',null,null,'initial'); end if;
  return v_item;
end $$;

create or replace function private.lager_use(p_item uuid,p_order uuid,p_quantity numeric) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_item public.inventory_items%rowtype; v_part public.parts%rowtype; v_line uuid; v_move uuid;
begin
  if p_quantity is null or p_quantity<=0 or p_quantity<>round(p_quantity,3) then raise exception 'Cantidad inválida'; end if;
  select * into v_item from public.inventory_items where id=p_item;
  if not found then raise exception 'Artículo no encontrado'; end if;
  perform private.lager_authorize(v_item.workshop_id);
  if not exists(select 1 from public.work_orders where id=p_order and workshop_id=v_item.workshop_id) then
    raise exception 'Orden no encontrada'; end if;
  select * into v_part from public.parts where id=v_item.part_id;
  insert into public.work_order_parts(workshop_id,work_order_id,part_id,part_number_snapshot,
    description_snapshot,quantity,actual_cost,sale_price,status)
  values(v_item.workshop_id,p_order,v_part.id,coalesce(v_part.manufacturer_part_number,v_part.internal_number),
    v_part.description,p_quantity,v_item.average_cost,v_part.sale_price,'quote') returning id into v_line;
  v_move := private.lager_move(p_item,-p_quantity,'Uso en orden',p_order,v_line,'order_use');
  update public.work_order_parts set stock_movement_id=v_move where id=v_line;
  return v_line;
end $$;

create or replace function private.lager_count(p_item uuid,p_counted numeric,p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_item public.inventory_items%rowtype;
begin
  if p_counted is null or p_counted<0 or p_counted<>round(p_counted,3) then raise exception 'Conteo inválido'; end if;
  select * into v_item from public.inventory_items where id=p_item for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  perform private.lager_authorize(v_item.workshop_id);
  if p_counted=v_item.quantity then return null; end if;
  return private.lager_move(p_item,p_counted-v_item.quantity,
    coalesce(nullif(btrim(p_reason),''),'Conteo físico'),null,null,'physical_count');
end $$;

-- Existing order-line removal and quantity edits recover/reconcile stock transactionally.
create or replace function private.lager_order_part_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_item uuid;
begin
  if old.stock_movement_id is null then return coalesce(new,old); end if;
  select inventory_item_id into v_item from public.stock_movements where id=old.stock_movement_id;
  if v_item is null then return coalesce(new,old); end if;
  if tg_op='UPDATE' then
    if new.work_order_id<>old.work_order_id or new.part_id is distinct from old.part_id
      or new.stock_movement_id is distinct from old.stock_movement_id then
      raise exception 'No se puede cambiar el vínculo de inventario'; end if;
    if old.status<>'removed' and new.status='removed' then
      perform private.lager_move(v_item,old.quantity,'Devolución por retirada de orden',old.work_order_id,old.id,'order_return');
    elsif old.status='removed' and new.status<>'removed' then
      raise exception 'La línea retirada no se puede reactivar';
    elsif old.status<>'removed' and new.quantity<>old.quantity then
      if new.quantity<=0 then raise exception 'Cantidad inválida'; end if;
      perform private.lager_move(v_item,old.quantity-new.quantity,'Corrección de cantidad en orden',old.work_order_id,old.id,'order_adjust');
    end if;
    return new;
  end if;
  if old.status<>'removed' then
    perform private.lager_move(v_item,old.quantity,'Devolución por eliminación de orden',old.work_order_id,old.id,'order_return');
  end if;
  return old;
end $$;
drop trigger if exists lager_order_part_change on public.work_order_parts;
create trigger lager_order_part_change before update or delete on public.work_order_parts
for each row execute function private.lager_order_part_change();

create or replace function public.lager_create(p_data jsonb) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_create(p_data)
$$;
create or replace function public.lager_adjust(p_item uuid,p_delta numeric,p_reason text) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_move(p_item,p_delta,p_reason)
$$;
create or replace function public.lager_count(p_item uuid,p_counted numeric,p_reason text) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_count(p_item,p_counted,p_reason)
$$;
create or replace function public.lager_use(p_item uuid,p_order uuid,p_quantity numeric) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_use(p_item,p_order,p_quantity)
$$;

-- Protect quantities and ledger from client-side overwrite; mutations use validated functions.
revoke insert,update,delete on public.inventory_items from authenticated;
revoke insert,update,delete on public.stock_movements from authenticated;
revoke all on function private.lager_authorize(uuid) from public,anon;
revoke all on function private.lager_move(uuid,numeric,text,uuid,uuid,text) from public,anon;
revoke all on function private.lager_create(jsonb) from public,anon;
revoke all on function private.lager_use(uuid,uuid,numeric) from public,anon;
revoke all on function private.lager_count(uuid,numeric,text) from public,anon;
revoke all on function private.lager_order_part_change() from public,anon,authenticated;
grant execute on function private.lager_move(uuid,numeric,text,uuid,uuid,text) to authenticated;
grant execute on function private.lager_create(jsonb) to authenticated;
grant execute on function private.lager_use(uuid,uuid,numeric) to authenticated;
grant execute on function private.lager_count(uuid,numeric,text) to authenticated;
revoke all on function public.lager_create(jsonb),public.lager_adjust(uuid,numeric,text),
  public.lager_count(uuid,numeric,text),public.lager_use(uuid,uuid,numeric) from public,anon;
grant execute on function public.lager_create(jsonb),public.lager_adjust(uuid,numeric,text),
  public.lager_count(uuid,numeric,text),public.lager_use(uuid,uuid,numeric) to authenticated;
