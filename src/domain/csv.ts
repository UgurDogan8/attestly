/**
 * Excel-safe tabular export serialization (data model §4, normative). Pure,
 * no Forge imports, no clock reads (ESLint-enforced, same as status.ts) —
 * every field this writes must already be resolved (title, display name,
 * timestamps) before it gets here.
 *
 * Format history (owner-reported, all inside 2026-07-22): plain comma CSV
 * didn't split into columns on the owner's Windows/Excel (its column
 * separator follows the OS region's number format, not the file's actual
 * delimiter). Fix 1 was an Excel `sep=,` directive line — reverted the same
 * day: it routed Excel through an import path that doesn't reliably honor
 * the file's UTF-8 BOM, corrupting Turkish letters (ı/İ/ğ/Ğ/ş/Ş) in the same
 * file. Fix 2 guessed the delimiter from the Confluence UI locale (`;` for
 * `tr`) — reverted the same day too: the owner's actual Excel/Windows region
 * turned out to expect `,`, despite a Turkish Confluence locale, so the
 * guess broke column-splitting again in the opposite direction. Confluence
 * locale simply isn't a reliable proxy for a user's Windows regional
 * settings, in either direction.
 *
 * Fix 3 (this one) stops guessing entirely: TAB-delimited, UTF-16LE-encoded,
 * BOM-prefixed — the exact format Excel's own "Save As → Unicode Text
 * (*.txt)" produces, and has reliably auto-opened correctly on double-click
 * for every Excel version and every regional setting for decades, because a
 * tab is never treated as a locale-dependent list separator the comma/
 * semicolon choice is, and a UTF-16 BOM (0xFF 0xFE) is a far more
 * unambiguous, reliably-autodetected signal than a UTF-8 BOM has proven to
 * be here. The byte-level UTF-16LE encoding happens client-side
 * (`static/export-ui/src/main.ts`'s `downloadResponse`) — this module still
 * only produces a plain Unicode JS string; encoding it into actual UTF-16LE
 * bytes is the browser Blob step's job, same separation as before.
 */

/** Prepended to the string; encoded client-side into the UTF-16LE bytes 0xFF 0xFE, which *is* that encoding's BOM — see this file's docstring. */
export const CSV_BOM = '﻿';

const DELIMITER = '\t';

/**
 * CSV/formula injection (CWE-1236), found in review: `pageTitle` (settable
 * by anyone with edit rights on the page) and `userDisplayName` (a user's
 * own Confluence account name) flow into this file's cells unsanitized.
 * This export exists specifically to be opened in a spreadsheet application
 * (docs/07 §5) — a cell whose content starts with `=`, `+`, `-`, or `@` is
 * interpreted as a formula by Excel/Sheets on open (e.g.
 * `=HYPERLINK("http://evil","x")`), regardless of quoting, which only
 * governs delimiter escaping, not formula interpretation. Prefixing the
 * value with a single quote is the standard mitigation: Excel then treats
 * the cell as literal text and does not display the quote itself.
 */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

function neutralizeFormula(value: string): string {
  return value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]) ? `'${value}` : value;
}

/** Quotes a field only when it contains the tab delimiter, a quote, or a newline; doubles internal quotes. */
function quoteField(value: string): string {
  if (/[\t"\r\n]/.test(value)) {
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
  return cells.map(formatCell).join(DELIMITER);
}

/** Header + rows, CRLF line endings, BOM-prefixed, tab-delimited (see this file's docstring for why). */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return CSV_BOM + lines.join('\r\n');
}
