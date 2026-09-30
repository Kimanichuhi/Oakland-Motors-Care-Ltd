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
 *   by the paper book itself — used here only as a cross-check) · 18 M-Pesa code. */
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
  mpesaCode: string;
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
    mpesaCode: (cells[18] ?? '').trim(),
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

/** Stock and sale quantities are stored to 4 decimal places (numeric(12,4)),
 * so plan with the same precision the database will actually hold. */
export function roundQuantity(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function formatQuantity(n: number): string {
  return String(roundQuantity(n));
}

type StatedMethod = 'CASH' | 'MPESA' | 'BANK';

/** Reads the CASH/MPESA/BANKED cell. The day book usually writes the amount
 * received there rather than the method — a number says nothing about how it
 * was paid, so it's treated the same as blank. */
function parseStatedMethod(raw: string): StatedMethod | null | 'UNKNOWN' {
  if (isEmptyCell(raw) || /^[\d,.\s]+$/.test(raw.trim())) return null;
  const t = raw.toLowerCase().replace(/[\s._-]/g, '');
  if (t.includes('mpesa')) return 'MPESA';
  if (t.includes('bank')) return 'BANK';
  if (t.includes('cash')) return 'CASH';
  return 'UNKNOWN';
}

export function normaliseMpesaCode(raw: string): string {
  return isEmptyCell(raw) ? '' : raw.replace(/\s+/g, '').toUpperCase();
}

/** One cell can hold several payment codes when a customer paid in more than
 * one transaction ("UIAGA680B; UIAGA68W7L"). */
export function splitPaymentCodes(raw: string): string[] {
  if (isEmptyCell(raw)) return [];
  return raw.split(/[;,/\s]+/).map(normaliseMpesaCode).filter(Boolean);
}

/** Bank transfer references (e.g. Equity's "FT26262VFPHS") start with FT;
 * M-Pesa transaction codes are 10 letters/digits. */
function isBankReference(code: string): boolean {
  return /^FT[A-Z0-9]{8,}$/.test(code);
}

const WALK_IN_JOB_CARD_VALUES = new Set(['walkin', 'walkincustomer', 'none', 'na', 'n/a']);

/** "JB-53", "jb053" and "JB-053" all mean the same work order. Returns null for
 * blank cells and for "Walk in", which the day book writes for counter sales. */
export function normaliseJobCardNumber(raw: string): string | null {
  if (isEmptyCell(raw)) return null;
  const t = raw.trim().toLowerCase();
  if (WALK_IN_JOB_CARD_VALUES.has(t.replace(/[\s-]/g, ''))) return null;
  const m = t.match(/^jb\s*-?\s*0*(\d+)$/);
  return m ? `jb-${m[1].padStart(3, '0')}` : t;
}

/** How a day-book part name is matched to a part: case and spacing don't
 * count, so "20W-50 Engine Oil (4 Ltr)" finds "20W-50 Engine Oil  (4 Ltr)". */
export function skuKey(sku: string): string {
  return sku.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type ExistingPartForSale = {
  id: string; sku: string; name: string; category: string | null; selling_price_minor: number; quantity_on_hand: number; active: boolean;
};

export type JobCardRef = { id: string; customerName: string | null };

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
    p_payment_reference: string | null; p_payment_reference_at: string | null;
    p_vehicle_reg: string | null; p_vehicle_model: string | null;
    p_change_in_days: number; p_labour_minor: number; p_notes: string | null; p_job_card_id: string | null;
  };
  summary: string[];
};

/** Payments in the day book are recorded per day (or per M-Pesa transaction),
 * not per part: CASH/MPESA/BANKED and DEBT hold the amounts received and owed,
 * usually on the day's last row, and often include work-order labour. So every
 * part row is recorded as paid — through the work order when it has a JB
 * number, otherwise at the counter — and the day's money figures are reported
 * as a day-level note instead of being pinned on whichever part shares the row. */
export function planSalesRows(
  rows: DailySalesRawRow[],
  parts: ExistingPartForSale[],
  jobCardsByNumber: Map<string, JobCardRef> = new Map(),
  existingPaymentCodes: Set<string> = new Set(),
): SalesPlannedRow[] {
  const bySku = new Map(parts.map((p) => [skuKey(p.sku), p]));
  const stockBySku = new Map<string, number>();
  const codeFirstSeen = new Map<string, { rowNumber: number; date: string }>();
  const planned: SalesPlannedRow[] = [];

  let dayAccumulated = 0;
  let dayStatedTotal: number | null = null;
  let dayReceived = 0;
  let dayDebt = 0;
  let dayHasItems = false;
  let currentDate: string | null = null;

  function flushDay() {
    if (currentDate === null) return;
    if (dayStatedTotal !== null) {
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
    if (dayDebt > 0) {
      planned.push({
        rowNumber: -1, date: currentDate, sku: '', action: 'SKIP', errors: [], summary: ['Day debt'],
        warnings: [`${currentDate}: the book records ${formatKes(dayDebt)} owed${dayReceived > 0 ? ` (and ${formatKes(dayReceived)} received)` : ''} for this day. Debt isn't attached to individual part sales — record it against the work order or in the Debt Register.`],
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
      dayReceived = 0;
      dayDebt = 0;
      dayHasItems = false;
    }
    if (!isEmptyCell(row.dayTotal)) {
      const v = parseMoney(row.dayTotal);
      if (v !== null) dayStatedTotal = v;
    }
    if (parseStatedMethod(row.cashMpesaBanked) === null) dayReceived += parseMoney(row.cashMpesaBanked) ?? 0;
    dayDebt += parseMoney(row.debt) ?? 0;

    if (isEmptyCell(row.sku)) {
      planned.push({ rowNumber: row.rowNumber, date: dateStr, sku: '', action: 'SKIP', errors, warnings, summary: ['No part on this row — ignored'] });
      return;
    }
    if (!parsedDate) errors.push(`Unrecognised date "${row.date}" — expected a format like "1 Aug 2026".`);

    const part = bySku.get(skuKey(row.sku));
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
      const n = parseFloat(row.quantity.replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) errors.push(`Invalid Quantity sold "${row.quantity}".`);
      else {
        quantity = roundQuantity(n);
        if (quantity !== n) warnings.push(`Quantity sold ${row.quantity} is stored as ${formatQuantity(quantity)} (4 decimal places).`);
      }
    }

    const priceMinor = parseMoney(row.price);
    if (priceMinor === null) errors.push(`Invalid PRICE "${row.price}".`);
    if (priceMinor === 0) warnings.push('PRICE is 0 for this row — requires price-override permission to import.');
    if (priceMinor !== null && priceMinor !== part.selling_price_minor) warnings.push(`This part's current selling price is ${formatKes(part.selling_price_minor)}; importing at the historical price of ${formatKes(priceMinor)} requires price-override permission.`);

    const labourMinor = parseMoney(row.labour) ?? 0;
    // Mirrors complete_sale, which rounds each line to whole cents.
    const spareTotal = quantity !== null && priceMinor !== null ? Math.round(quantity * priceMinor) : 0;
    const grandTotal = spareTotal + labourMinor;
    const totalMinor = parseMoney(row.total);
    if (quantity !== null && priceMinor !== null && totalMinor !== null) {
      const tolerance = Math.max(100, Math.round(Math.abs(totalMinor) * 0.01));
      if (Math.abs(grandTotal - totalMinor) > tolerance) warnings.push(`TOTAL (${formatKes(totalMinor)}) doesn't match Quantity × PRICE + Labour (${formatKes(grandTotal)}) — the computed value was used.`);
    }
    if (quantity !== null) dayAccumulated += grandTotal;
    dayHasItems = dayHasItems || quantity !== null;

    // Work order link. "Walk in" means a counter sale, not a missing work order.
    const jobCardNumber = normaliseJobCardNumber(row.jobCardNo);
    const jobCard = jobCardNumber ? jobCardsByNumber.get(jobCardNumber) ?? null : null;
    if (jobCardNumber && !jobCard) warnings.push(`Work order "${row.jobCardNo}" was not found — this sale was imported without a work order link.`);

    // Payment: a work-order part is paid through the work order; a counter sale
    // is cash unless its row carries an M-Pesa code or bank reference.
    const codes = splitPaymentCodes(row.mpesaCode);
    const stated = parseStatedMethod(row.cashMpesaBanked);
    let paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'JOB_CARD';
    if (jobCard) paymentMethod = 'JOB_CARD';
    else if (stated === 'BANK' || (codes.length > 0 && codes.every(isBankReference))) paymentMethod = 'BANK';
    else if (stated === 'MPESA' || codes.length > 0) paymentMethod = 'MPESA';
    else paymentMethod = 'CASH';
    if (stated === 'UNKNOWN') warnings.push(`Unrecognised payment method "${row.cashMpesaBanked}" — recorded as ${paymentMethod === 'JOB_CARD' ? 'paid through the work order' : paymentMethod.toLowerCase()}.`);
    if (paymentMethod === 'MPESA' && codes.length === 0) errors.push('M-Pesa sale has no M-Pesa code — add it in the MPESA CODE column.');

    for (const code of codes) {
      if (!isBankReference(code) && !/^[A-Z0-9]{10}$/.test(code)) warnings.push(`M-Pesa code "${code}" isn't the usual 10 letters/digits — double-check it against the statement.`);
      if (existingPaymentCodes.has(code)) warnings.push(`Payment code ${code} is already on a sale in the system — this row may already have been imported.`);
      const seen = codeFirstSeen.get(code);
      if (seen && seen.date !== dateStr) warnings.push(`Payment code ${code} is also used on row ${seen.rowNumber} (${seen.date}) — one payment rarely spans two days.`);
      if (!seen) codeFirstSeen.set(code, { rowNumber: row.rowNumber, date: dateStr });
    }
    const paymentReference = codes.length > 0 ? codes.join(', ') : null;

    const currentStock = stockBySku.get(part.id) ?? part.quantity_on_hand;
    if (quantity !== null && quantity > currentStock) {
      errors.push(`Insufficient stock: only ${formatQuantity(currentStock)} of "${part.sku}" available at this point in the file (need ${formatQuantity(quantity)}).`);
    }

    if (errors.length > 0) {
      planned.push({ rowNumber: row.rowNumber, date: dateStr, sku: row.sku, action: 'ERROR', errors, warnings, summary });
      return;
    }

    const newStock = roundQuantity(currentStock - (quantity as number));
    stockBySku.set(part.id, newStock);
    if (!isEmptyCell(row.systemStock)) {
      const stated = parseFloat(row.systemStock.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(stated) && Math.abs(stated - newStock) > 0.01) {
        warnings.push(`File says system stock should read ${row.systemStock.trim()} after this sale; based on the current database and this file's earlier rows it will actually be ${formatQuantity(newStock)}.`);
      }
    }

    summary.push(`Sell ${formatQuantity(quantity as number)} × ${part.name} (${part.sku}) @ ${formatKes(priceMinor as number)}${labourMinor > 0 ? ` + ${formatKes(labourMinor)} labour` : ''} = ${formatKes(grandTotal)}`);
    if (paymentMethod === 'JOB_CARD') summary.push(`Paid through work order ${row.jobCardNo.trim().toUpperCase()}${paymentReference ? ` · ${paymentReference}` : ''}`);
    else if (paymentMethod === 'MPESA') summary.push(`Paid by M-Pesa · ${paymentReference}`);
    else if (paymentMethod === 'BANK') summary.push(`Paid by bank${paymentReference ? ` · ${paymentReference}` : ''}`);

    const shelfParsed = isEmptyCell(row.shelfCount) ? NaN : parseFloat(row.shelfCount.replace(/[^0-9.-]/g, ''));
    const shelfCount = Number.isFinite(shelfParsed) ? roundQuantity(shelfParsed) : null;
    const saleDate = localDayStart(parsedDate ?? new Date(dateStr));

    planned.push({
      rowNumber: row.rowNumber, date: dateStr, sku: row.sku, action: 'SALE', errors, warnings, summary,
      payload: {
        p_customer_name: row.customerName || jobCard?.customerName || 'Walk-in customer',
        p_customer_phone: null,
        p_customer_type: jobCard ? 'VEHICLE_OWNER' : 'WALK_IN',
        p_payment_method: paymentMethod,
        p_payment_status: 'PAID',
        p_sale_date: saleDate,
        p_discount_minor: 0,
        p_amount_paid_minor: grandTotal,
        p_items: [{ part_id: part.id, quantity: quantity as number, unit_price_minor: priceMinor as number, shelf_count: shelfCount }],
        // The day book records only the date, not the time of the payment.
        p_payment_reference: paymentReference,
        p_payment_reference_at: paymentReference ? saleDate : null,
        p_vehicle_reg: row.vehicle || null,
        p_vehicle_model: row.vehicleModel || null,
        p_change_in_days: isEmptyCell(row.changeInDays) ? 0 : parseInt(row.changeInDays, 10) || 0,
        p_labour_minor: labourMinor,
        p_notes: null,
        p_job_card_id: jobCard?.id ?? null,
      },
    });
  });
  flushDay();

  return planned;
}
