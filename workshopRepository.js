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

export async function createCustomer(displayName) {
  const id = await workshopId();
  const { data, error } = await supabase.from('customers').insert({ workshop_id: id, display_name: displayName }).select().single();
  if (error) throw error; return data;
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
