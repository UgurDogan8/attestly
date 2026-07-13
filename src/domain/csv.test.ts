import { CSV_BOM, toCsv, toCsvRow } from './csv';

describe('toCsvRow (RFC 4180)', () => {
  it('joins plain cells with commas, no quoting needed', () => {
    expect(toCsvRow(['a', 'b', 1])).toBe('a,b,1');
  });

  it('quotes a cell containing a comma', () => {
    expect(toCsvRow(['Security, Policy', 'x'])).toBe('"Security, Policy",x');
  });

  it('quotes a cell containing a double quote and doubles it', () => {
    expect(toCsvRow(['Say "hi"'])).toBe('"Say ""hi"""');
  });

  it('quotes a cell containing a newline', () => {
    expect(toCsvRow(['line1\nline2'])).toBe('"line1\nline2"');
  });

  it('renders null as an empty cell', () => {
    expect(toCsvRow(['a', null, 'c'])).toBe('a,,c');
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

  it('still applies RFC 4180 quoting after neutralizing when the payload also contains a comma', () => {
    expect(toCsvRow(['=A,B'])).toBe('"\'=A,B"');
  });
});

describe('toCsv', () => {
  it('BOM-prefixes the file and CRLF-joins header + rows', () => {
    const csv = toCsv(['col1', 'col2'], [['a', 1], ['b', null]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}col1,col2\r\na,1\r\nb,`);
  });

  it('produces just a header line for zero rows', () => {
    expect(toCsv(['col1'], [])).toBe(`${CSV_BOM}col1`);
  });
});
