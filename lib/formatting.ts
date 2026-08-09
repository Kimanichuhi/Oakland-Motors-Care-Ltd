export function formatKes(minor: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(minor / 100);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-KE').format(value);
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(date: string | Date | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function minorToDisplay(minor: number): number {
  return minor / 100;
}

export function displayToMinor(display: number): number {
  return Math.round(display * 100);
}

export function computeLineTotal(quantity: number, unitPriceMinor: number, taxRate: number): number {
  const base = Math.round(quantity * unitPriceMinor);
  const tax = Math.round(base * (taxRate / 100));
  return base + tax;
}

export function computeTotals(items: { line_total_minor: number }[], discountMinor: number) {
  const subtotal = items.reduce((sum, item) => sum + item.line_total_minor, 0);
  const tax = items.reduce((sum, item) => {
    const base = item.line_total_minor;
    return sum + Math.round(base * 0);
  }, 0);
  const total = subtotal - discountMinor;
  return { subtotal_minor: subtotal, discount_minor: discountMinor, tax_minor: tax, total_minor: Math.max(0, total) };
}
