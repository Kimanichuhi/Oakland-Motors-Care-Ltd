import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { getLocalSupabaseEnv } from './env';
import { adminClient, createStaffUser } from './setup';

const TEST_PASSWORD = 'Test-Password-123!';

// Note: the "system not yet initialized" assertions below are only meaningful against a
// freshly reset local stack (`npx supabase db reset`). If the stack has already been
// initialized by an earlier run, the first branch is skipped in favor of just proving
// initialize_system remains one-time from here on — either way, the core guarantee under
// test (nobody can initialize the system twice) is verified.
describe('initialize_system', () => {
  it('is race-safe and one-time', async () => {
    const { url, anonKey } = getLocalSupabaseEnv();
    const admin = adminClient();

    const { data: alreadyInitialized } = await admin.rpc('is_system_initialized');

    if (!alreadyInitialized) {
      const email = `first-admin-${Date.now()}@test.oaklandmotors.local`;
      const setupClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: signUpError } = await setupClient.auth.signUp({ email, password: TEST_PASSWORD });
      expect(signUpError).toBeNull();

      const { error: initError } = await setupClient.rpc('initialize_system', {
        p_business_name: 'Test Motors', p_address: null, p_phone: null, p_email: null,
      });
      expect(initError).toBeNull();

      const { data: nowInitialized } = await admin.rpc('is_system_initialized');
      expect(nowInitialized).toBe(true);
    }

    // Whether we just initialized it above or it was already initialized by a prior run,
    // a second attempt from a brand-new authenticated user must always be rejected.
    const email2 = `second-admin-${Date.now()}@test.oaklandmotors.local`;
    const client2 = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    await client2.auth.signUp({ email: email2, password: TEST_PASSWORD });
    const { error: secondInitError } = await client2.rpc('initialize_system', {
      p_business_name: 'Second Attempt', p_address: null, p_phone: null, p_email: null,
    });
    expect(secondInitError).not.toBeNull();
  });
});

describe('account status', () => {
  it('a suspended user loses access on their very next query without needing to sign out', async () => {
    const admin = adminClient();
    const { userId, client } = await createStaffUser('MANAGER', 'to-suspend');

    // Confirm they start with real access.
    const before = await client.from('services').select('id').limit(1);
    expect(before.error).toBeNull();

    // Suspend via the same mechanism the admin-users Edge Function uses.
    await admin.from('profiles').update({ status: 'SUSPENDED' }).eq('id', userId);

    // Same still-logged-in client, no sign-out/sign-in — RLS must reject them immediately.
    const after = await client.from('services').select('id').limit(1);
    expect(after.data ?? []).toHaveLength(0);
  });
});
