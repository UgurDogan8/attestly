/**
 * The typed invoke contract between static/app (frontend) and src/ (resolvers).
 * Extend per resolver in T4/T9–T13; keep payloads JSON-serializable.
 */

/** Computed per data model §3 — never stored. */
export type UserStatus = 'confirmed' | 'expired' | 'outstanding' | 'cannot-view';

export type AssignmentType = 'assigned' | 'voluntary';

/** Resolver response envelope (tech design §8). */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (code: string, message: string): Result<never> => ({ ok: false, code, message });

/** TODO(T4): getPageStatus / confirm / getConfig / saveConfig payloads. */
export interface PageStatusResponse {
  status: UserStatus | null;
  pageVersion: number;
  dueDate: string | null;
  isAssigned: boolean;
}
