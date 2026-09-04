export function formatKes(minor: number): string {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(minor / 100);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-KE').format(value);
}

export function formatKg(value: number): string {
  return `${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(value)} KG`;
}

export function formatTime(time: string | null): string {
  if (!time) return '—';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function localTimeStr(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function addDaysLocal(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(','));
  const csv = [headers.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
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

export function computeTotals(items: { quantity: number; unit_price_minor: number; tax_rate: number }[], discountMinor: number) {
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price_minor), 0);
  const tax = items.reduce((sum, item) => {
    const base = Math.round(item.quantity * item.unit_price_minor);
    return sum + Math.round(base * (item.tax_rate / 100));
  }, 0);
  const total = subtotal + tax - discountMinor;
  return { subtotal_minor: subtotal, discount_minor: discountMinor, tax_minor: tax, total_minor: Math.max(0, total) };
}
