/**
 * Minimal, dependency-free PDF builder (T12, docs/07 §5/§8: "server-side
 * `domain/pdf.ts`" — UI Kit has no DOM/canvas, so the reference's
 * client-side PDF generation is impossible here; the `exportFile` resolver
 * builds it instead, returned to the Custom UI export surface as base64 for
 * a browser download). Writes raw PDF 1.4 bytes directly (objects, xref, trailer) —
 * no third-party PDF library, which keeps this pure, keeps the "no
 * external egress" claim trivially true (nothing to fetch fonts/assets
 * from), and avoids bundling a heavy dependency into a Forge function.
 *
 * Same rows as the CSV of the same scope (docs/03 §4, docs/07 §5: "CSV + PDF
 * come from the same export.ts rows -> record parity guaranteed") — this
 * file only lays them out differently. Two columns CSV repeats on every row
 * (`exported_at_utc`, `app_version`) move into a single one-line report
 * header instead (data model §4 calls that CSV repetition out specifically
 * as "makes each [CSV] row self-describing"; a printed page doesn't need
 * the same value repeated hundreds of times to stay self-describing, it
 * just needs the header once) — the parity the accept criteria asks for is
 * about records/statuses/timestamps, not about mechanically repeating those
 * two fields on every visual row.
 *
 * Font: standard Type1 Courier + WinAnsiEncoding. Fixed-width means column
 * alignment is just fixed-length padding — no font metrics needed, which is
 * what keeps this "minimal". WinAnsiEncoding (~CP1252/Latin-1) does NOT
 * cover Turkish-specific letters (ı, İ, ğ, Ğ, ş, Ş) — `toWinAnsi` below
 * substitutes the closest ASCII letter for those four rather than emit
 * invalid bytes or crash; ç/ö/ü/Ç/Ö/Ü *are* in WinAnsi and pass through
 * unchanged. This is a disclosed, deliberate residual (docs/02 §11
 * convention): full Turkish glyph support would need an embedded font,
 * well beyond "minimal" scope for a v1 audit artifact whose CSV twin is
 * already lossless.
 */
import type { ExportRow } from './export';

export interface PdfReportHeader {
  scope: string;
  exportedAtUtc: string;
  appVersion: string;
}

const PAGE_WIDTH = 792; // US Letter, landscape
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const FONT_SIZE = 7;
const HEADER_FONT_SIZE = 9;
const LINE_HEIGHT = 10;

interface Column {
  header: string;
  width: number;
  get: (row: ExportRow) => string;
}

/** Column order mirrors CSV_HEADER (domain/export.ts) minus exported_at_utc/app_version (moved to the report header). */
const COLUMNS: Column[] = [
  { header: 'PAGE TITLE', width: 22, get: (r) => r.pageTitle },
  { header: 'PAGE ID', width: 12, get: (r) => r.pageId },
  { header: 'SPACE', width: 8, get: (r) => r.spaceKey },
  { header: 'VER', width: 4, get: (r) => (r.pageVersionConfirmed === null ? '' : String(r.pageVersionConfirmed)) },
  { header: 'USER', width: 18, get: (r) => r.userDisplayName },
  { header: 'ACCOUNT ID', width: 14, get: (r) => r.userAccountId },
  { header: 'TYPE', width: 10, get: (r) => r.assignmentType },
  { header: 'STATUS', width: 12, get: (r) => r.status },
  // Data model §4: exported timestamps are YYYY-MM-DDTHH:mm:ssZ (no
  // milliseconds, 20 characters) -- export.ts strips the millisecond suffix
  // before a row reaches here.
  { header: 'CONFIRMED AT (UTC)', width: 20, get: (r) => r.confirmedAtUtc ?? '' },
  { header: 'DUE DATE', width: 10, get: (r) => r.dueDate ?? '' },
];

const TURKISH_TO_ASCII: Record<string, string> = {
  ı: 'i',
  İ: 'I',
  ğ: 'g',
  Ğ: 'G',
  ş: 's',
  Ş: 'S',
};

/**
 * Degrades text to a byte-safe WinAnsi (Latin-1-range) string: the four
 * Turkish-only letters fall back to their plain-ASCII counterpart; any
 * other character outside the encodable range (emoji, CJK, etc.) becomes
 * `?` rather than corrupting the PDF byte stream. ç/ö/ü/Ç/Ö/Ü need no
 * substitution — they're already in WinAnsi/Latin-1.
 */
export function toWinAnsi(text: string): string {
  let result = '';
  for (const ch of text) {
    const mapped = TURKISH_TO_ASCII[ch];
    if (mapped) {
      result += mapped;
      continue;
    }
    // A non-empty character from a for-of iteration always has a defined
    // code point at index 0 -- the `| undefined` in codePointAt's return
    // type only covers an out-of-range index, which can't happen here.
    const code = ch.codePointAt(0) as number;
    result += code >= 0x20 && code <= 0xff ? ch : '?';
  }
  return result;
}

/** PDF string-literal escaping (parentheses and backslash are the three special characters, PDF spec §7.3.4.2). */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Truncates to `width` (no ellipsis marker -- anything beyond Latin-1 would
 * corrupt the byte stream once `toWinAnsi` has already run) and pads. */
function padColumn(value: string, width: number): string {
  return toWinAnsi(value).slice(0, width).padEnd(width, ' ');
}

function formatRowLine(row: ExportRow): string {
  return COLUMNS.map((col) => padColumn(col.get(row), col.width)).join(' ');
}

function formatHeaderLine(): string {
  return COLUMNS.map((col) => col.header.padEnd(col.width, ' ')).join(' ');
}

/** How many text lines (report header + column header + separator) precede the row data on every page. */
const LINES_BEFORE_ROWS = 3;

function rowsPerPage(): number {
  const usableHeight = PAGE_HEIGHT - MARGIN * 2 - HEADER_FONT_SIZE - LINES_BEFORE_ROWS * LINE_HEIGHT;
  return Math.max(1, Math.floor(usableHeight / LINE_HEIGHT));
}

function paginate<T>(items: T[], perPage: number): T[][] {
  if (items.length === 0) {
    return [[]];
  }
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}

function buildContentStream(header: PdfReportHeader, pageRows: ExportRow[], pageIndex: number, totalPages: number): string {
  const headerLine = `Read confirmations export | scope: ${header.scope} | exported: ${header.exportedAtUtc} | app v${header.appVersion} | page ${pageIndex + 1}/${totalPages}`;
  const separator = '-'.repeat(COLUMNS.reduce((sum, c) => sum + c.width, 0) + COLUMNS.length - 1);

  const startY = PAGE_HEIGHT - MARGIN;
  const ops: string[] = ['BT', `/F1 ${HEADER_FONT_SIZE} Tf`, `${MARGIN} ${startY} Td`, `(${escapePdfString(toWinAnsi(headerLine))}) Tj`];
  ops.push(`0 -${LINE_HEIGHT} Td`, `/F1 ${FONT_SIZE} Tf`, `(${escapePdfString(formatHeaderLine())}) Tj`);
  ops.push(`0 -${LINE_HEIGHT} Td`, `(${escapePdfString(separator)}) Tj`);

  for (const row of pageRows) {
    ops.push(`0 -${LINE_HEIGHT} Td`, `(${escapePdfString(formatRowLine(row))}) Tj`);
  }
  ops.push('ET');

  return ops.join('\n');
}

interface PdfObject {
  num: number;
  body: string;
}

/**
 * Builds a complete PDF 1.4 document as a byte buffer. Rows are paginated
 * (landscape US Letter) with the report header + column header repeated on
 * every page (docs/07 §5's "adds report header" requirement) — kept
 * uniform across pages rather than special-casing page 1, which is what
 * keeps the pagination math in this file "minimal".
 */
export function buildPdf(header: PdfReportHeader, rows: ExportRow[]): Buffer {
  const pages = paginate(rows, rowsPerPage());
  const objects: PdfObject[] = [];

  const fontObjNum = 3;
  const pageObjNum = (i: number): number => 4 + i * 2;
  const contentObjNum = (i: number): number => 5 + i * 2;

  objects.push({ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    num: 2,
    body: `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  });
  objects.push({ num: fontObjNum, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>' });

  pages.forEach((pageRows, i) => {
    objects.push({
      num: pageObjNum(i),
      body:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`,
    });
    const stream = buildContentStream(header, pageRows, i, pages.length);
    const streamBytes = Buffer.byteLength(stream, 'latin1');
    objects.push({ num: contentObjNum(i), body: `<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream` });
  });

  objects.sort((a, b) => a.num - b.num);

  const chunks: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = [0]; // object 0 is the free-list head, per spec
  let byteOffset = Buffer.byteLength(chunks[0], 'latin1');

  for (const obj of objects) {
    offsets[obj.num] = byteOffset;
    const text = `${obj.num} 0 obj\n${obj.body}\nendobj\n`;
    chunks.push(text);
    byteOffset += Buffer.byteLength(text, 'latin1');
  }

  const xrefOffset = byteOffset;
  // Object numbers are assigned contiguously from 1 (catalog/pages/font,
  // then page+content pairs) with no gaps, so `offsets[n]` is always
  // populated for every n below -- see the object-numbering scheme above.
  const objectCount = objects[objects.length - 1].num + 1;
  const xrefLines = ['xref', `0 ${objectCount}`, '0000000000 65535 f '];
  for (let n = 1; n < objectCount; n += 1) {
    xrefLines.push(`${String(offsets[n]).padStart(10, '0')} 00000 n `);
  }
  chunks.push(xrefLines.join('\n') + '\n');
  chunks.push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(''), 'latin1');
}
