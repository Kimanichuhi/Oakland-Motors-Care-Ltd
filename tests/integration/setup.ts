import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getLocalSupabaseEnv } from './env';

const TEST_PASSWORD = 'Test-Password-123!';

export function adminClient(): SupabaseClient {
  const { url, serviceRoleKey } = getLocalSupabaseEnv();
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export type RoleName = 'ADMIN' | 'MANAGER' | 'SERVICE_ADVISOR' | 'TECHNICIAN' | 'STOREKEEPER' | 'ACCOUNTANT' | 'OWNER_READONLY';

/** Creates a fresh, ACTIVE, single-role staff user and returns a signed-in client for them. */
export async function createStaffUser(roleName: RoleName, label: string): Promise<{ userId: string; client: SupabaseClient }> {
  const { url, anonKey } = getLocalSupabaseEnv();
  const admin = adminClient();
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.oaklandmotors.local`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (createError || !created.user) throw new Error(`Failed to create test user for ${roleName}: ${createError?.message}`);
  const userId = created.user.id;

  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('name', roleName).single();
  if (roleError || !role) throw new Error(`Role ${roleName} not found: ${roleError?.message}`);

  const { error: profileError } = await admin.from('profiles').update({ status: 'ACTIVE' }).eq('id', userId);
  if (profileError) throw new Error(`Failed to activate test profile: ${profileError.message}`);

  const { error: assignError } = await admin.from('user_roles').insert({ user_id: userId, role_id: role.id });
  if (assignError) throw new Error(`Failed to assign role ${roleName}: ${assignError.message}`);

  const userClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signInError) throw new Error(`Failed to sign in test user for ${roleName}: ${signInError.message}`);

  return { userId, client: userClient };
}

/** Seeds a customer + vehicle (via the service-role client) for tests that need a job card. */
export async function seedCustomerAndVehicle(admin: SupabaseClient) {
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .insert({ full_name: 'Test Customer', phone: `07${Math.floor(10000000 + Math.random() * 89999999)}` })
    .select()
    .single();
  if (customerError || !customer) throw new Error(`Failed to seed customer: ${customerError?.message}`);

  const { data: vehicle, error: vehicleError } = await admin
    .from('vehicles')
    .insert({ customer_id: customer.id, registration_number: `KTEST${Math.floor(Math.random() * 9999)}`, make: 'Toyota', model: 'Hilux', mileage: 1000 })
    .select()
    .single();
  if (vehicleError || !vehicle) throw new Error(`Failed to seed vehicle: ${vehicleError?.message}`);

  return { customer, vehicle };
}

export async function seedJobCard(admin: SupabaseClient, customerId: string, vehicleId: string) {
  const jobNumber = `JC-TEST-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const { data: job, error } = await admin
    .from('job_cards')
    .insert({ job_number: jobNumber, customer_id: customerId, vehicle_id: vehicleId, complaint: 'Test complaint', mileage: 1000 })
    .select()
    .single();
  if (error || !job) throw new Error(`Failed to seed job card: ${error?.message}`);
  return job;
}

export async function seedPart(admin: SupabaseClient, quantityOnHand: number) {
  const sku = `SKU-TEST-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const { data: part, error } = await admin
    .from('parts')
    .insert({ sku, name: 'Test Brake Pad', cost_price_minor: 50000, selling_price_minor: 80000, quantity_on_hand: quantityOnHand, reorder_level: 2 })
    .select()
    .single();
  if (error || !part) throw new Error(`Failed to seed part: ${error?.message}`);
  return part;
}

export async function seedInvoice(admin: SupabaseClient, customerId: string, totalMinor: number) {
  const invoiceNumber = `INV-TEST-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const { data: invoice, error } = await admin
    .from('invoices')
    .insert({ invoice_number: invoiceNumber, customer_id: customerId, subtotal_minor: totalMinor, total_minor: totalMinor, status: 'ISSUED' })
    .select()
    .single();
  if (error || !invoice) throw new Error(`Failed to seed invoice: ${error?.message}`);
  return invoice;
}
