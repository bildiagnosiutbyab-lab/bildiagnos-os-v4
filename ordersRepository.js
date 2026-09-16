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

export function subscribeToRelationalOrders(onChange) {
  const channel = supabase
    .channel('bildiagnos-relational-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
