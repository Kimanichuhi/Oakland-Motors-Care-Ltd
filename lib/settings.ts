'use client';

import { supabase } from '@/lib/supabase';

let cachedTaxRate: number | null = null;

/** business_settings.tax_rate, cached for the session. Was previously hardcoded to
 * 16 in half a dozen places, so changing the Settings > Tax rate field had no effect
 * anywhere in the app. */
export async function getTaxRate(): Promise<number> {
  if (cachedTaxRate !== null) return cachedTaxRate;
  const { data } = await supabase.from('business_settings').select('tax_rate').limit(1).maybeSingle();
  const rate = data?.tax_rate ?? 16;
  cachedTaxRate = rate;
  return rate;
}

export function clearTaxRateCache() { cachedTaxRate = null; }
