/**
 * RFC 4180 CSV serialization (data model §4, normative). Pure, no Forge
 * imports, no clock reads (ESLint-enforced, same as status.ts) — every field
 * this writes must already be resolved (title, display name, timestamps)
 * before it gets here.
 */

/** Excel needs the UTF-8 BOM to detect encoding correctly (data model §4). */
export const CSV_BOM = '﻿';

/**
 * CSV/formula injection (CWE-1236), found in review: `pageTitle` (settable
 * by anyone with edit rights on the page) and `userDisplayName` (a user's
 * own Confluence account name) flow into this file's cells unsanitized.
 * This export exists specifically to be opened in a spreadsheet application
 * (docs/07 §5) — a cell whose content starts with `=`, `+`, `-`, or `@` is
 * interpreted as a formula by Excel/Sheets on open (e.g.
 * `=HYPERLINK("http://evil","x")`), regardless of RFC 4180 quoting, which
 * only governs delimiter escaping, not formula interpretation. Prefixing
 * the value with a single quote is the standard mitigation: Excel then
 * treats the cell as literal text and does not display the quote itself.
 */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]) ? `'${value}` : value;
}

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
  if (typeof value === 'number') {
    return quoteField(String(value));
  }
  return quoteField(neutralizeFormula(value));
}

export function toCsvRow(cells: (string | number | null)[]): string {
  return cells.map(formatCell).join(',');
}

/** Header + rows, CRLF line endings (RFC 4180), BOM-prefixed. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return CSV_BOM + lines.join('\r\n');
}
