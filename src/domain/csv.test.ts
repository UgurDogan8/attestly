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
