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

/**
 * Excel doesn't always split this file into columns on open (owner-reported,
 * 2026-07-22): Excel picks its default CSV list-separator from the OS
 * region's *number format*, not the file's actual delimiter — on a Turkish
 * (and many other non-US/UK) Windows locale, the decimal comma makes Excel
 * default to `;`, so a plain comma-delimited file opens as one unsplit
 * column per row regardless of how correctly it's built. `sep=,` as the
 * file's first line is Excel's own documented override for exactly this
 * (recognized since Excel 2007, independent of regional settings) — Excel
 * hides the line and opens the rest correctly split. Deliberate tradeoff:
 * this makes the file not strictly RFC 4180 anymore (an extra directive line
 * before the header) — a machine consumer that doesn't know Excel's
 * convention must skip line 1 itself. Chosen anyway because this export's
 * entire purpose is being opened in a spreadsheet by a person (docs/07 §5),
 * and every existing caller in this app already reads the CSV by
 * `.toContain(...)`, never by assuming the header sits on line 1 (which
 * would have needed updating here rather than there).
 */
const EXCEL_SEPARATOR_HINT = 'sep=,\r\n';

/** Header + rows, CRLF line endings (RFC 4180 otherwise), BOM-prefixed, Excel separator hint first. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return CSV_BOM + EXCEL_SEPARATOR_HINT + lines.join('\r\n');
}
