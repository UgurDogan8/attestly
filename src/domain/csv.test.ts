import { CSV_BOM, toCsv, toCsvRow } from './csv';

describe('toCsvRow (tab-delimited, see csv.ts docstring for the format history)', () => {
  it('joins plain cells with tabs, no quoting needed', () => {
    expect(toCsvRow(['a', 'b', 1])).toBe('a\tb\t1');
  });

  it('a comma no longer needs quoting -- it is not the delimiter', () => {
    expect(toCsvRow(['Security, Policy', 'x'])).toBe('Security, Policy\tx');
  });

  it('quotes a cell containing an actual tab', () => {
    expect(toCsvRow(['Security\tPolicy', 'x'])).toBe('"Security\tPolicy"\tx');
  });

  it('quotes a cell containing a double quote and doubles it', () => {
    expect(toCsvRow(['Say "hi"'])).toBe('"Say ""hi"""');
  });

  it('quotes a cell containing a newline', () => {
    expect(toCsvRow(['line1\nline2'])).toBe('"line1\nline2"');
  });

  it('renders null as an empty cell', () => {
    expect(toCsvRow(['a', null, 'c'])).toBe('a\t\tc');
  });
});

describe('toCsvRow — CSV/formula injection (CWE-1236)', () => {
  it('prefixes a "=" formula payload with a quote (e.g. a page title set to a HYPERLINK payload)', () => {
    expect(toCsvRow(['=1+1'])).toBe("'=1+1");
  });

  it('prefixes a leading "+", "-", or "@" the same way', () => {
    expect(toCsvRow(['+1+1'])).toBe("'+1+1");
    expect(toCsvRow(['-1+1'])).toBe("'-1+1");
    expect(toCsvRow(['@SUM(1)'])).toBe("'@SUM(1)");
  });

  it('does not touch a value with no formula-trigger leading character', () => {
    expect(toCsvRow(['Security Policy'])).toBe('Security Policy');
  });

  it('does not touch a numeric cell even if it happens to be negative', () => {
    expect(toCsvRow([-1])).toBe('-1');
  });

  it('still applies quoting after neutralizing when the payload also contains a tab', () => {
    expect(toCsvRow(['=A\tB'])).toBe('"\'=A\tB"');
  });
});

describe('toCsv', () => {
  it('BOM-prefixes the file and CRLF-joins tab-delimited header + rows', () => {
    const csv = toCsv(['col1', 'col2'], [['a', 1], ['b', null]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}col1\tcol2\r\na\t1\r\nb\t`);
  });

  it('produces just a header line for zero rows', () => {
    expect(toCsv(['col1'], [])).toBe(`${CSV_BOM}col1`);
  });

  it('never emits a comma or semicolon delimiter, and no Excel directive line (2026-07-22: both were tried and reverted)', () => {
    const csv = toCsv(['col1', 'col2'], [['Ayşe Yılmaz', 'Uğur DOĞAN']]);
    expect(csv).not.toContain('sep=');
    expect(csv).toContain('col1\tcol2');
    expect(csv).toContain('Ayşe Yılmaz\tUğur DOĞAN');
  });
});
