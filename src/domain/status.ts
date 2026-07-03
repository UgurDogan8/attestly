/**
 * Status computation — data model §3 is the normative algorithm.
 *
 * RULES (data model §7 invariants, enforced by tests in T3):
 *  - Pure functions only: no Forge imports, no clock reads, no I/O.
 *  - Status is always computed, never stored (tech design §6.2).
 *
 * TODO(T3): implement computeStatus + % complete per data model §3.
 */
import type { UserStatus } from '@acknowledge/shared';

export interface StatusInput {
  /** Confirmation record versions for (user, page), if any. */
  confirmedVersions: number[];
  /** Current published page version, server-read. */
  currentVersion: number;
  reconfirmOnChange: boolean;
  canView: boolean;
}

export function computeStatus(_input: StatusInput): UserStatus {
  throw new Error('TODO(T3): data model §3');
}
