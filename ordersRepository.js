import { supabase } from './supabaseClient.js';

export async function loadRelationalOrders() {
  const { data, error } = await supabase.rpc('list_work_orders_legacy');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function saveRelationalOrder(order, expectedVersion = null) {
  const { data, error } = await supabase.rpc('save_work_order_legacy', {
    p_order: order,
    p_expected_version: expectedVersion,
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
