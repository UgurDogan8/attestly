/**
 * CSV export row shaping (data model §4, normative — column order and rules
 * below are copied verbatim from that spec). Pure: every field arrives
 * already resolved (title, display name, status) — no Forge imports, no
 * clock reads (ESLint-enforced, same as status.ts). `exportedAtUtc` is a
 * caller-supplied value precisely so this file never reads the clock itself.
 */
import type { AssignmentType, UserStatus } from '../shared';

export interface ExportRow {
  pageTitle: string;
  pageId: string;
  spaceKey: string;
  /** empty when status is outstanding/cannot-view (data model §4). */
  pageVersionConfirmed: number | null;
  userDisplayName: string;
  userAccountId: string;
  assignmentType: AssignmentType;
  status: UserStatus;
  confirmedAtUtc: string | null;
  dueDate: string | null;
  exportedAtUtc: string;
  appVersion: string;
}

/** Exact column order (data model §4) — never reorder without updating that spec. */
export const CSV_HEADER = [
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
];

export function exportRowToCsvCells(row: ExportRow): (string | number | null)[] {
  return [
    row.pageTitle,
    row.pageId,
    row.spaceKey,
    row.pageVersionConfirmed,
    row.userDisplayName,
    row.userAccountId,
    row.assignmentType,
    row.status,
    row.confirmedAtUtc,
    row.dueDate,
    row.exportedAtUtc,
    row.appVersion,
  ];
}

/**
 * Row-level date-range filter (data model §4: "date range applies to
 * confirmed_at_utc"). Outstanding/cannot-view rows have no confirmedAtUtc
 * and always pass — a date range narrows which *confirmations* appear, it
 * never hides the negative space a date-ranged audit still needs (PRD F1).
 * Bounds are ISO date strings (`YYYY-MM-DD`); a UTC timestamp compares
 * correctly against them lexicographically up to the date portion.
 */
/** Filename convention shared by CSV (assembled client-side, `static/export-ui/src/main.ts`) and PDF (assembled server-side, `resolvers/export.ts`'s `buildPdfExport`) — kept here so neither has to import the other's module. */
export function exportFilename(scope: string, exportedAtUtc: string, extension: 'csv' | 'pdf'): string {
  return `read-confirmations_${scope}_${exportedAtUtc.slice(0, 10)}.${extension}`;
}

export function matchesDateRange(row: ExportRow, dateFrom: string | undefined, dateTo: string | undefined): boolean {
  if (!row.confirmedAtUtc) {
    return true;
  }
  const date = row.confirmedAtUtc.slice(0, 10);
  if (dateFrom && date < dateFrom) {
    return false;
  }
  if (dateTo && date > dateTo) {
    return false;
  }
  return true;
}
