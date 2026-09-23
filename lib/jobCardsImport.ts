import { parseCSVRows } from '@/lib/csv';
import { parseDayBookDate } from '@/lib/salesImport';
import { localDateStr, localDayStart, displayToMinor } from '@/lib/formatting';

export const WALK_IN_CUSTOMER_NAME = 'Walk-in customer';

export type JobCardRawRow = {
  rowNumber: number;
  dateIn: string;
  customerName: string;
  customerPhone: string;
  registrationNumber: string;
  make: string;
  model: string;
  technician: string;
  reason: string;
  originalJobNumber: string;
  totalCharge: string;
  amountPaid: string;
  paymentStatus: string;
  amountOwed: string;
  mpesaCode: string;
  jobStatus: string;
};

export function parseJobCardsCSV(text: string): JobCardRawRow[] {
  const rows = parseCSVRows(text);
  return rows
    .map((r, idx) => ({
      rowNumber: idx + 2, // one header row
      dateIn: r['Date In'] ?? '',
      customerName: r['Customer Name'] ?? '',
      customerPhone: r['Customer Phone'] ?? '',
      registrationNumber: r['Registration Number'] ?? '',
      make: r['Make'] ?? '',
      model: r['Model'] ?? '',
      technician: r['Technician'] ?? '',
      reason: r['Reason / Service Required'] ?? '',
      originalJobNumber: r['Job Card No.'] ?? '',
      totalCharge: r['Total Charge'] ?? '',
      amountPaid: r['Amount Paid'] ?? '',
      paymentStatus: r['Payment Status'] ?? '',
      amountOwed: r['Amount Owed'] ?? '',
      mpesaCode: r['Mpesa Code'] ?? '',
      jobStatus: r['Job Status'] ?? '',
    }))
    .filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.trim() !== ''));
}

function isEmptyCell(raw: string): boolean {
  const t = raw.trim();
  return t === '' || t.toLowerCase() === 'null' || /^[-–—]+$/.test(t);
}

/** Never hard-fails on a bad amount — a handful of blank/garbled charges
 * shouldn't block importing the other 90-odd rows. Downgrades to 0 with a
 * warning instead, so it's visible in the preview and fixable afterward. */
function parseMoneyOrZero(raw: string, label: string, warnings: string[]): number {
  if (isEmptyCell(raw)) { warnings.push(`${label} was blank — recorded as KES 0.`); return 0; }
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const n = cleaned === '' ? NaN : parseFloat(cleaned);
  if (!Number.isFinite(n)) { warnings.push(`Could not read ${label} "${raw}" — recorded as KES 0.`); return 0; }
  return displayToMinor(n);
}

export function customerKey(name: string): string {
  const trimmed = name.trim();
  return (trimmed || WALK_IN_CUSTOMER_NAME).toLowerCase();
}

export function vehicleKey(registration: string): string {
  return registration.trim().toUpperCase();
}

export type ExistingCustomer = { id: string; full_name: string };
export type ExistingVehicle = { id: string; customer_id: string; registration_number: string };

export type JobCardPayment = { amountMinor: number; method: 'MPESA' | 'CASH'; reference: string | null };

export type JobCardPlannedRow = {
  rowNumber: number;
  date: string;
  registrationNumber: string;
  action: 'CREATE' | 'ERROR';
  errors: string[];
  warnings: string[];
  summary: string[];
  payload?: {
    customerId: string;
    vehicleId: string;
    complaint: string;
    otherChargesMinor: number;
    targetStatuses: ('OPEN' | 'IN_PROGRESS' | 'COMPLETED')[];
    technicianName: string | null;
    payment: JobCardPayment | null;
    createdAtIso: string;
  };
};

/** Pure — assumes every customer/vehicle this file needs has already been
 * resolved or created by the caller (mirrors BulkPartsUpload's "auto-create
 * missing suppliers first, then plan" split). A row whose customer/vehicle
 * key still isn't in these maps is treated as a planning error, not silently
 * skipped. */
export function planJobCardRows(
  rows: JobCardRawRow[],
  customersByKey: Map<string, ExistingCustomer>,
  vehiclesByKey: Map<string, ExistingVehicle>,
): JobCardPlannedRow[] {
  const today = localDateStr();
  const planned: JobCardPlannedRow[] = [];

  rows.forEach((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];

    const parsedDate = parseDayBookDate(row.dateIn);
    const dateStr = parsedDate ? localDateStr(parsedDate) : row.dateIn.trim();
    if (!parsedDate) errors.push(`Unrecognised Date In "${row.dateIn}" — expected a format like "12 Aug 2026".`);
    else if (dateStr > today) errors.push(`"${dateStr}" is in the future — cannot record.`);

    const regKey = vehicleKey(row.registrationNumber);
    if (!regKey) errors.push('Registration Number is required.');
    else if (!/^[A-Z0-9]+$/.test(regKey)) warnings.push(`Registration Number "${row.registrationNumber}" contains unexpected characters — double-check it against the original.`);

    const custKey = customerKey(row.customerName);
    const customer = customersByKey.get(custKey);
    if (!customer) errors.push(`Customer "${row.customerName || WALK_IN_CUSTOMER_NAME}" could not be resolved.`);

    const vehicle = regKey ? vehiclesByKey.get(regKey) : undefined;
    if (regKey && !vehicle) errors.push(`Vehicle "${row.registrationNumber}" could not be resolved.`);

    const reason = row.reason.trim();
    if (!reason) errors.push('Reason / Service Required is required.');

    if (errors.length > 0) {
      planned.push({ rowNumber: row.rowNumber, date: dateStr, registrationNumber: row.registrationNumber, action: 'ERROR', errors, warnings, summary });
      return;
    }

    const otherChargesMinor = parseMoneyOrZero(row.totalCharge, 'Total Charge', warnings);

    const jobStatus = row.jobStatus.trim().toLowerCase();
    let targetStatuses: ('OPEN' | 'IN_PROGRESS' | 'COMPLETED')[];
    if (jobStatus === 'completed') targetStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED'];
    else if (jobStatus === 'in progress') targetStatuses = ['OPEN', 'IN_PROGRESS'];
    else if (jobStatus === 'pending') targetStatuses = ['OPEN'];
    else if (jobStatus === 'on hold') { targetStatuses = ['OPEN']; warnings.push('Job Status "On Hold" has no matching status in this app — recorded as OPEN.'); }
    else { targetStatuses = ['OPEN']; warnings.push(`Unrecognised Job Status "${row.jobStatus}" — recorded as OPEN.`); }

    const paymentStatus = row.paymentStatus.trim().toLowerCase();
    let payment: JobCardPayment | null = null;
    if (paymentStatus === 'paid' || paymentStatus === 'partially paid') {
      const amountMinor = paymentStatus === 'paid' ? otherChargesMinor : parseMoneyOrZero(row.amountPaid, 'Amount Paid', warnings);
      if (amountMinor > 0 && amountMinor <= otherChargesMinor) {
        const reference = isEmptyCell(row.mpesaCode) ? null : row.mpesaCode.trim();
        payment = { amountMinor, method: reference ? 'MPESA' : 'CASH', reference };
      } else if (amountMinor > otherChargesMinor) {
        warnings.push(`Amount Paid (${row.amountPaid}) exceeds Total Charge (${row.totalCharge}) — payment not recorded, left as an outstanding balance.`);
      }
    } else if (paymentStatus !== 'unpaid' && paymentStatus !== '') {
      warnings.push(`Unrecognised Payment Status "${row.paymentStatus}" — treated as unpaid.`);
    }

    if (!isEmptyCell(row.amountOwed)) {
      const statedOwed = parseMoneyOrZero(row.amountOwed, 'Amount Owed', []);
      const actualOwed = otherChargesMinor - (payment?.amountMinor ?? 0);
      if (Math.abs(statedOwed - actualOwed) > 100) {
        warnings.push(`File says Amount Owed is ${row.amountOwed}, but Total Charge minus Amount Paid works out to a different figure — using the computed value.`);
      }
    }

    const technicianName = row.technician.trim() || null;

    summary.push(`${reason} — ${row.registrationNumber.trim().toUpperCase()} — KES ${(otherChargesMinor / 100).toFixed(0)}${payment ? ` (${payment.amountMinor === otherChargesMinor ? 'paid in full' : 'partially paid'})` : ' (unpaid)'}`);
    summary.push(`Status: ${targetStatuses[targetStatuses.length - 1]}`);

    planned.push({
      rowNumber: row.rowNumber, date: dateStr, registrationNumber: row.registrationNumber, action: 'CREATE', errors, warnings, summary,
      payload: {
        customerId: customer!.id, vehicleId: vehicle!.id, complaint: reason, otherChargesMinor, targetStatuses,
        technicianName, payment, createdAtIso: localDayStart(parsedDate ?? new Date(dateStr)),
      },
    });
  });

  return planned;
}
