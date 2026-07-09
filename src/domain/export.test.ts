import { CSV_HEADER, exportRowToCsvCells, matchesDateRange, type ExportRow } from './export';

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    pageTitle: 'Security Policy',
    pageId: 'page-1',
    spaceKey: 'SEC',
    pageVersionConfirmed: 1,
    userDisplayName: 'Ayşe Yılmaz',
    userAccountId: 'acc-1',
    assignmentType: 'assigned',
    status: 'confirmed',
    confirmedAtUtc: '2026-07-09T12:00:00.000Z',
    dueDate: null,
    exportedAtUtc: '2026-07-09T13:00:00.000Z',
    appVersion: '0.1.0',
    ...overrides,
  };
}

describe('CSV_HEADER / exportRowToCsvCells (data model §4 — exact column order)', () => {
  it('matches the normative column order exactly', () => {
    expect(CSV_HEADER).toEqual([
      'page_title',
      'page_id',
      'space_key',
      'page_version_confirmed',
      'user_display_name',
      'user_account_id',
      'assignment_type',
      'status',
      'confirmed_at_utc',
      'due_date',
      'exported_at_utc',
      'app_version',
    ]);
  });

  it('shapes a row into cells in that same order', () => {
    expect(exportRowToCsvCells(row())).toEqual([
      'Security Policy',
      'page-1',
      'SEC',
      1,
      'Ayşe Yılmaz',
      'acc-1',
      'assigned',
      'confirmed',
      '2026-07-09T12:00:00.000Z',
      null,
      '2026-07-09T13:00:00.000Z',
      '0.1.0',
    ]);
  });
});

describe('matchesDateRange', () => {
  it('always matches a row with no confirmedAtUtc (outstanding/cannot-view rows survive date filters)', () => {
    expect(matchesDateRange(row({ confirmedAtUtc: null }), '2026-01-01', '2026-01-31')).toBe(true);
  });

  it('matches when no range is given', () => {
    expect(matchesDateRange(row(), undefined, undefined)).toBe(true);
  });

  it('excludes a confirmation before dateFrom', () => {
    expect(matchesDateRange(row({ confirmedAtUtc: '2026-06-01T00:00:00.000Z' }), '2026-07-01', undefined)).toBe(false);
  });

  it('excludes a confirmation after dateTo', () => {
    expect(matchesDateRange(row({ confirmedAtUtc: '2026-08-01T00:00:00.000Z' }), undefined, '2026-07-31')).toBe(false);
  });

  it('includes a confirmation on the boundary dates (inclusive)', () => {
    expect(matchesDateRange(row({ confirmedAtUtc: '2026-07-01T23:59:00.000Z' }), '2026-07-01', '2026-07-01')).toBe(true);
  });
});
