import type { AssignmentType } from '../shared';

/**
 * The audit record shape (data model §2.1). Append-only: nothing in this
 * codebase updates or deletes a value at this record's key once written
 * (data model §1, §7 invariant 1) — storage/confirmations.ts is the only
 * module allowed to write it, and it never exposes an update/delete path
 * (see storage/confirmations.test.ts).
 */
export interface ConfirmationRecord {
  pageId: string;
  spaceKey: string;
  pageVersion: number;
  accountId: string;
  /** ISO 8601 UTC, server clock — never client-supplied (data model invariant 5). */
  confirmedAt: string;
  assignmentType: AssignmentType;
  appVersion: string;
  schemaVersion: number;
}
