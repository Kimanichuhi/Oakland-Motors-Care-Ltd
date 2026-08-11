import { test, expect, type Locator } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getLocalSupabaseEnv } from '../integration/env';

/** Selects a native <select> option by matching visible text against a pattern, since
 * Playwright's selectOption({ label }) only accepts an exact string, not a RegExp, and
 * several option labels here embed dynamic, per-run values. */
async function selectByOptionText(select: Locator, pattern: RegExp) {
  const value = await select.locator('option').filter({ hasText: pattern }).first().getAttribute('value');
  if (!value) throw new Error(`No <option> matching ${pattern} found in select`);
  await select.selectOption(value);
}

/**
 * End-to-end coverage of the core garage workflow described in the spec's Part 3.8/18,
 * minus the offline/SMS/WhatsApp steps (those features don't exist yet — see Phase 1
 * implementation report). Requires:
 *   1. A freshly reset local Supabase stack: `npx supabase start` then `npx supabase db reset`
 *      (this test completes the setup wizard itself, so the stack must be uninitialized).
 *   2. The app running at the configured baseURL (`npm run dev` — playwright.config.ts
 *      starts this automatically unless E2E_SKIP_WEBSERVER is set).
 */

const PASSWORD = 'Test-Password-123!';
const RUN_ID = Date.now();
const ADMIN_EMAIL = `e2e-admin-${RUN_ID}@test.oaklandmotors.local`;
const CUSTOMER_NAME = `E2E Customer ${RUN_ID}`;
const REG_NUMBER = `KE2E${String(RUN_ID).slice(-4)}`;
const PART_SKU = `SKU-E2E-${RUN_ID}`;

test.describe.configure({ mode: 'serial' });

test('core workshop workflow: setup through payment and delivery', async ({ page }) => {
  const { url, serviceRoleKey } = getLocalSupabaseEnv();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: initialized } = await admin.rpc('is_system_initialized');
  if (initialized) {
    throw new Error('Local Supabase stack is already initialized. Run `npx supabase db reset` before this test.');
  }

  await test.step('complete the setup wizard as the first administrator', async () => {
    await page.goto('/');
    await page.getByPlaceholder('e.g. Brian Otieno').fill('E2E Admin');
    await page.getByPlaceholder('you@oaklandmotors.co.ke').fill(ADMIN_EMAIL);
    await page.getByPlaceholder('At least 8 characters').fill(PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to Oakland Motors' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete setup' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15000 });
  });

  let technicianUserId = '';
  let partId = '';
  await test.step('seed a technician and a stocked part (prerequisites not exposed via UI yet)', async () => {
    const { data: users } = await admin.auth.admin.listUsers();
    const adminUser = users.users.find((u) => u.email === ADMIN_EMAIL);
    if (!adminUser) throw new Error('Could not find the just-created admin user');
    technicianUserId = adminUser.id;
    await admin.from('employees').insert({ user_id: technicianUserId, full_name: 'E2E Technician', role: 'TECHNICIAN', active: true });

    const { data: part, error } = await admin
      .from('parts')
      .insert({ sku: PART_SKU, name: 'E2E Brake Pad', cost_price_minor: 50000, selling_price_minor: 90000, quantity_on_hand: 10, reorder_level: 2 })
      .select()
      .single();
    if (error || !part) throw new Error(`Failed to seed part: ${error?.message}`);
    partId = part.id;
  });

  await test.step('create a customer', async () => {
    await page.locator('.sidebar').getByText('Customers', { exact: true }).click();
    await page.getByRole('button', { name: 'Add customer' }).click();
    await page.getByPlaceholder('e.g. Brian Otieno').fill(CUSTOMER_NAME);
    await page.getByPlaceholder('0712 345 678').fill('0712345678');
    await page.getByRole('button', { name: 'Save customer' }).click();
    await expect(page.getByText('Customer added successfully.')).toBeVisible();
    await page.getByText(CUSTOMER_NAME).click();
  });

  await test.step('create a vehicle for the customer', async () => {
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    // VehicleForm doesn't inherit the customer from the detail page it was opened from —
    // it must be picked from the dropdown like any other field.
    await selectByOptionText(page.getByRole('combobox'), new RegExp(CUSTOMER_NAME));
    await page.getByPlaceholder('KDA 123A').fill(REG_NUMBER);
    await page.getByPlaceholder('Toyota').fill('Toyota');
    await page.getByPlaceholder('Hilux').fill('Hilux');
    await page.getByPlaceholder('2020').fill('2021');
    await page.getByRole('button', { name: 'Save vehicle' }).click();
    await expect(page.getByText('Vehicle added successfully.')).toBeVisible();
  });

  let jobNumberPrefix = '';
  await test.step('create a job card and record the customer complaint', async () => {
    await page.locator('.sidebar').getByText('Job Cards', { exact: true }).click();
    await page.getByRole('button', { name: 'New job card' }).click();
    await selectByOptionText(page.getByRole('combobox').first(), new RegExp(CUSTOMER_NAME));
    await selectByOptionText(page.getByRole('combobox').nth(1), new RegExp(REG_NUMBER));
    await page.getByPlaceholder('What does the customer need help with?').fill('Grinding noise from front brakes');
    await page.getByRole('button', { name: 'Create job card' }).click();
    await expect(page.getByText('Job card created successfully.')).toBeVisible();
    jobNumberPrefix = 'JC-';
    await page.getByText(new RegExp(`^${jobNumberPrefix}`)).first().click();
  });

  await test.step('receive the vehicle, assign a technician, and record diagnosis', async () => {
    await page.getByRole('button', { name: 'RECEIVED' }).click();
    await expect(page.getByText('Job moved to RECEIVED.')).toBeVisible();

    await page.getByRole('button', { name: /Assign/ }).click();
    await selectByOptionText(page.locator('.assign-row select'), /E2E Technician/);
    await expect(page.getByText('Technician assigned.')).toBeVisible();

    await page.getByPlaceholder('Diagnostic findings...').fill('Front brake pads worn below minimum thickness.');
    await page.getByRole('button', { name: 'Add diagnosis' }).click();
    await expect(page.getByText('Diagnosis added.')).toBeVisible();
  });

  await test.step('move the job to AWAITING_APPROVAL and create a quotation', async () => {
    await page.getByRole('button', { name: 'DIAGNOSIS' }).click();
    await expect(page.getByText('Job moved to DIAGNOSIS.')).toBeVisible();
    await page.getByRole('button', { name: 'AWAITING APPROVAL' }).click();
    await expect(page.getByText('Job moved to AWAITING APPROVAL.')).toBeVisible();

    await page.locator('.sidebar').getByText('Quotations', { exact: true }).click();
    await page.getByRole('button', { name: 'New quotation' }).click();
    await selectByOptionText(page.getByRole('combobox'), new RegExp(REG_NUMBER));
    await page.getByRole('button', { name: 'Create quotation' }).click();
    await expect(page.getByText('Quotation created from job card.')).toBeVisible();
  });

  await test.step('approve the quotation', async () => {
    await page.getByText(/^QUO-/).first().click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Quotation approved.')).toBeVisible();
  });

  await test.step('progress the job, issue a part, and verify stock decreased', async () => {
    await page.locator('.sidebar').getByText('Job Cards', { exact: true }).click();
    await page.getByText(new RegExp(`^${jobNumberPrefix}`)).first().click();
    await page.getByRole('button', { name: 'APPROVED' }).click();
    await page.getByRole('button', { name: 'IN PROGRESS' }).click();
    await expect(page.getByText('Job moved to IN PROGRESS.')).toBeVisible();

    const labourForm = page.locator('form.inline-form').nth(0);
    await labourForm.getByPlaceholder('Labour description').fill('Replace front brake pads');
    await labourForm.locator('input[type="number"]').fill('1500');
    await labourForm.locator('button[type="submit"]').click();
    await expect(page.getByText('Labour added.')).toBeVisible();

    const partForm = page.locator('form.inline-form').nth(1);
    await selectByOptionText(partForm.locator('select'), /E2E Brake Pad/);
    await partForm.locator('input[type="number"]').fill('2');
    await partForm.getByRole('button', { name: 'Issue' }).click();
    await expect(page.getByText('Part issued and stock updated.')).toBeVisible();

    const { data: part } = await admin.from('parts').select('quantity_on_hand').eq('id', partId).single();
    expect(part?.quantity_on_hand).toBe(8);
  });

  await test.step('send the job for quality check and generate an invoice', async () => {
    await page.getByRole('button', { name: 'QUALITY CHECK' }).click();
    await expect(page.getByText('Job moved to QUALITY CHECK.')).toBeVisible();

    await page.locator('.sidebar').getByText('Invoices', { exact: true }).click();
    await page.getByRole('button', { name: 'New invoice' }).click();
    await selectByOptionText(page.getByRole('combobox'), new RegExp(REG_NUMBER));
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page.getByText('Invoice created from job card.')).toBeVisible();
  });

  let invoiceId = '';
  let invoiceTotalMinor = 0;
  await test.step('record a payment and verify the balance clears to zero', async () => {
    const { data: invoice } = await admin
      .from('invoices')
      .select('id,total_minor')
      .eq('vehicle_id', (await admin.from('vehicles').select('id').eq('registration_number', REG_NUMBER).single()).data?.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (!invoice) throw new Error('Could not find the invoice just created via the UI');
    invoiceId = invoice.id;
    invoiceTotalMinor = invoice.total_minor;

    await page.getByText(/^INV-/).first().click();
    await expect(page.getByText('Balance')).toBeVisible();

    await page.getByRole('button', { name: 'Record payment' }).click();
    const paymentModal = page.locator('.modal');
    await selectByOptionText(paymentModal.getByRole('combobox'), /INV-/);
    await paymentModal.locator('input[type="number"]').fill((invoiceTotalMinor / 100).toFixed(2));
    await paymentModal.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded successfully.')).toBeVisible();

    const { data: settled } = await admin.from('invoices').select('status,amount_paid_minor').eq('id', invoiceId).single();
    expect(settled?.status).toBe('PAID');
    expect(settled?.amount_paid_minor).toBe(invoiceTotalMinor);
  });

  await test.step('pass the quality check and mark the vehicle ready and collected', async () => {
    await page.locator('.sidebar').getByText('Job Cards', { exact: true }).click();
    await page.getByText(new RegExp(`^${jobNumberPrefix}`)).first().click();

    // READY_FOR_COLLECTION is gated behind a passed quality check — drive the real form
    // rather than seeding it, to prove the gate and the UI both work end to end.
    const qcForm = page.locator('form.modal-form').filter({ has: page.getByRole('button', { name: 'Record quality check' }) });
    await qcForm.getByText('Vehicle ready for release').click();
    await qcForm.getByRole('combobox').selectOption('PASSED');
    await qcForm.getByRole('button', { name: 'Record quality check' }).click();
    await expect(page.getByText('Quality check recorded.')).toBeVisible();

    await page.getByRole('button', { name: 'READY FOR COLLECTION' }).click();
    await expect(page.getByText('Job moved to READY FOR COLLECTION.')).toBeVisible();
    await page.getByRole('button', { name: 'COLLECTED' }).click();
    await expect(page.getByText('Job moved to COLLECTED.')).toBeVisible();
  });

  await test.step('verify vehicle service history and audit trail', async () => {
    await page.locator('.sidebar').getByText('Vehicles', { exact: true }).click();
    await page.getByText(REG_NUMBER).first().click();
    await expect(page.getByText(new RegExp(`^${jobNumberPrefix}`))).toBeVisible();

    await page.locator('.sidebar').getByText('Audit Logs', { exact: true }).click();
    await expect(page.getByText(/JOB STATUS CHANGE|RECORD PAYMENT/).first()).toBeVisible();
  });
});
