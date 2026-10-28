import { supabase } from './supabaseClient.js';

async function workshopId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sesión no disponible');
  const { data, error } = await supabase.from('workshop_members').select('workshop_id').eq('user_id', user.id).single();
  if (error) throw error;
  return data.workshop_id;
}

async function list(table, orderBy) {
  const id = await workshopId();
  const { data, error } = await supabase.from(table).select('*').eq('workshop_id', id).order(orderBy);
  if (error) throw error;
  return data;
}
export const listCustomers = () => list('customers', 'display_name');
export const listVehicles = () => list('vehicles', 'registration_plate');
export const listParts = () => list('parts', 'description');

const customerFields = ['customer_type', 'display_name', 'personal_or_org_number', 'email', 'phone', 'address_line', 'postal_code', 'city'];

export async function saveCustomerDetails(details, customerId = null) {
  const workshop = await workshopId();
  const payload = Object.fromEntries(customerFields.map((key) => [key, (details[key] || '').trim() || null]));
  if (!payload.display_name) throw new Error('Ange kundens namn.');
  payload.customer_type = payload.customer_type || 'person';
  const query = customerId
    ? supabase.from('customers').update(payload).eq('workshop_id', workshop).eq('id', customerId)
    : supabase.from('customers').insert({ ...payload, workshop_id: workshop });
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function createCustomer(displayName) {
  return saveCustomerDetails({ display_name: displayName, customer_type: 'person' });
}
export async function createVehicle(plate, description) {
  const id = await workshopId();
  const normalized = plate.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, '');
  const { data, error } = await supabase.from('vehicles').insert({ workshop_id: id, registration_plate: plate.toUpperCase(), registration_plate_normalized: normalized, raw_description: description }).select().single();
  if (error) throw error; return data;
}
export async function createPart(description, internalNumber) {
  const id = await workshopId();
  const { data, error } = await supabase.from('parts').insert({ workshop_id: id, description, internal_number: internalNumber || null }).select().single();
  if (error) throw error; return data;
}
