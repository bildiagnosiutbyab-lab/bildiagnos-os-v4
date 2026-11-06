import { supabase } from './supabaseClient.js';

export async function loadRelationalOrders() {
  const { data, error } = await supabase.rpc('list_work_orders_legacy');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function saveRelationalOrder(order, expectedVersion = null) {
  let payload = order;
  const editing = expectedVersion !== null && expectedVersion !== undefined;
  if (editing) {
    if (!order?.relationalId || !order?.orderNumber || !Number.isInteger(Number(expectedVersion))) {
      throw new Error('ORDER_EDIT_ID_MISMATCH: no se guardó para evitar una orden duplicada');
    }
    const { data: existing, error: lookupError } = await supabase
      .from('work_orders')
      .select('id, legacy_order_id, order_number, version')
      .eq('id', order.relationalId)
      .single();
    if (lookupError) throw lookupError;
    if (!existing || Number(existing.order_number) !== Number(order.orderNumber)) {
      throw new Error('ORDER_EDIT_ID_MISMATCH: la orden no coincide');
    }
    if (Number(existing.version) !== Number(expectedVersion)) {
      throw new Error('ORDER_VERSION_CONFLICT');
    }
    // The legacy RPC resolves edits by legacy_order_id, not by relationalId.
    // Never allow an edit to fall through to its INSERT path.
    if (!existing.legacy_order_id) {
      throw new Error('ORDER_EDIT_MISSING_LEGACY_ID: edición bloqueada para evitar duplicados');
    }
    payload = { ...order, id: existing.legacy_order_id };
  }
  if (!editing && (!order?.id || order.relationalId || order.orderNumber)) {
    throw new Error('ORDER_CREATE_ID_MISMATCH: recarga el formulario antes de crear la orden');
  }
  // Create retries return the original record; only versioned edits may update it.
  const { data, error } = await supabase.rpc(
    editing ? 'save_work_order_legacy' : 'create_work_order_once',
    editing ? { p_order: payload, p_expected_version: expectedVersion } : { p_order: payload }
  );
  if (error) throw error;
  if (editing && (String(data?.relationalId) !== String(order.relationalId) ||
      Number(data?.orderNumber) !== Number(order.orderNumber))) {
    throw new Error('ORDER_EDIT_RESULT_MISMATCH: recarga las órdenes');
  }
  return data;
}

export async function deleteRelationalOrder(order) {
  if (!order.relationalId) throw new Error('La orden aún no está guardada en Supabase');
  const { data, error } = await supabase.rpc('delete_work_order_legacy', {
    p_order_id: order.relationalId,
    p_expected_version: order.version,
  });
  if (error) throw error;
  return data;
}

export async function controlOrderTimer(order, action) {
  if (!order.relationalId) throw new Error('La orden aún no está guardada en Supabase');
  const { data, error } = await supabase.rpc('control_order_timer', {
    p_order_id: order.relationalId,
    p_action: action,
  });
  if (error) throw error;
  return data;
}

export function subscribeToRelationalOrders(onChange) {
  const channel = supabase
    .channel('bildiagnos-relational-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
