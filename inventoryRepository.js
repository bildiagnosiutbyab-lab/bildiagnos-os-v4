import { supabase } from './supabaseClient.js';

function check(result) { if (result.error) throw result.error; return result.data; }

async function context() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw error || new Error('Sesión no disponible');
  const membership = check(await supabase.from('workshop_members').select('workshop_id').eq('user_id', user.id).single());
  return membership.workshop_id;
}

export async function listInventory() {
  const workshop = await context();
  const [stock, suppliers] = await Promise.all([
    supabase.from('inventory_items').select('id,quantity,minimum_quantity,average_cost,version,part_id,parts(id,description,lamp_type,brand,voltage,wattage,color,barcode,manufacturer_part_number,internal_number,sale_price),inventory_locations(name)').eq('workshop_id', workshop).order('id'),
    supabase.from('supplier_parts').select('part_id,supplier_part_number,cost_price,suppliers(name)').eq('workshop_id', workshop),
  ]);
  check(stock); check(suppliers);
  return (stock.data || []).map((item) => ({ ...item, supplier: (suppliers.data || []).find((s) => s.part_id === item.part_id) || null }));
}

export async function listMovements(itemId) {
  return check(await supabase.from('stock_movements')
    .select('id,quantity,movement_type,reason,occurred_at,plate_snapshot,work_order_id,created_by')
    .eq('inventory_item_id', itemId).order('occurred_at', { ascending: false }).limit(100));
}

export async function createInventoryItem(data) {
  return check(await supabase.rpc('lager_create', { p_data: data }));
}
export async function adjustInventory(itemId, delta, reason) {
  return check(await supabase.rpc('lager_adjust', { p_item: itemId, p_delta: delta, p_reason: reason }));
}
export async function countInventory(itemId, counted, reason, expectedVersion) {
  return check(await supabase.rpc('lager_count', { p_item: itemId, p_counted: counted, p_reason: reason, p_expected_version: expectedVersion }));
}
export async function useInventory(itemId, orderId, quantity) {
  return check(await supabase.rpc('lager_use', { p_item: itemId, p_order: orderId, p_quantity: quantity }));
}
