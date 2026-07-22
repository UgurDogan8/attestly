/**
 * RFC 4180 CSV serialization (data model §4, normative). Pure, no Forge
 * imports, no clock reads (ESLint-enforced, same as status.ts) — every field
 * this writes must already be resolved (title, display name, timestamps)
 * before it gets here.
 */

/** Excel needs the UTF-8 BOM to detect encoding correctly (data model §4). */
export const CSV_BOM = '﻿';

/**
 * Excel picks its CSV column separator from the OS region's *number
 * format*, not the file's actual delimiter: on a Turkish (and many other
 * non-US/UK) Windows locale, the decimal comma makes Excel expect `;`, so a
 * plain comma-delimited file opens as one unsplit column per row (owner-
 * reported, 2026-07-22).
 *
 * First fix attempt was an Excel `sep=,` directive line — reverted the same
 * day: a second owner report (Turkish letters ı/İ/ğ/Ğ/ş/Ş showing as
 * mojibake in the *same* file) pointed at a known Excel quirk where the
 * `sep=` line is handled by a legacy import path that does not reliably
 * honor the file's UTF-8 BOM the normal CSV-open path does — so the fix for
 * the delimiter problem was silently reintroducing an encoding bug. Rather
 * than fight Excel's own special-case line, this makes the delimiter itself
 * match what Excel already expects for the exporting user's own locale (the
 * export UI already resolves `Locale` for i18n — `static/export-ui/src/main.ts`
 * passes the matching delimiter through `ExportFilePayload.csvDelimiter`, see
 * `shared/types.ts`) — no directive line, so the file's normal BOM-aware
 * open path is the only one Excel ever uses.
 */
export type CsvDelimiter = ',' | ';';

function delimiterPattern(delimiter: CsvDelimiter): RegExp {
  return delimiter === ';' ? /[";\r\n]/ : /[",\r\n]/;
}

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

/** Quotes a field only when RFC 4180 requires it relative to the active delimiter (contains that delimiter, a quote, or a newline); doubles internal quotes. */
function quoteField(value: string, delimiter: CsvDelimiter): string {
  if (delimiterPattern(delimiter).test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: string | number | null, delimiter: CsvDelimiter): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'number') {
    return quoteField(String(value), delimiter);
  }
  return quoteField(neutralizeFormula(value), delimiter);
}

export function toCsvRow(cells: (string | number | null)[], delimiter: CsvDelimiter = ','): string {
  return cells.map((cell) => formatCell(cell, delimiter)).join(delimiter);
}

/** Header + rows, CRLF line endings (RFC 4180), BOM-prefixed. `delimiter` defaults to comma (docs/03 §4); pass `;` for a locale whose Excel expects it (see CsvDelimiter's docstring). */
export function toCsv(header: string[], rows: (string | number | null)[][], delimiter: CsvDelimiter = ','): string {
  const lines = [toCsvRow(header, delimiter), ...rows.map((row) => toCsvRow(row, delimiter))];
  return CSV_BOM + lines.join('\r\n');
}
