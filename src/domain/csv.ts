/**
 * RFC 4180 CSV serialization (data model §4, normative). Pure, no Forge
 * imports, no clock reads (ESLint-enforced, same as status.ts) — every field
 * this writes must already be resolved (title, display name, timestamps)
 * before it gets here.
 */

/** Excel needs the UTF-8 BOM to detect encoding correctly (data model §4). */
export const CSV_BOM = '﻿';

/** Quotes a field only when RFC 4180 requires it (contains a comma, quote, or newline); doubles internal quotes. */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  return quoteField(String(value));
}

export function toCsvRow(cells: (string | number | null)[]): string {
  return cells.map(formatCell).join(',');
}

/** Header + rows, CRLF line endings (RFC 4180), BOM-prefixed. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return CSV_BOM + lines.join('\r\n');
}
