import { formatKes, formatDate, displayToMinor } from '@/lib/formatting';

export type UploadMode = 'RECEIVE' | 'RECONCILE';

export type ExistingPart = {
  id: string; sku: string; quantity_on_hand: number; cost_price_minor: number;
  name: string | null; vehicle_model: string | null; brand: string | null; remarks: string | null; date_purchased: string | null; supplier_id: string | null;
};

export type PlannedRow = {
  rowNumber: number;
  sku: string;
  action: 'CREATE' | 'RECEIVE' | 'UPDATE' | 'NO_CHANGE' | 'SKIP' | 'ERROR';
  errors: string[];
  warnings: string[];
  existingId?: string;
  linkSku?: string; // resolve to a real id created earlier in this same file, at apply time
  createPayload?: Record<string, unknown>;
  fieldUpdates: Record<string, unknown>;
  receive?: { quantity: number; costMinor: number | null };
  quantityChange?: { from: number; to: number; delta: number };
  summary: string[];
};

// A lone dash is a common spreadsheet convention for "zero" or "blank" (Excel's
// accounting number format renders 0 as "-"), not literal data — treat it as empty
// rather than failing to parse it as a number.
function isEmptyCell(raw: string): boolean {
  const t = raw.trim();
  return t === '' || /^[-–—]+$/.test(t);
}

export function firstNonEmpty(row: Record<string, string>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase()) && !isEmptyCell(row[k])) return row[k].trim();
  }
  return '';
}

export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? displayToMinor(n) : null;
}

function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every(isEmptyCell);
}

/** Source spreadsheets like a supplier delivery note often insert a "SUBTOTAL" line
 * after each batch, with the label landing in whichever column it happens to fall
 * under once split by comma. Detected by scanning every cell rather than one column,
 * and tolerant of typos (e.g. "SUBTOTAKL" seen in real files) via a loose substring match. */
export function subtotalMarker(row: Record<string, string>): { isSubtotal: boolean; amount: number | null } {
  const values = Object.values(row);
  if (!values.some((v) => /subtot/i.test(v))) return { isSubtotal: false, amount: null };
  let amount: number | null = null;
  for (const v of values) {
    if (/subtot/i.test(v)) continue;
    const n = parseMoney(v);
    if (n !== null) { amount = n; break; }
  }
  return { isSubtotal: true, amount };
}

export function planRows(rows: Record<string, string>[], existing: ExistingPart[], supplierByName: Map<string, string>, mode: UploadMode): PlannedRow[] {
  const bySku = new Map(existing.map((p) => [p.sku.trim().toLowerCase(), { ...p }]));
  const planned: PlannedRow[] = [];
  let batchTotal = 0;

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // header is row 1

    if (isBlankRow(row)) {
      planned.push({ rowNumber, sku: '', action: 'SKIP', errors: [], warnings: [], fieldUpdates: {}, summary: ['Blank row — ignored'] });
      return;
    }

    const marker = subtotalMarker(row);
    if (marker.isSubtotal) {
      const warnings: string[] = [];
      if (marker.amount !== null) {
        const tolerance = Math.max(100, Math.round(Math.abs(marker.amount) * 0.01));
        if (Math.abs(batchTotal - marker.amount) > tolerance) {
          warnings.push(`This batch's subtotal is ${formatKes(marker.amount)} in the file, but the line items above it sum to ${formatKes(batchTotal)} — check for a missing or mistyped row.`);
        }
      }
      planned.push({ rowNumber, sku: '', action: 'SKIP', errors: [], warnings, fieldUpdates: {}, summary: ['Subtotal row — ignored'] });
      batchTotal = 0;
      return;
    }

    const sku = firstNonEmpty(row, ['part/spare no', 'part / spare no', 'sku', 'part number']);
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];

    if (!sku) {
      planned.push({ rowNumber, sku: '', action: 'ERROR', errors: ['Missing Part/spare No (SKU) — row skipped.'], warnings, fieldUpdates: {}, summary });
      return;
    }

    const description = firstNonEmpty(row, ['description', 'part name', 'name']);
    const remarksRaw = firstNonEmpty(row, ['remarks', 'notes']);
    const vehicleModelCol = firstNonEmpty(row, ['vehicle model']);
    const partMakeCol = firstNonEmpty(row, ['part make', 'brand']);
    const combined = firstNonEmpty(row, ['vehicle model & part make', 'vehicle model and part make']);
    let vehicleModel = vehicleModelCol;
    let brand = partMakeCol;
    if (!vehicleModel && !brand && combined) {
      const parts = combined.split(/·|\/|,/).map((s) => s.trim()).filter(Boolean);
      vehicleModel = parts[0] ?? ''; brand = parts[1] ?? '';
    }
    const qtyRaw = firstNonEmpty(row, ['quantity', 'qty']);
    const costRaw = firstNonEmpty(row, ['unit cost price', 'unit cost', 'cost price']);
    const totalStockRaw = firstNonEmpty(row, ['total stock price', 'total stock value', 'total price', 'total cost']);
    const dateRaw = firstNonEmpty(row, ['date purchased', 'date']);
    const supplierRaw = firstNonEmpty(row, ['supplier']);

    let quantity: number | null = null;
    if (qtyRaw !== '') {
      const n = parseInt(qtyRaw, 10);
      if (!Number.isFinite(n) || n < 0) errors.push(`Invalid Quantity "${qtyRaw}".`);
      else quantity = n;
    }
    let costMinor: number | null = null;
    if (costRaw !== '') {
      costMinor = parseMoney(costRaw);
      if (costMinor === null) errors.push(`Invalid Unit Cost Price "${costRaw}".`);
    }
    let totalStockMinor: number | null = null;
    if (totalStockRaw !== '') {
      totalStockMinor = parseMoney(totalStockRaw);
      if (totalStockMinor === null) errors.push(`Invalid Total Stock Price "${totalStockRaw}".`);
    }
    if (totalStockMinor !== null) {
      if (costMinor === null) {
        if (quantity !== null && quantity > 0) {
          costMinor = Math.round(totalStockMinor / quantity);
          summary.push(`Unit Cost Price derived from Total Stock Price ÷ Quantity (${formatKes(costMinor)} each).`);
        } else {
          errors.push('Total Stock Price given without a Quantity — cannot derive Unit Cost Price.');
        }
      } else if (quantity !== null) {
        const expected = costMinor * quantity;
        const tolerance = Math.max(100, Math.round(totalStockMinor * 0.01));
        if (Math.abs(expected - totalStockMinor) > tolerance) {
          warnings.push(`Total Stock Price (${formatKes(totalStockMinor)}) doesn't match Quantity × Unit Cost Price (${formatKes(expected)}) — Unit Cost Price was used as entered.`);
        }
      }
    }
    batchTotal += totalStockMinor ?? (costMinor !== null && quantity !== null ? costMinor * quantity : 0);

    let datePurchased: string | null | undefined;
    if (dateRaw !== '') {
      const d = new Date(dateRaw);
      if (Number.isNaN(d.getTime())) errors.push(`Invalid Date Purchased "${dateRaw}" — use YYYY-MM-DD.`);
      else datePurchased = d.toISOString().slice(0, 10);
    }
    let supplierId: string | null | undefined;
    if (supplierRaw !== '') {
      const match = supplierByName.get(supplierRaw.trim().toLowerCase());
      if (match) supplierId = match;
      else warnings.push(`Supplier "${supplierRaw}" could not be created automatically and was left unchanged.`);
    }

    const key = sku.trim().toLowerCase();
    const existingPart = bySku.get(key);
    const targetIsNewInFile = existingPart?.id.startsWith('__NEW_');

    if (!existingPart) {
      if (!description) errors.push('New part needs a Description.');
      if (errors.length > 0) { planned.push({ rowNumber, sku, action: 'ERROR', errors, warnings, fieldUpdates: {}, summary }); return; }
      const createPayload: Record<string, unknown> = {
        sku, name: description, category: 'General', selling_price_minor: 0,
        brand: brand || null, vehicle_model: vehicleModel || null, remarks: remarksRaw || null,
        date_purchased: datePurchased ?? null, supplier_id: supplierId ?? null,
        cost_price_minor: costMinor ?? 0, quantity_on_hand: 0, reorder_level: 0,
      };
      warnings.push('New part — category defaults to "General" and selling price to KES 0; edit those afterward.');
      summary.push(quantity ? `New part created, then ${quantity} units received${costMinor !== null ? ` @ ${formatKes(costMinor)} each` : ''}` : 'New part will be created (no quantity given)');
      bySku.set(key, {
        id: `__NEW_${rowNumber}__`, sku, quantity_on_hand: quantity ?? 0, cost_price_minor: costMinor ?? 0,
        name: description, vehicle_model: vehicleModel || null, brand: brand || null, remarks: remarksRaw || null,
        date_purchased: datePurchased ?? null, supplier_id: supplierId ?? null,
      });
      planned.push({
        rowNumber, sku, action: 'CREATE', errors, warnings, createPayload, fieldUpdates: {},
        receive: quantity && quantity > 0 ? { quantity, costMinor } : undefined,
        summary,
      });
      return;
    }

    if (errors.length > 0) {
      planned.push({ rowNumber, sku, action: 'ERROR', errors, warnings, existingId: targetIsNewInFile ? undefined : existingPart.id, linkSku: targetIsNewInFile ? key : undefined, fieldUpdates: {}, summary });
      return;
    }

    const fieldUpdates: Record<string, unknown> = {};
    if (description && description !== existingPart.name) { fieldUpdates.name = description; summary.push(`Description → "${description}"`); }
    if (vehicleModel && vehicleModel !== (existingPart.vehicle_model ?? '')) { fieldUpdates.vehicle_model = vehicleModel; summary.push(`Vehicle model → "${vehicleModel}"`); }
    if (brand && brand !== (existingPart.brand ?? '')) { fieldUpdates.brand = brand; summary.push(`Part make → "${brand}"`); }
    if (remarksRaw && remarksRaw !== (existingPart.remarks ?? '')) { fieldUpdates.remarks = remarksRaw; summary.push('Remarks updated'); }
    if (datePurchased && datePurchased !== existingPart.date_purchased) { fieldUpdates.date_purchased = datePurchased; summary.push(`Date purchased → ${formatDate(datePurchased)}`); }
    if (supplierId && supplierId !== existingPart.supplier_id) { fieldUpdates.supplier_id = supplierId; summary.push('Supplier updated'); }
    if (mode === 'RECONCILE' && costMinor !== null && costMinor !== existingPart.cost_price_minor) { fieldUpdates.cost_price_minor = costMinor; summary.push(`Unit cost → ${formatKes(costMinor)}`); }

    let receive: PlannedRow['receive'];
    let quantityChange: PlannedRow['quantityChange'];

    if (mode === 'RECEIVE') {
      if (quantity !== null && quantity > 0) {
        receive = { quantity, costMinor };
        summary.push(`Receive ${quantity} units${costMinor !== null ? ` @ ${formatKes(costMinor)} each` : ''} (stock ${existingPart.quantity_on_hand} → ${existingPart.quantity_on_hand + quantity})`);
        bySku.set(key, {
          ...existingPart, ...fieldUpdates,
          quantity_on_hand: existingPart.quantity_on_hand + quantity,
          cost_price_minor: costMinor !== null && costMinor > 0 ? costMinor : existingPart.cost_price_minor,
        } as ExistingPart);
      } else {
        bySku.set(key, { ...existingPart, ...fieldUpdates } as ExistingPart);
      }
    } else {
      if (quantity !== null && quantity !== existingPart.quantity_on_hand) {
        quantityChange = { from: existingPart.quantity_on_hand, to: quantity, delta: quantity - existingPart.quantity_on_hand };
        summary.push(`Quantity ${existingPart.quantity_on_hand} → ${quantity} (via audited stock adjustment)`);
      }
      bySku.set(key, { ...existingPart, ...fieldUpdates, quantity_on_hand: quantity ?? existingPart.quantity_on_hand } as ExistingPart);
    }

    if (Object.keys(fieldUpdates).length === 0 && !receive && !quantityChange) {
      planned.push({ rowNumber, sku, action: 'NO_CHANGE', errors, warnings, existingId: targetIsNewInFile ? undefined : existingPart.id, linkSku: targetIsNewInFile ? key : undefined, fieldUpdates, summary: ['No changes'] });
      return;
    }
    planned.push({
      rowNumber, sku, action: receive ? 'RECEIVE' : 'UPDATE', errors, warnings,
      existingId: targetIsNewInFile ? undefined : existingPart.id, linkSku: targetIsNewInFile ? key : undefined,
      fieldUpdates, receive, quantityChange, summary,
    });
  });

  return planned;
}

export const MODE_LABELS: Record<UploadMode, { label: string; help: string }> = {
  RECEIVE: { label: 'Record stock received', help: 'Quantity = units received in this line; adds to whatever is already on hand. Use this for supplier delivery notes and purchase batches — the same SKU can safely appear on multiple lines.' },
  RECONCILE: { label: 'Reconcile a physical count', help: 'Quantity = the final count on the shelf right now; stock is adjusted (up or down) to match exactly, via an audited stock adjustment.' },
};
