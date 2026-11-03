import { supabase } from './supabaseClient.js';

export async function loadRelationalOrders() {
  const { data, error } = await supabase.rpc('list_work_orders_legacy');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function saveRelationalOrder(order, expectedVersion = null) {
  if (expectedVersion !== null && expectedVersion !== undefined) {
    if (!order?.relationalId || String(order.id) !== String(order.relationalId)) {
      throw new Error('ORDER_EDIT_ID_MISMATCH: no se guardó para evitar una orden duplicada');
    }
  }
  const { data, error } = await supabase.rpc('save_work_order_legacy', {
    p_order: order,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
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
