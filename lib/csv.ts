/** Minimal RFC4180 CSV parser — handles quoted fields, embedded commas/newlines,
 * and "" as an escaped quote inside a quoted field. Good enough for a file a user
 * edited in Excel/Sheets and saved as CSV, which is the only real input this needs
 * to survive (not arbitrary CSV dialects). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // strip a UTF-8 BOM if Excel added one

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** Parses a CSV's first row as a header and returns each subsequent row as a
 * header-keyed object (trimmed keys, raw string values — callers coerce types). */
export function parseCSVRows(text: string): Record<string, string>[] {
  const table = parseCSV(text);
  if (table.length === 0) return [];
  const headers = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
}
