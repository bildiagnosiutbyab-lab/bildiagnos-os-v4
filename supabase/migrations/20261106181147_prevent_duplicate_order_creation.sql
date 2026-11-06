-- One create operation per form identity, including concurrent/retried requests.
-- Existing edit/version checks remain owned by save_work_order_legacy.
create or replace function public.create_work_order_once(p_order jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workshop uuid;
  v_request_id text := nullif(btrim(p_order->>'id'), '');
  v_existing public.work_orders%rowtype;
  v_plate text := upper(regexp_replace(coalesce(p_order->>'plate', ''), '[^A-Za-z0-9ÅÄÖåäö]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'ORDER_CREATE_NOT_AUTHENTICATED';
  end if;
  select workshop_id into v_workshop from public.workshop_members
    where user_id = auth.uid() order by created_at limit 1;
  if v_workshop is null then
    raise exception 'No workshop membership';
  end if;
  if v_request_id is null or length(v_request_id) > 128
    or nullif(p_order->>'relationalId', '') is not null
    or nullif(p_order->>'orderNumber', '') is not null
    or v_plate = '' or nullif(btrim(p_order->>'customer'), '') is null then
    raise exception 'ORDER_CREATE_INVALID_REQUEST';
  end if;

  -- The lock is scoped to this workshop and draft, never to the vehicle.
  -- It is released automatically when the RPC transaction ends.
  perform pg_advisory_xact_lock(hashtextextended(
    'create_work_order_once:' || v_workshop::text || ':' || v_request_id, 0));
  select * into v_existing from public.work_orders
    where workshop_id = v_workshop and legacy_order_id = v_request_id for update;
  if found then
    if upper(regexp_replace(v_existing.plate_snapshot, '[^A-Za-z0-9ÅÄÖåäö]', '', 'g')) <> v_plate then
      raise exception 'ORDER_CREATE_REQUEST_MISMATCH';
    end if;
    -- A response lost in transit must not replay an UPDATE, reset status,
    -- overwrite later edits, add service lines or consume another number.
    return public.order_as_legacy_json(v_existing.id);
  end if;
  return public.save_work_order_legacy(p_order, null);
end;
$$;

revoke execute on function public.create_work_order_once(jsonb) from public, anon;
grant execute on function public.create_work_order_once(jsonb) to authenticated;
