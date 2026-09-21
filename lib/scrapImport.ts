import { parseCSVRows } from '@/lib/csv';
import { parseDayBookDate } from '@/lib/salesImport';
import { formatKes, localDateStr, displayToMinor } from '@/lib/formatting';
import type { ScrapItem } from '@/lib/types';

/** One row per entry — a day can have as many purchase/expense/cash rows as
 * needed, the same flexibility as entering them one at a time in the app. */
export type ScrapBulkRawRow = {
  rowNumber: number;
  date: string;
  changeInDays: string;
  entryType: string;
  scrapType: string;
  kg: string;
  expenseCategory: string;
  amount: string;
  notes: string;
};

export function parseScrapBulkCSV(text: string): ScrapBulkRawRow[] {
  const rows = parseCSVRows(text);
  return rows
    .map((r, idx) => ({
      rowNumber: idx + 2, // one header row
      date: r['Date'] ?? '',
      changeInDays: r['Change in Days'] ?? '',
      entryType: r['Entry Type'] ?? '',
      scrapType: r['Scrap Type'] ?? '',
      kg: r['KG'] ?? '',
      expenseCategory: r['Expense Category'] ?? '',
      amount: r['Amount (KES)'] ?? '',
      notes: r['Notes'] ?? '',
    }))
    .filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.trim() !== ''));
}

function isEmptyCell(raw: string): boolean {
  const t = raw.trim();
  return t === '' || /^[-–—]+$/.test(t);
}

function parseMoney(raw: string): number | null {
  if (isEmptyCell(raw)) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? displayToMinor(n) : null;
}

/** The scrap yard's fixed catalogue as of the historical bulk import — the
 * canonical set an uploaded row's Scrap Type is validated against, independent
 * of (but expected to match 1:1 with) whatever's actually in scrap_items. */
export const SCRAP_TYPE_ENUM = [
  'HEAVY', 'HEAVY 2', 'HEAVY 3', 'LIGHT', 'LIGHT 2', 'DAWA', 'DAWA 2',
  'BATTERY', 'BATTERY 2', 'BATTERY 3', 'BATTERY 4', 'CAST', 'CAST 2',
  'ALU HARD', 'ALU HARD 2', 'SOFT', 'PLASTIC', 'BRASS', 'GUMBOOTS',
  'RADIATOR', 'RADIATOR BRASS',
] as const;

export const EXPENSE_CATEGORY_ENUM = [
  'Transport', 'Labour', 'Loading', 'Offloading', 'Fuel', 'Water', 'Water Proof',
  'Wheelbarrow', 'Welding Rods', 'Work', 'Worker', 'Cutting Disks & Rods', 'Lunch',
  'Police', 'Gass', 'Carlift', 'Motor', 'Disck', 'Jose Transport', 'Boy Battery',
  'Constraction', 'Withdraw',
] as const;

const SCRAP_TYPE_SET = new Set(SCRAP_TYPE_ENUM.map((s) => s.toLowerCase()));
const EXPENSE_CATEGORY_SET = new Set(EXPENSE_CATEGORY_ENUM.map((s) => s.toLowerCase()));

export type ScrapPlannedOp =
  | { kind: 'CASH'; date: string; changeInDays: number; amountMinor: number; notes: string | null }
  | { kind: 'PURCHASE'; date: string; changeInDays: number; scrapItemId: string; weightKg: number; notes: string | null }
  | { kind: 'EXPENSE'; date: string; changeInDays: number; category: string; amountMinor: number; notes: string | null };

export type ScrapPlannedRow = {
  rowNumber: number;
  date: string;
  action: 'CASH' | 'PURCHASE' | 'EXPENSE' | 'ERROR';
  errors: string[];
  warnings: string[];
  summary: string[];
  op?: ScrapPlannedOp;
};

export function planScrapRows(rows: ScrapBulkRawRow[], items: ScrapItem[]): ScrapPlannedRow[] {
  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const today = localDateStr();
  const planned: ScrapPlannedRow[] = [];

  rows.forEach((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];

    const parsedDate = parseDayBookDate(row.date);
    const dateStr = parsedDate ? localDateStr(parsedDate) : row.date.trim();
    if (!parsedDate) errors.push(`Unrecognised date "${row.date}" — expected a format like "1 Aug 2026".`);
    else if (dateStr > today) errors.push(`"${dateStr}" is in the future — cannot record.`);

    let changeInDays = 0;
    if (!isEmptyCell(row.changeInDays)) {
      changeInDays = parseInt(row.changeInDays, 10);
      if (!Number.isFinite(changeInDays) || changeInDays < 0) errors.push(`Invalid Change in Days "${row.changeInDays}".`);
    }

    const notes = isEmptyCell(row.notes) ? null : row.notes.trim();
    const type = row.entryType.trim().toUpperCase();
    if (type !== 'PURCHASE' && type !== 'EXPENSE' && type !== 'CASH') {
      errors.push(`Entry Type must be PURCHASE, EXPENSE or CASH (got "${row.entryType || '(blank)'}").`);
      planned.push({ rowNumber: row.rowNumber, date: dateStr, action: 'ERROR', errors, warnings, summary });
      return;
    }

    const hasScrapType = !isEmptyCell(row.scrapType);
    const hasKg = !isEmptyCell(row.kg);
    const hasExpenseCategory = !isEmptyCell(row.expenseCategory);
    const hasAmount = !isEmptyCell(row.amount);

    if (type === 'PURCHASE') {
      if (hasExpenseCategory) errors.push('Expense Category must be blank on a PURCHASE row.');
      if (hasAmount) errors.push('Amount (KES) must be blank on a PURCHASE row.');

      let item: ScrapItem | undefined;
      if (!hasScrapType) {
        errors.push('Scrap Type is required on a PURCHASE row.');
      } else if (!SCRAP_TYPE_SET.has(row.scrapType.trim().toLowerCase())) {
        errors.push(`Scrap Type "${row.scrapType}" is not one of the allowed types (${SCRAP_TYPE_ENUM.join(', ')}).`);
      } else {
        item = byName.get(row.scrapType.trim().toLowerCase());
        if (!item) errors.push(`Scrap type "${row.scrapType}" was not found — add it under Scrap Types & Rates first.`);
        else if (!item.active) errors.push(`"${item.name}" is not active.`);
        else if (item.current_rate_minor == null) errors.push(`Set a rate for "${item.name}" under Scrap Types & Rates before importing its purchases.`);
      }

      const weight = hasKg ? parseFloat(row.kg) : NaN;
      if (!hasKg) errors.push('KG is required on a PURCHASE row.');
      else if (!Number.isFinite(weight) || weight <= 0) errors.push(`Invalid KG "${row.kg}".`);

      if (errors.length > 0) { planned.push({ rowNumber: row.rowNumber, date: dateStr, action: 'ERROR', errors, warnings, summary }); return; }

      const amount = Math.round(weight * (item!.current_rate_minor as number));
      summary.push(`Purchase ${weight} KG of ${item!.name} @ ${formatKes(item!.current_rate_minor as number)}/kg = ${formatKes(amount)}`);
      planned.push({
        rowNumber: row.rowNumber, date: dateStr, action: 'PURCHASE', errors, warnings, summary,
        op: { kind: 'PURCHASE', date: dateStr, changeInDays, scrapItemId: item!.id, weightKg: weight, notes },
      });
      return;
    }

    if (type === 'EXPENSE') {
      if (hasScrapType) errors.push('Scrap Type must be blank on an EXPENSE row.');
      if (hasKg) errors.push('KG must be blank on an EXPENSE row.');

      const category = row.expenseCategory.trim();
      if (!hasExpenseCategory) {
        errors.push('Expense Category is required on an EXPENSE row.');
      } else if (!EXPENSE_CATEGORY_SET.has(category.toLowerCase())) {
        errors.push(`Expense Category "${category}" is not one of the allowed categories (${EXPENSE_CATEGORY_ENUM.join(', ')}).`);
      }

      const amountMinor = parseMoney(row.amount);
      if (!hasAmount) errors.push('Amount (KES) is required on an EXPENSE row.');
      else if (amountMinor === null || amountMinor <= 0) errors.push(`Invalid Amount "${row.amount}".`);

      if (errors.length > 0) { planned.push({ rowNumber: row.rowNumber, date: dateStr, action: 'ERROR', errors, warnings, summary }); return; }

      summary.push(`Expense: ${category} — ${formatKes(amountMinor as number)}`);
      planned.push({
        rowNumber: row.rowNumber, date: dateStr, action: 'EXPENSE', errors, warnings, summary,
        op: { kind: 'EXPENSE', date: dateStr, changeInDays, category, amountMinor: amountMinor as number, notes },
      });
      return;
    }

    // CASH
    if (hasScrapType) errors.push('Scrap Type must be blank on a CASH row.');
    if (hasKg) errors.push('KG must be blank on a CASH row.');
    if (hasExpenseCategory) errors.push('Expense Category must be blank on a CASH row.');

    const amountMinor = parseMoney(row.amount);
    if (!hasAmount) errors.push('Amount (KES) is required on a CASH row.');
    else if (amountMinor === null || amountMinor <= 0) errors.push(`Invalid Amount "${row.amount}".`);

    if (errors.length > 0) { planned.push({ rowNumber: row.rowNumber, date: dateStr, action: 'ERROR', errors, warnings, summary }); return; }

    summary.push(`Cash added: ${formatKes(amountMinor as number)}`);
    planned.push({
      rowNumber: row.rowNumber, date: dateStr, action: 'CASH', errors, warnings, summary,
      op: { kind: 'CASH', date: dateStr, changeInDays, amountMinor: amountMinor as number, notes },
    });
  });

  return planned;
}
