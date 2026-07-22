import { buildPdf, toWinAnsi, type PdfReportHeader } from './pdf';
import type { ExportRow } from './export';

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    pageTitle: 'Security Policy',
    pageId: 'page-1',
    spaceKey: 'SEC',
    pageVersionConfirmed: 1,
    userDisplayName: 'Ayse Yilmaz',
    userAccountId: 'acc-1',
    assignmentType: 'assigned',
    status: 'confirmed',
    confirmedAtUtc: '2026-07-09T12:00:00Z',
    dueDate: null,
    exportedAtUtc: '2026-07-09T13:00:00Z',
    appVersion: '0.1.0',
    ...overrides,
  };
}

const header: PdfReportHeader = { scope: 'site', exportedAtUtc: '2026-07-09T13:00:00Z', appVersion: '0.1.0' };

function bufferText(buf: Buffer): string {
  return buf.toString('latin1');
}

describe('toWinAnsi', () => {
  it('leaves plain ASCII unchanged', () => {
    expect(toWinAnsi('Security Policy')).toBe('Security Policy');
  });

  it('substitutes the four Turkish-only letters with their ASCII counterpart', () => {
    expect(toWinAnsi('ığşĞİŞ')).toBe('igsGIS');
  });

  it('leaves ç/ö/ü (already in WinAnsi/Latin-1) unchanged', () => {
    expect(toWinAnsi('çöüÇÖÜ')).toBe('çöüÇÖÜ');
  });

  it('degrades anything outside the encodable range to "?" rather than corrupt the byte stream', () => {
    // A single emoji is one Unicode code point (a surrogate pair in UTF-16) -> one '?', not two.
    expect(toWinAnsi('emoji 🎉 here')).toBe('emoji ? here');
  });
});

describe('buildPdf — structure', () => {
  it('produces a well-formed PDF 1.4 header/trailer envelope', () => {
    const buf = buildPdf(header, [row()]);
    const text = bufferText(buf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('/BaseFont /Courier');
    expect(text).toContain('/Encoding /WinAnsiEncoding');
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    expect(text).toContain('startxref');
  });

  it('every listed xref offset points at the start of its own "N 0 obj" line', () => {
    const buf = buildPdf(header, [row(), row({ pageId: 'page-2' })]);
    const text = bufferText(buf);

    const xrefStart = text.lastIndexOf('xref');
    const trailerStart = text.indexOf('trailer', xrefStart);
    const xrefBlock = text.slice(xrefStart, trailerStart);
    // Line 0 is the "xref" keyword, line 1 is the "0 N" subsection header,
    // then one 20-byte entry per object number starting at 0 (the free-list
    // head, which has no "obj" of its own and is skipped below).
    const entryLines = xrefBlock.split('\n').slice(2).filter((l) => l.length > 0);

    entryLines.slice(1).forEach((line, i) => {
      const objNum = i + 1;
      const offset = Number(line.slice(0, 10));
      const atOffset = text.slice(offset, offset + `${objNum} 0 obj`.length);
      expect(atOffset).toBe(`${objNum} 0 obj`);
    });
  });

  it('produces exactly one page for a small row set', () => {
    const buf = buildPdf(header, [row()]);
    const text = bufferText(buf);
    expect((text.match(/\/Type \/Page(?!s)/g) ?? []).length).toBe(1);
  });

  it('paginates: enough rows to overflow one page produce more than one /Type /Page object', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row({ pageId: `page-${i}` }));
    const buf = buildPdf(header, rows);
    const text = bufferText(buf);
    const pageCount = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  });

  it('handles zero rows without throwing (still a valid, openable single-page document)', () => {
    const buf = buildPdf(header, []);
    const text = bufferText(buf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect((text.match(/\/Type \/Page(?!s)/g) ?? []).length).toBe(1);
  });
});

describe('buildPdf — content parity with the CSV rows (docs/07 §5)', () => {
  it('embeds the report header (scope, exported_at_utc, app version) once, not per row', () => {
    const buf = buildPdf(header, [row(), row({ pageId: 'page-2' })]);
    const text = bufferText(buf);
    const occurrences = text.split('scope: site').length - 1;
    expect(occurrences).toBe(1);
    expect(text).toContain('exported: 2026-07-09T13:00:00Z');
    expect(text).toContain('app v0.1.0');
  });

  it('embeds each row\'s account id and status as literal text', () => {
    const buf = buildPdf(header, [row({ userAccountId: 'acc-42', status: 'cannot-view' })]);
    const text = bufferText(buf);
    expect(text).toContain('acc-42');
    expect(text).toContain('cannot-view');
  });

  it('escapes parentheses in a page title so the PDF string literal stays balanced', () => {
    const buf = buildPdf(header, [row({ pageTitle: 'Policy (v3)' })]);
    const text = bufferText(buf);
    expect(text).toContain('Policy \\(v3');
  });

  it('a Turkish display name is substituted, never corrupting the byte stream', () => {
    const buf = buildPdf(header, [row({ userDisplayName: 'Ayşe Yılmaz' })]);
    const text = bufferText(buf);
    expect(text).toContain('Ayse Yilmaz');
  });

  it('a full Atlassian account id is never truncated (owner-reported, 2026-07-22: ACCOUNT ID column was too narrow)', () => {
    const accountId = '712020:1fff4957-4035-4b1a-a497-53928539ba88';
    const buf = buildPdf(header, [row({ userAccountId: accountId })]);
    const text = bufferText(buf);
    expect(text).toContain(accountId);
  });

  it('the "(unresolved)" space-key placeholder is never truncated (owner-reported, 2026-07-22: SPACE column was too narrow)', () => {
    const buf = buildPdf(header, [row({ spaceKey: '(unresolved)' })]);
    const text = bufferText(buf);
    // Parentheses are PDF string-literal special characters (escapePdfString) -- the full, unescaped placeholder is "(unresolved)".
    expect(text).toContain('\\(unresolved\\)');
  });
});
