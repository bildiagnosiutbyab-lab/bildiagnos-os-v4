-- Follow-up: keep optional prices nullable and guard physical count against stale tabs.
create or replace function public.lager_create(p_data jsonb) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_create(p_data || jsonb_build_object(
    'sale_price',nullif(p_data->>'sale_price',''),
    'cost_price',nullif(p_data->>'cost_price',''),
    'minimum_quantity',nullif(p_data->>'minimum_quantity','')
  ))
$$;

create function private.lager_count(p_item uuid,p_counted numeric,p_reason text,p_expected_version integer) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_item public.inventory_items%rowtype;
begin
  if p_counted is null or p_counted<0 or p_counted<>round(p_counted,3) then raise exception 'Conteo inválido'; end if;
  select * into v_item from public.inventory_items where id=p_item for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  perform private.lager_authorize(v_item.workshop_id);
  if p_expected_version is distinct from v_item.version then
    raise exception 'Stock actualizado en otro dispositivo. Recarga antes de confirmar el conteo'; end if;
  if p_counted=v_item.quantity then return null; end if;
  return private.lager_move(p_item,p_counted-v_item.quantity,
    coalesce(nullif(btrim(p_reason),''),'Conteo físico'),null,null,'physical_count');
end $$;

create function public.lager_count(p_item uuid,p_counted numeric,p_reason text,p_expected_version integer) returns uuid
language sql security invoker set search_path = pg_catalog, public, private as $$
  select private.lager_count(p_item,p_counted,p_reason,p_expected_version)
$$;

revoke all on function private.lager_count(uuid,numeric,text),public.lager_count(uuid,numeric,text) from authenticated;
revoke all on function private.lager_count(uuid,numeric,text,integer),public.lager_count(uuid,numeric,text,integer) from public,anon;
grant execute on function private.lager_count(uuid,numeric,text,integer),public.lager_count(uuid,numeric,text,integer) to authenticated;
