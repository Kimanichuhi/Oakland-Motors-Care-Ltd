import { describe, it, expect } from 'vitest';
import { computeLineTotal, computeTotals, minorToDisplay, displayToMinor, formatKes } from '@/lib/formatting';

describe('computeLineTotal', () => {
  it('applies quantity and tax rate to the unit price', () => {
    // 2 units @ 10,000 minor (KES 100.00) at 16% tax = 20,000 + 3,200 = 23,200
    expect(computeLineTotal(2, 10000, 16)).toBe(23200);
  });

  it('returns the base amount when tax rate is zero', () => {
    expect(computeLineTotal(3, 5000, 0)).toBe(15000);
  });

  it('rounds to the nearest minor unit', () => {
    // 1 unit @ 999 minor at 16% tax = 999 + round(159.84) = 999 + 160 = 1159
    expect(computeLineTotal(1, 999, 16)).toBe(1159);
  });
});

describe('computeTotals', () => {
  it('sums subtotal, tax, and applies discount to reach the total', () => {
    const items = [
      { quantity: 2, unit_price_minor: 10000, tax_rate: 16 },
      { quantity: 1, unit_price_minor: 5000, tax_rate: 16 },
    ];
    const totals = computeTotals(items, 1000);
    // subtotal = 20,000 + 5,000 = 25,000
    expect(totals.subtotal_minor).toBe(25000);
    // tax = round(20000*0.16) + round(5000*0.16) = 3200 + 800 = 4000
    expect(totals.tax_minor).toBe(4000);
    expect(totals.discount_minor).toBe(1000);
    // total = subtotal + tax - discount = 25000 + 4000 - 1000
    expect(totals.total_minor).toBe(28000);
  });

  it('never returns a negative total even if discount exceeds subtotal+tax', () => {
    const totals = computeTotals([{ quantity: 1, unit_price_minor: 1000, tax_rate: 0 }], 999999);
    expect(totals.total_minor).toBe(0);
  });

  it('returns zero totals for an empty item list', () => {
    const totals = computeTotals([], 0);
    expect(totals).toEqual({ subtotal_minor: 0, discount_minor: 0, tax_minor: 0, total_minor: 0 });
  });
});

describe('minor/display conversions round-trip', () => {
  it('converts minor units to display and back without drift', () => {
    expect(minorToDisplay(150000)).toBe(1500);
    expect(displayToMinor(1500)).toBe(150000);
  });

  it('rounds fractional display values to the nearest minor unit', () => {
    expect(displayToMinor(19.995)).toBe(2000);
  });
});

describe('formatKes', () => {
  it('formats minor units as a KES currency string', () => {
    const formatted = formatKes(150000);
    expect(formatted).toMatch(/1,?500/);
    expect(formatted).toMatch(/Ksh|KES/);
  });
});
