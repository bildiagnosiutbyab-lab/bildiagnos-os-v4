-- Supplier delivery notes / följesedlar. Applied to production on 2026-10-07 before this migration was committed.
create table if not exists public.supplier_delivery_notes (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  supplier_name text not null, document_number text, document_date date,
  currency text not null default 'SEK',
  subtotal_ex_vat numeric(12,2), vat_total numeric(12,2), total_inc_vat numeric(12,2),
  storage_bucket text, storage_path text, file_name text, mime_type text,
  raw_extraction jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed' check (status in ('draft','confirmed','void')),
  created_by uuid references auth.users(id), confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(), confirmed_at timestamptz
);
create table if not exists public.supplier_delivery_note_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete cascade,
  work_order_part_id uuid references public.work_order_parts(id) on delete set null,
  supplier_part_number text, description text not null,
  quantity numeric(12,3) not null default 1,
  list_unit_price_ex_vat numeric(12,2), discount_percent numeric(5,2),
  net_unit_cost_ex_vat numeric(12,2), line_net_ex_vat numeric(12,2), vat_rate numeric(5,2),
  match_status text not null default 'unmatched' check (match_status in ('matched','manual','unmatched')),
  created_at timestamptz not null default now()
);
create index if not exists supplier_delivery_notes_order_idx on public.supplier_delivery_notes(work_order_id,created_at desc);
create index if not exists supplier_delivery_note_lines_note_idx on public.supplier_delivery_note_lines(delivery_note_id);
create index if not exists supplier_delivery_note_lines_part_idx on public.supplier_delivery_note_lines(work_order_part_id);
alter table public.supplier_delivery_notes enable row level security;
alter table public.supplier_delivery_note_lines enable row level security;
drop policy if exists workshop_member_access on public.supplier_delivery_notes;
create policy workshop_member_access on public.supplier_delivery_notes for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
drop policy if exists workshop_member_access on public.supplier_delivery_note_lines;
create policy workshop_member_access on public.supplier_delivery_note_lines for all to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id));
grant select,insert,update,delete on public.supplier_delivery_notes to authenticated;
grant select,insert,update,delete on public.supplier_delivery_note_lines to authenticated;
drop trigger if exists audit_supplier_delivery_notes on public.supplier_delivery_notes;
create trigger audit_supplier_delivery_notes after insert or update or delete on public.supplier_delivery_notes for each row execute function public.audit_row_change();

create or replace function public.confirm_supplier_delivery_note(
 p_work_order_id uuid,p_supplier_name text,p_document_number text,p_document_date date,p_currency text,
 p_subtotal_ex_vat numeric,p_vat_total numeric,p_total_inc_vat numeric,p_storage_bucket text,p_storage_path text,
 p_file_name text,p_mime_type text,p_raw_extraction jsonb,p_lines jsonb
) returns uuid language plpgsql security invoker set search_path=public as $$
declare v_workshop_id uuid; v_note_id uuid; v_line jsonb; v_part_id uuid; v_qty numeric; v_list numeric; v_discount numeric; v_net numeric; v_line_net numeric;
begin
 select workshop_id into v_workshop_id from public.work_orders where id=p_work_order_id;
 if v_workshop_id is null then raise exception 'Orden no encontrada'; end if;
 if not public.is_workshop_member(v_workshop_id) then raise exception 'Sin acceso al taller'; end if;
 if coalesce(trim(p_supplier_name),'')='' then raise exception 'El proveedor es obligatorio'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'El följesedel no contiene líneas'; end if;
 insert into public.supplier_delivery_notes(workshop_id,work_order_id,supplier_name,document_number,document_date,currency,subtotal_ex_vat,vat_total,total_inc_vat,storage_bucket,storage_path,file_name,mime_type,raw_extraction,status,created_by,confirmed_by,confirmed_at)
 values(v_workshop_id,p_work_order_id,trim(p_supplier_name),nullif(trim(p_document_number),''),p_document_date,coalesce(nullif(trim(p_currency),''),'SEK'),p_subtotal_ex_vat,p_vat_total,p_total_inc_vat,p_storage_bucket,p_storage_path,p_file_name,p_mime_type,coalesce(p_raw_extraction,'{}'::jsonb),'confirmed',auth.uid(),auth.uid(),now()) returning id into v_note_id;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  v_part_id:=nullif(v_line->>'workOrderPartId','')::uuid; v_qty:=nullif(v_line->>'quantity','')::numeric; v_list:=nullif(v_line->>'listUnitPriceExVat','')::numeric; v_discount:=nullif(v_line->>'discountPercent','')::numeric; v_net:=nullif(v_line->>'netUnitCostExVat','')::numeric; v_line_net:=nullif(v_line->>'lineNetExVat','')::numeric;
  if v_qty is null or v_qty<=0 then raise exception 'Cantidad inválida en följesedel'; end if;
  if v_discount is not null and (v_discount<0 or v_discount>100) then raise exception 'Descuento inválido en följesedel'; end if;
  if v_net is not null and v_net<0 then raise exception 'Coste inválido en följesedel'; end if;
  if v_part_id is not null and not exists(select 1 from public.work_order_parts where id=v_part_id and work_order_id=p_work_order_id and workshop_id=v_workshop_id) then raise exception 'La pieza emparejada no pertenece a esta orden'; end if;
  insert into public.supplier_delivery_note_lines(workshop_id,delivery_note_id,work_order_part_id,supplier_part_number,description,quantity,list_unit_price_ex_vat,discount_percent,net_unit_cost_ex_vat,line_net_ex_vat,vat_rate,match_status)
  values(v_workshop_id,v_note_id,v_part_id,nullif(trim(v_line->>'supplierPartNumber'),''),coalesce(nullif(trim(v_line->>'description'),''),'Sin descripción'),v_qty,v_list,v_discount,v_net,v_line_net,nullif(v_line->>'vatRate','')::numeric,case when v_part_id is null then 'unmatched' when coalesce((v_line->>'manualMatch')::boolean,false) then 'manual' else 'matched' end);
  if v_part_id is not null then update public.work_order_parts set actual_cost=coalesce(v_net,actual_cost),discount_percent=coalesce(v_discount,discount_percent) where id=v_part_id; end if;
 end loop;
 return v_note_id;
end $$;
revoke all on function public.confirm_supplier_delivery_note(uuid,text,text,date,text,numeric,numeric,numeric,text,text,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_supplier_delivery_note(uuid,text,text,date,text,numeric,numeric,numeric,text,text,text,text,jsonb,jsonb) to authenticated;
