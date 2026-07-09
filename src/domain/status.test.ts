import { computeStatus, computePercentComplete, type StatusInput, type UserAssignmentStatus } from './status';

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    confirmedVersions: [],
    currentVersion: 1,
    reconfirmOnChange: false,
    canView: true,
    ...overrides,
  };
}

describe('computeStatus (data model §3 — normative algorithm)', () => {
  it('no records -> outstanding', () => {
    expect(computeStatus(input({ confirmedVersions: [] }))).toBe('outstanding');
  });

  it('record at the current version -> confirmed', () => {
    expect(computeStatus(input({ confirmedVersions: [7], currentVersion: 7, reconfirmOnChange: true }))).toBe(
      'confirmed',
    );
  });

  it('record at an older version, reconfirm OFF -> confirmed', () => {
    expect(computeStatus(input({ confirmedVersions: [5], currentVersion: 7, reconfirmOnChange: false }))).toBe(
      'confirmed',
    );
  });

  it('record at an older version, reconfirm ON -> expired', () => {
    expect(computeStatus(input({ confirmedVersions: [5], currentVersion: 7, reconfirmOnChange: true }))).toBe(
      'expired',
    );
  });

  it('multiple records -> the latest (max) version wins', () => {
    expect(
      computeStatus(input({ confirmedVersions: [2, 7, 4], currentVersion: 7, reconfirmOnChange: true })),
    ).toBe('confirmed');
    expect(
      computeStatus(input({ confirmedVersions: [2, 5, 4], currentVersion: 7, reconfirmOnChange: true })),
    ).toBe('expired');
  });

  it('no view permission -> cannot-view regardless of records', () => {
    expect(computeStatus(input({ canView: false, confirmedVersions: [] }))).toBe('cannot-view');
    expect(
      computeStatus(input({ canView: false, confirmedVersions: [7], currentVersion: 7 })),
    ).toBe('cannot-view');
  });

  it('cannot-view takes precedence even for a user who previously confirmed the current version', () => {
    expect(
      computeStatus(
        input({ canView: false, confirmedVersions: [7], currentVersion: 7, reconfirmOnChange: false }),
      ),
    ).toBe('cannot-view');
  });

  it('is a pure function: identical inputs always produce identical output (data model invariant 4)', () => {
    const sample = input({ confirmedVersions: [3, 5], currentVersion: 5, reconfirmOnChange: true });
    const results = Array.from({ length: 20 }, () => computeStatus(sample));
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('confirmed');
  });
});

function assigned(status: UserAssignmentStatus['status']): UserAssignmentStatus {
  return { status, assignmentType: 'assigned' };
}

function voluntary(status: UserAssignmentStatus['status']): UserAssignmentStatus {
  return { status, assignmentType: 'voluntary' };
}

describe('computePercentComplete (data model §3 — "% complete")', () => {
  it('0 assigned (voluntary-only page) -> none, not 0%', () => {
    expect(computePercentComplete([voluntary('confirmed'), voluntary('outstanding')])).toEqual({ kind: 'none' });
    expect(computePercentComplete([])).toEqual({ kind: 'none' });
  });

  it('every assigned user is cannot-view -> none, not a divide-by-zero 0%', () => {
    expect(computePercentComplete([assigned('cannot-view'), assigned('cannot-view')])).toEqual({ kind: 'none' });
  });

  it('cannot-view users are excluded from the denominator, not counted as outstanding', () => {
    const result = computePercentComplete([assigned('confirmed'), assigned('cannot-view'), assigned('outstanding')]);
    expect(result).toEqual({ kind: 'value', percent: 0.5, confirmedCount: 1, eligibleCount: 2 });
  });

  it('voluntary confirmations never enter the percentage, even when confirmed', () => {
    const result = computePercentComplete([
      assigned('confirmed'),
      assigned('outstanding'),
      voluntary('confirmed'),
      voluntary('confirmed'),
    ]);
    // Only the two assigned users count: 1 of 2 confirmed = 50%, unaffected
    // by the two extra voluntary confirmations.
    expect(result).toEqual({ kind: 'value', percent: 0.5, confirmedCount: 1, eligibleCount: 2 });
  });

  it('expired counts toward the denominator but not the numerator', () => {
    const result = computePercentComplete([assigned('confirmed'), assigned('expired')]);
    expect(result).toEqual({ kind: 'value', percent: 0.5, confirmedCount: 1, eligibleCount: 2 });
  });

  it('all confirmed -> 100%', () => {
    const result = computePercentComplete([assigned('confirmed'), assigned('confirmed')]);
    expect(result).toEqual({ kind: 'value', percent: 1, confirmedCount: 2, eligibleCount: 2 });
  });
});
