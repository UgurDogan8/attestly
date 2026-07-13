import { formatLocalDateTime, formatLocalDate } from './formatLocalDateTime';

// These functions deliberately use Intl.DateTimeFormat(undefined, ...) so
// output follows the *viewer's own* browser locale/timezone (UX doc R3) --
// which means the exact rendered string legitimately differs by machine
// (confirmed while writing this test: this sandbox's OS locale/timezone
// renders "12 Tem 2026 14:03", Turkish + UTC+3, not an English/UTC string).
// Assertions below check structure/behavior, not a literal string, so the
// suite passes identically in CI and on any contributor's machine.

describe('formatLocalDateTime', () => {
  it('includes the year from the input', () => {
    expect(formatLocalDateTime('2026-07-12T11:03:00.000Z')).toContain('2026');
  });

  it('includes a time component (contains a colon)', () => {
    expect(formatLocalDateTime('2026-07-12T11:03:00.000Z')).toContain(':');
  });

  it('different timestamps produce different output', () => {
    const a = formatLocalDateTime('2026-07-12T11:03:00.000Z');
    const b = formatLocalDateTime('2020-01-01T00:00:00.000Z');
    expect(a).not.toBe(b);
  });

  it('is a pure function: same input always produces the same output', () => {
    const results = new Set(Array.from({ length: 5 }, () => formatLocalDateTime('2026-01-01T00:00:00.000Z')));
    expect(results.size).toBe(1);
  });
});

describe('formatLocalDate', () => {
  it('includes the year from the input', () => {
    expect(formatLocalDate('2026-08-15')).toContain('2026');
  });

  it('has no time component (date model §2.2: dueDate has no time)', () => {
    expect(formatLocalDate('2026-08-15')).not.toContain(':');
  });

  it('different dates produce different output', () => {
    expect(formatLocalDate('2026-08-15')).not.toBe(formatLocalDate('2026-01-01'));
  });

  describe('west-of-UTC viewer (regression: this repo\'s own CI/dev machines are UTC+3 or later, so this exact bug — a date-only string parsed as UTC-midnight, then formatted in the viewer\'s local timezone — never showed up in any manual test east of UTC)', () => {
    const originalTz = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = 'America/Los_Angeles'; // UTC-7/-8: any date-only string parsed as UTC midnight renders one day early here if the bug is present.
    });

    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it('renders the stored calendar day, not the previous day', () => {
      const formatted = formatLocalDate('2026-08-15');
      expect(formatted).toContain('15');
      expect(formatted).not.toContain('14');
    });
  });
});
