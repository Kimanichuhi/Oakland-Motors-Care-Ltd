import { execSync } from 'node:child_process';

export type LocalSupabaseEnv = { url: string; anonKey: string; serviceRoleKey: string };

let cached: LocalSupabaseEnv | null = null;

/**
 * Reads connection details for the local `supabase start` stack via the CLI itself,
 * rather than hardcoding keys, so these tests never depend on guessed credentials and
 * never touch the real project in .env.
 */
export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  if (cached) return cached;
  let raw: string;
  try {
    raw = execSync('npx supabase status -o json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(
      'Local Supabase stack is not running. Start it first with `npx supabase start` (requires Docker Desktop).\n' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
  const parsed = JSON.parse(raw) as Record<string, string>;
  if (!parsed.API_URL || !parsed.ANON_KEY || !parsed.SERVICE_ROLE_KEY) {
    throw new Error('Unexpected `supabase status -o json` output — missing API_URL/ANON_KEY/SERVICE_ROLE_KEY.');
  }
  cached = { url: parsed.API_URL, anonKey: parsed.ANON_KEY, serviceRoleKey: parsed.SERVICE_ROLE_KEY };
  return cached;
}
