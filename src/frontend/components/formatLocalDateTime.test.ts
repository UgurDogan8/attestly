import { formatLocalDateTime, formatLocalDate } from './formatLocalDateTime';

// The *timezone* half of these functions always follows the runtime's own
// timezone (UX doc R3) -- which means the exact rendered string legitimately
// differs by machine (confirmed while writing this test: this sandbox's OS
// timezone renders 14:03 for an 11:03 UTC input, i.e. UTC+3). Assertions
// below mostly check structure/behavior, not a literal string, so the suite
// passes identically in CI and on any contributor's machine. The *language*
// half (review finding: dates must follow the app's resolved en/tr locale,
// not the browser's) is asserted literally below, since 'en' vs 'tr' is a
// value this code controls directly, not the OS.

describe('formatLocalDateTime', () => {
  it('includes the year from the input', () => {
    expect(formatLocalDateTime('2026-07-12T11:03:00.000Z', 'en')).toContain('2026');
  });

  it('includes a time component (contains a colon)', () => {
    expect(formatLocalDateTime('2026-07-12T11:03:00.000Z', 'en')).toContain(':');
  });

  it('different timestamps produce different output', () => {
    const a = formatLocalDateTime('2026-07-12T11:03:00.000Z', 'en');
    const b = formatLocalDateTime('2020-01-01T00:00:00.000Z', 'en');
    expect(a).not.toBe(b);
  });

  it('is a pure function: same input always produces the same output', () => {
    const results = new Set(Array.from({ length: 5 }, () => formatLocalDateTime('2026-01-01T00:00:00.000Z', 'en')));
    expect(results.size).toBe(1);
  });

  it('follows the passed locale, not the runtime default (review finding)', () => {
    const en = formatLocalDateTime('2026-07-12T11:03:00.000Z', 'en');
    const tr = formatLocalDateTime('2026-07-12T11:03:00.000Z', 'tr');
    expect(en).not.toBe(tr);
    expect(en).toContain('Jul');
    expect(tr).toContain('Tem');
  });
});

describe('formatLocalDate', () => {
  it('includes the year from the input', () => {
    expect(formatLocalDate('2026-08-15', 'en')).toContain('2026');
  });

  it('has no time component (date model §2.2: dueDate has no time)', () => {
    expect(formatLocalDate('2026-08-15', 'en')).not.toContain(':');
  });

  it('different dates produce different output', () => {
    expect(formatLocalDate('2026-08-15', 'en')).not.toBe(formatLocalDate('2026-01-01', 'en'));
  });

  it('follows the passed locale, not the runtime default (review finding)', () => {
    const en = formatLocalDate('2026-08-15', 'en');
    const tr = formatLocalDate('2026-08-15', 'tr');
    expect(en).not.toBe(tr);
    expect(en).toContain('Aug');
    expect(tr).toContain('Ağu');
  });

  describe('west-of-UTC viewer (regression: this repo\'s own CI/dev machines are UTC+3 or later, so this exact bug -- a date-only string parsed as UTC-midnight, then formatted in the viewer\'s local timezone -- never showed up in any manual test east of UTC)', () => {
    const originalTz = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = 'America/Los_Angeles'; // UTC-7/-8: any date-only string parsed as UTC midnight renders one day early here if the bug is present.
    });

    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it('renders the stored calendar day, not the previous day', () => {
      const formatted = formatLocalDate('2026-08-15', 'en');
      expect(formatted).toContain('15');
      expect(formatted).not.toContain('14');
    });
  });
});
