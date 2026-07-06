import { formatTimestampForDisplay, resolveRecordsWithTitles } from './index';

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN_X = 40;
const TOP_Y = 558;
const ROW_HEIGHT = 15;
const ROWS_PER_PAGE = 28;

const COLUMNS = [
  { label: 'Page', x: 40, maxChars: 38 },
  { label: 'Page ID', x: 275, maxChars: 15 },
  { label: 'Ver.', x: 365, maxChars: 6 },
  { label: 'User accountId', x: 415, maxChars: 27 },
  { label: 'Acknowledged at', x: 590, maxChars: 28 },
];

const TURKISH_GLYPHS = new Map([
  ['Ğ', { code: 0x80, glyph: 'Gbreve', unicode: '011E' }],
  ['ğ', { code: 0x81, glyph: 'gbreve', unicode: '011F' }],
  ['İ', { code: 0x82, glyph: 'Idotaccent', unicode: '0130' }],
  ['ı', { code: 0x83, glyph: 'dotlessi', unicode: '0131' }],
  ['Ş', { code: 0x84, glyph: 'Scedilla', unicode: '015E' }],
  ['ş', { code: 0x85, glyph: 'scedilla', unicode: '015F' }],
]);

const CHARACTER_REPLACEMENTS = new Map([
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201C', '"'],
  ['\u201D', '"'],
  ['\u2013', '-'],
  ['\u2014', '-'],
  ['\u2026', '...'],
]);

function truncate(value, maxChars) {
  const text = String(value ?? '');
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, Math.max(0, maxChars - 3)).join('')}...`;
}

function encodePdfText(value) {
  const bytes = [];

  for (const char of Array.from(String(value ?? ''))) {
    if (TURKISH_GLYPHS.has(char)) {
      bytes.push(TURKISH_GLYPHS.get(char).code);
      continue;
    }

    if (CHARACTER_REPLACEMENTS.has(char)) {
      for (const replacementChar of CHARACTER_REPLACEMENTS.get(char)) {
        bytes.push(replacementChar.charCodeAt(0));
      }
      continue;
    }

    const code = char.charCodeAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }

  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function drawText(text, x, y, size = 9) {
  return `BT /F1 ${size} Tf ${x} ${y} Td <${encodePdfText(text)}> Tj ET\n`;
}

function drawLine(x1, y1, x2, y2) {
  return `0.5 w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}

function buildPageContent(rows, pageNumber, pageCount, generatedAt) {
  let content = '';
  content += drawText('Attestly Acknowledgement Audit Report', MARGIN_X, 574, 16);
  content += drawText(`Generated: ${generatedAt}`, MARGIN_X, 552, 8);
  content += drawLine(MARGIN_X, 540, PAGE_WIDTH - MARGIN_X, 540);

  for (const column of COLUMNS) {
    content += drawText(column.label, column.x, 522, 8);
  }
  content += drawLine(MARGIN_X, 514, PAGE_WIDTH - MARGIN_X, 514);

  if (rows.length === 0) {
    content += drawText('No acknowledgement records found.', MARGIN_X, 492, 10);
  } else {
    rows.forEach((row, index) => {
      const y = TOP_Y - 58 - index * ROW_HEIGHT;
      content += drawText(truncate(row.pageTitle, COLUMNS[0].maxChars), COLUMNS[0].x, y, 8);
      content += drawText(truncate(row.contentId, COLUMNS[1].maxChars), COLUMNS[1].x, y, 8);
      content += drawText(truncate(row.pageVersion, COLUMNS[2].maxChars), COLUMNS[2].x, y, 8);
      content += drawText(truncate(row.accountId, COLUMNS[3].maxChars), COLUMNS[3].x, y, 8);
      content += drawText(
        truncate(formatTimestampForDisplay(row.timestamp), COLUMNS[4].maxChars),
        COLUMNS[4].x,
        y,
        8
      );
    });
  }

  content += drawLine(MARGIN_X, 44, PAGE_WIDTH - MARGIN_X, 44);
  content += drawText(`Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - 105, 28, 8);
  return content;
}

function chunkRows(rows) {
  if (rows.length === 0) {
    return [[]];
  }

  const pages = [];
  for (let index = 0; index < rows.length; index += ROWS_PER_PAGE) {
    pages.push(rows.slice(index, index + ROWS_PER_PAGE));
  }
  return pages;
}

function buildPdfString(pageContents) {
  const pageCount = pageContents.length;
  const fontObjectNumber = 3 + pageCount * 2;
  const toUnicodeObjectNumber = fontObjectNumber + 1;
  const maxObjectNumber = toUnicodeObjectNumber;
  const objects = new Map();

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');

  const pageRefs = pageContents
    .map((_, index) => `${3 + index * 2} 0 R`)
    .join(' ');
  objects.set(2, `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`);

  pageContents.forEach((content, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    objects.set(
      pageObjectNumber,
      [
        '<< /Type /Page',
        '/Parent 2 0 R',
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`,
        `/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >>`,
        `/Contents ${contentObjectNumber} 0 R`,
        '>>',
      ].join(' ')
    );
    objects.set(
      contentObjectNumber,
      `<< /Length ${content.length} >>\nstream\n${content}endstream`
    );
  });

  const differences = Array.from(TURKISH_GLYPHS.values())
    .map(({ code, glyph }) => `${code} /${glyph}`)
    .join(' ');
  objects.set(
    fontObjectNumber,
    [
      '<< /Type /Font',
      '/Subtype /Type1',
      '/BaseFont /Helvetica',
      `/Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >>`,
      `/ToUnicode ${toUnicodeObjectNumber} 0 R`,
      '>>',
    ].join(' ')
  );

  const toUnicodeCMap = buildToUnicodeCMap();
  objects.set(
    toUnicodeObjectNumber,
    `<< /Length ${toUnicodeCMap.length} >>\nstream\n${toUnicodeCMap}endstream`
  );

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    offsets[objectNumber] = pdf.length;
    pdf += `${objectNumber} 0 obj\n${objects.get(objectNumber)}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${maxObjectNumber + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObjectNumber + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

function buildToUnicodeCMap() {
  const mappings = [];

  for (let code = 0x20; code <= 0x7e; code += 1) {
    mappings.push([code, code.toString(16).toUpperCase().padStart(4, '0')]);
  }
  for (let code = 0xa0; code <= 0xff; code += 1) {
    mappings.push([code, code.toString(16).toUpperCase().padStart(4, '0')]);
  }
  for (const { code, unicode } of TURKISH_GLYPHS.values()) {
    mappings.push([code, unicode]);
  }

  const chunks = [];
  for (let index = 0; index < mappings.length; index += 100) {
    const chunk = mappings.slice(index, index + 100);
    chunks.push(`${chunk.length} beginbfchar\n`);
    for (const [code, unicode] of chunk) {
      chunks.push(`<${code.toString(16).toUpperCase().padStart(2, '0')}> <${unicode}>\n`);
    }
    chunks.push('endbfchar\n');
  }

  return [
    '/CIDInit /ProcSet findresource begin\n',
    '12 dict begin\n',
    'begincmap\n',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n',
    '/CMapName /AttestlyUnicode def\n',
    '/CMapType 2 def\n',
    '1 begincodespacerange\n',
    '<00> <FF>\n',
    'endcodespacerange\n',
    ...chunks,
    'endcmap\n',
    'CMapName currentdict /CMap defineresource pop\n',
    'end\n',
    'end\n',
  ].join('');
}

export async function buildAcknowledgementsPdf() {
  const rows = await resolveRecordsWithTitles();
  const generatedAt = formatTimestampForDisplay(new Date().toISOString());
  const pageRows = chunkRows(rows);
  const pageContents = pageRows.map((rowsForPage, index) =>
    buildPageContent(rowsForPage, index + 1, pageRows.length, generatedAt)
  );

  return buildPdfString(pageContents);
}
