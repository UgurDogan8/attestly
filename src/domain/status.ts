/**
 * Status computation — data model §3 is the normative algorithm.
 *
 * RULES (data model §7 invariants, enforced by tests + eslint.config.js's
 * src/domain override):
 *  - Pure functions only: no Forge imports, no clock reads, no I/O.
 *  - Status is always computed, never stored (tech design §6.2).
 *  - `reconfirmOnChange` is derived purely from (latest confirmed version,
 *    current page version, config) — never from whether a page-updated
 *    event happened to fire (tech design §6.2: events can be missed,
 *    version comparison cannot be wrong).
 *
 * `page-deleted` (data model §3.1) is intentionally NOT a member of
 * UserStatus: it is a page-level state resolved lazily by the caller
 * (a 404 on page read) *before* per-user status is computed at all — a
 * deleted page never reaches computeStatus for any user.
 */
import type { AssignmentType, UserStatus } from '../shared';

export interface StatusInput {
  /** Confirmation record versions for (user, page), if any. */
  confirmedVersions: number[];
  /** Current published page version, server-read. */
  currentVersion: number;
  reconfirmOnChange: boolean;
  canView: boolean;
}

/**
 * data model §3's ordered rules, applied exactly in this precedence:
 * cannot-view (even if previously confirmed) > outstanding (no records) >
 * confirmed > expired.
 */
export function computeStatus(input: StatusInput): UserStatus {
  const { confirmedVersions, currentVersion, reconfirmOnChange, canView } = input;

  if (!canView) {
    return 'cannot-view';
  }

  if (confirmedVersions.length === 0) {
    return 'outstanding';
  }

  const latestVersion = Math.max(...confirmedVersions);

  if (latestVersion === currentVersion || !reconfirmOnChange) {
    return 'confirmed';
  }

  return 'expired';
}

/** One user's computed status plus how they relate to the page (data model §3). */
export interface UserAssignmentStatus {
  status: UserStatus;
  assignmentType: AssignmentType;
}

export type PercentComplete =
  | { kind: 'none' }
  | { kind: 'value'; percent: number; confirmedCount: number; eligibleCount: number };

/**
 * "% complete" (data model §3): confirmed ÷ (assigned, excluding cannot-view).
 * Voluntary confirmations never enter the calculation (PRD A4) — they are
 * filtered out here, not left to the caller. `cannot-view` users are excluded
 * from the denominator, never silently folded into outstanding (PRD B1).
 * Zero eligible users — whether because nobody is assigned (voluntary-only
 * page) or because every assignee happens to be cannot-view — has no
 * meaningful percentage and renders "—", not 0% (UX §5): both cases return
 * `{ kind: 'none' }` rather than dividing by zero or lying with a number.
 */
export function computePercentComplete(users: UserAssignmentStatus[]): PercentComplete {
  const eligible = users.filter((u) => u.assignmentType === 'assigned' && u.status !== 'cannot-view');

  if (eligible.length === 0) {
    return { kind: 'none' };
  }

  const confirmedCount = eligible.filter((u) => u.status === 'confirmed').length;

  return {
    kind: 'value',
    percent: confirmedCount / eligible.length,
    confirmedCount,
    eligibleCount: eligible.length,
  };
}
