import { CSV_BOM, toCsv, toCsvRow } from './csv';

describe('toCsvRow (RFC 4180, default comma delimiter)', () => {
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

describe('toCsvRow — semicolon delimiter (2026-07-22, Excel locale fix)', () => {
  it('joins cells with semicolons instead of commas', () => {
    expect(toCsvRow(['a', 'b', 1], ';')).toBe('a;b;1');
  });

  it('a comma no longer needs quoting once the delimiter is semicolon', () => {
    expect(toCsvRow(['Security, Policy'], ';')).toBe('Security, Policy');
  });

  it('a semicolon in the value does need quoting under the semicolon delimiter', () => {
    expect(toCsvRow(['Security; Policy'], ';')).toBe('"Security; Policy"');
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
  it('BOM-prefixes the file and CRLF-joins header + rows, comma delimiter by default', () => {
    const csv = toCsv(['col1', 'col2'], [['a', 1], ['b', null]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}col1,col2\r\na,1\r\nb,`);
  });

  it('produces just a header line for zero rows', () => {
    expect(toCsv(['col1'], [])).toBe(`${CSV_BOM}col1`);
  });

  it('uses semicolons throughout when passed the semicolon delimiter (2026-07-22, Excel locale fix)', () => {
    const csv = toCsv(['col1', 'col2'], [['a', 1]], ';');
    expect(csv).toBe(`${CSV_BOM}col1;col2\r\na;1`);
  });

  it('no longer prepends an Excel `sep=` directive line (reverted 2026-07-22: it stopped Excel honoring the UTF-8 BOM, corrupting Turkish letters) -- the delimiter itself now carries the fix', () => {
    const csv = toCsv(['col1'], [['a']]);
    expect(csv.startsWith(`${CSV_BOM}col1`)).toBe(true);
    expect(csv).not.toContain('sep=');
  });
});
