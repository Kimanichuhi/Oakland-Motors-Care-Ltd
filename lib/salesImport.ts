import { parseCSV } from '@/lib/csv';
import { formatKes, localDayStart, localDateStr, displayToMinor } from '@/lib/formatting';

/** The paper "Spares Sales Day Book" this business keeps has a two-row merged
 * header (a "SPARES SALES" super-header spanning seven columns), which a normal
 * one-row-header CSV parser can't map by name — two different columns would both
 * resolve to the header key "". Column order is fixed instead:
 *   0 Date · 1 Change in days · 2 Customer Name · 3 Vehicle · 4 Vehicle model ·
 *   5 Part/spare No · 6 Description & part make · 7 Quantity sold · 8 PRICE ·
 *   9 Spares Total · 10 Labour/Service · 11 TOTAL · 12 Day Total ·
 *   13 Cash/M-Pesa/Banked · 14 Debt · 15 Jobcard No · 16 Remaining stock at
 *   shelves (manual count) · 17 System remaining stock (informational, computed
 *   by the paper book itself — used here only as a cross-check). */
export type DailySalesRawRow = {
  rowNumber: number;
  date: string;
  changeInDays: string;
  customerName: string;
  vehicle: string;
  vehicleModel: string;
  sku: string;
  description: string;
  quantity: string;
  price: string;
  sparesTotal: string;
  labour: string;
  total: string;
  dayTotal: string;
  cashMpesaBanked: string;
  debt: string;
  jobCardNo: string;
  shelfCount: string;
  systemStock: string;
};

export function parseDailySalesCSV(text: string): DailySalesRawRow[] {
  const table = parseCSV(text);
  return table.slice(2).map((cells, idx) => ({
    rowNumber: idx + 3, // two header rows
    date: (cells[0] ?? '').trim(),
    changeInDays: (cells[1] ?? '').trim(),
    customerName: (cells[2] ?? '').trim(),
    vehicle: (cells[3] ?? '').trim(),
    vehicleModel: (cells[4] ?? '').trim(),
    sku: (cells[5] ?? '').trim(),
    description: (cells[6] ?? '').trim(),
    quantity: (cells[7] ?? '').trim(),
    price: (cells[8] ?? '').trim(),
    sparesTotal: (cells[9] ?? '').trim(),
    labour: (cells[10] ?? '').trim(),
    total: (cells[11] ?? '').trim(),
    dayTotal: (cells[12] ?? '').trim(),
    cashMpesaBanked: (cells[13] ?? '').trim(),
    debt: (cells[14] ?? '').trim(),
    jobCardNo: (cells[15] ?? '').trim(),
    shelfCount: (cells[16] ?? '').trim(),
    systemStock: (cells[17] ?? '').trim(),
  }));
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseDayBookDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[1], 10);
  const year = parseInt(m[3], 10);
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isEmptyCell(raw: string): boolean {
  const t = raw.trim();
  return t === '' || /^[-–—]+$/.test(t);
}

function parseMoney(raw: string): number | null {
  if (isEmptyCell(raw)) return 0;
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? displayToMinor(n) : null;
}

export type ExistingPartForSale = {
  id: string; sku: string; name: string; category: string | null; selling_price_minor: number; quantity_on_hand: number; active: boolean;
};

export type SalesPlannedRow = {
  rowNumber: number;
  date: string;
  sku: string;
  action: 'SALE' | 'SKIP' | 'ERROR';
  errors: string[];
  warnings: string[];
  payload?: {
    p_customer_name: string; p_customer_phone: null; p_customer_type: string;
    p_payment_method: string; p_payment_status: string; p_sale_date: string;
    p_discount_minor: number; p_amount_paid_minor: number;
    p_items: { part_id: string; quantity: number; unit_price_minor: number; shelf_count: number | null }[];
    p_vehicle_reg: string | null; p_vehicle_model: string | null;
    p_change_in_days: number; p_labour_minor: number; p_notes: string | null; p_job_card_id: string | null;
  };
  summary: string[];
};

export function planSalesRows(rows: DailySalesRawRow[], parts: ExistingPartForSale[], jobCardIdByNumber: Map<string, string> = new Map()): SalesPlannedRow[] {
  const bySku = new Map(parts.map((p) => [p.sku.trim().toLowerCase(), p]));
  const stockBySku = new Map<string, number>();
  const planned: SalesPlannedRow[] = [];

  let dayAccumulated = 0;
  let dayStatedTotal: number | null = null;
  let dayHasItems = false;
  let currentDate: string | null = null;

  function flushDay() {
    if (currentDate === null || dayStatedTotal === null) return;
    const tolerance = Math.max(100, Math.round(Math.abs(dayStatedTotal) * 0.01));
    if (Math.abs(dayAccumulated - dayStatedTotal) > tolerance) {
      planned.push({
        rowNumber: -1, date: currentDate, sku: '', action: 'SKIP', errors: [], summary: ['Day-total check'],
        warnings: [dayHasItems
          ? `${currentDate}: Day Total is ${formatKes(dayStatedTotal)} in the file, but the sales on that date sum to ${formatKes(dayAccumulated)} — check for a missing, errored, or mistyped row.`
          : `${currentDate}: Day Total is ${formatKes(dayStatedTotal)} in the file, but no itemized sales are recorded for that date.`],
      });
    }
  }

  rows.forEach((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];

    const parsedDate = parseDayBookDate(row.date);
    const dateStr = parsedDate ? localDateStr(parsedDate) : row.date;
    if (dateStr !== currentDate) {
      flushDay();
      currentDate = dateStr;
      dayAccumulated = 0;
      dayStatedTotal = null;
      dayHasItems = false;
    }
    if (!isEmptyCell(row.dayTotal)) {
      const v = parseMoney(row.dayTotal);
      if (v !== null) dayStatedTotal = v;
    }

    if (isEmptyCell(row.sku)) {
      planned.push({ rowNumber: row.rowNumber, date: dateStr, sku: '', action: 'SKIP', errors, warnings, summary: ['No part on this row — ignored'] });
      return;
    }
    if (!parsedDate) errors.push(`Unrecognised date "${row.date}" — expected a format like "1 Aug 2026".`);

    const part = bySku.get(row.sku.trim().toLowerCase());
    if (!part) {
      errors.push(`Part "${row.sku}" was not found. Import it via the Parts bulk upload first.`);
      planned.push({ rowNumber: row.rowNumber, date: dateStr, sku: row.sku, action: 'ERROR', errors, warnings, summary });
      return;
    }
    if (!stockBySku.has(part.id)) stockBySku.set(part.id, part.quantity_on_hand);

    let quantity: number | null = null;
    if (isEmptyCell(row.quantity)) {
      errors.push('Missing Quantity sold.');
    } else {
      const n = parseFloat(row.quantity);
      if (!Number.isFinite(n) || n <= 0) errors.push(`Invalid Quantity sold "${row.quantity}".`);
      else if (!Number.isInteger(n)) errors.push(`Quantity sold "${row.quantity}" is fractional — this system tracks whole units only. Round it in the source file (up, or split into a separate note) and re-import.`);
      else quantity = n;
    }

    const priceMinor = parseMoney(row.price);
    if (priceMinor === null) errors.push(`Invalid PRICE "${row.price}".`);
    if (priceMinor === 0) warnings.push('PRICE is 0 for this row — requires price-override permission to import.');
    if (priceMinor !== null && priceMinor !== part.selling_price_minor) warnings.push(`This part's current selling price is ${formatKes(part.selling_price_minor)}; importing at the historical price of ${formatKes(priceMinor)} requires price-override permission.`);

    const labourMinor = parseMoney(row.labour) ?? 0;
    const totalMinor = parseMoney(row.total);
    if (quantity !== null && priceMinor !== null && totalMinor !== null) {
      const expected = quantity * priceMinor + labourMinor;
      const tolerance = Math.max(100, Math.round(Math.abs(totalMinor) * 0.01));
      if (Math.abs(expected - totalMinor) > tolerance) warnings.push(`TOTAL (${formatKes(totalMinor)}) doesn't match Quantity × PRICE + Labour (${formatKes(expected)}) — the computed value was used.`);
    }

    const debtMinor = parseMoney(row.debt) ?? 0;
    const spareTotal = quantity !== null && priceMinor !== null ? quantity * priceMinor : 0;
    const grandTotal = spareTotal + labourMinor;
    if (quantity !== null) dayAccumulated += grandTotal;
    dayHasItems = dayHasItems || quantity !== null;

    const currentStock = stockBySku.get(part.id) ?? part.quantity_on_hand;
    if (quantity !== null && quantity > currentStock) {
      errors.push(`Insufficient stock: only ${currentStock} of "${part.sku}" available at this point in the file (need ${quantity}).`);
    }

    if (errors.length > 0) {
      planned.push({ rowNumber: row.rowNumber, date: dateStr, sku: row.sku, action: 'ERROR', errors, warnings, summary });
      return;
    }

    const newStock = currentStock - (quantity as number);
    stockBySku.set(part.id, newStock);
    if (!isEmptyCell(row.systemStock)) {
      const stated = parseInt(row.systemStock.replace(/[^0-9-]/g, ''), 10);
      if (Number.isFinite(stated) && stated !== newStock) {
        warnings.push(`File says system stock should read ${stated} after this sale; based on the current database and this file's earlier rows it will actually be ${newStock}.`);
      }
    }

    const amountPaidMinor = Math.max(0, grandTotal - debtMinor);
    const paymentStatus = debtMinor <= 0 ? 'PAID' : amountPaidMinor <= 0 ? 'PENDING' : 'PARTIAL';
    const paymentMethod = debtMinor > 0 ? 'CREDIT' : 'CASH';

    summary.push(`Sell ${quantity} × ${part.name} (${part.sku}) @ ${formatKes(priceMinor as number)}${labourMinor > 0 ? ` + ${formatKes(labourMinor)} labour` : ''} = ${formatKes(grandTotal)}`);
    if (debtMinor > 0) summary.push(`${formatKes(debtMinor)} left on credit`);

    const shelfCount = isEmptyCell(row.shelfCount) ? null : parseInt(row.shelfCount.replace(/[^0-9]/g, ''), 10) || null;

    let jobCardId: string | null = null;
    if (!isEmptyCell(row.jobCardNo)) {
      jobCardId = jobCardIdByNumber.get(row.jobCardNo.trim().toLowerCase()) ?? null;
      if (!jobCardId) warnings.push(`Work order "${row.jobCardNo}" was not found — this sale was imported without a work order link.`);
    }

    planned.push({
      rowNumber: row.rowNumber, date: dateStr, sku: row.sku, action: 'SALE', errors, warnings, summary,
      payload: {
        p_customer_name: row.customerName || 'Walk-in customer',
        p_customer_phone: null,
        p_customer_type: 'WALK_IN',
        p_payment_method: paymentMethod,
        p_payment_status: paymentStatus,
        p_sale_date: localDayStart(parsedDate ?? new Date(dateStr)),
        p_discount_minor: 0,
        p_amount_paid_minor: amountPaidMinor,
        p_items: [{ part_id: part.id, quantity: quantity as number, unit_price_minor: priceMinor as number, shelf_count: shelfCount }],
        p_vehicle_reg: row.vehicle || null,
        p_vehicle_model: row.vehicleModel || null,
        p_change_in_days: isEmptyCell(row.changeInDays) ? 0 : parseInt(row.changeInDays, 10) || 0,
        p_labour_minor: labourMinor,
        p_notes: null,
        p_job_card_id: jobCardId,
      },
    });
  });
  flushDay();

  return planned;
}
