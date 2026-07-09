/**
 * The typed invoke contract between src/frontend (UI Kit) and src/resolvers.
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

/** getPageStatus (macro, byline — tech design §4). Single round-trip renders the whole surface. */
export interface PageStatusPayload {
  pageId: string;
}

/**
 * `status` is never null: if the page itself can't be read for the current
 * viewer, the resolver returns the error envelope instead of a success
 * payload with a null status (data model §3's `cannot-view` branch is for
 * an admin checking an *other* user's access, e.g. drill-down T10 — the
 * viewer of their own macro can, by definition, already view the page they
 * are looking at).
 */
export interface PageStatusResponse {
  status: UserStatus;
  pageVersion: number;
  dueDate: string | null;
  isAssigned: boolean;
  /** UTC ISO timestamp of the latest confirmation, if any (R3: "You
   * confirmed version {v} on {datetime}" needs this on page load, not just
   * right after a fresh confirm click). Null when status is outstanding/expired. */
  confirmedAt: string | null;
  /** Whether the *current* user could open the config modal (T7: page edit
   * permission OR compliance manager) — a UX hint only, so the macro can
   * decide whether to show the "Configure" button at all. getConfig/
   * saveConfig independently re-check this server-side regardless; a client
   * that never saw this flag (or a forged true) still can't bypass the gate. */
  canConfigure: boolean;
}

/** confirm (macro — tech design §4/§6.1/§6.3). */
export interface ConfirmPayload {
  pageId: string;
  /** Version the client rendered when the user clicked confirm — used only
   * to detect drift against the server-read version (§6.3); never trusted
   * as the version actually recorded. */
  pageVersion: number;
}

export type ConfirmResponse =
  | { outcome: 'confirmed'; status: UserStatus; pageVersion: number; confirmedAt: string }
  /** §6.3: the page changed between render and click. Nothing is written;
   * the UI should prompt the user to review the new version before retrying. */
  | { outcome: 'pageChanged'; currentVersion: number };

/** getConfig / saveConfig (macro config modal, dashboard — tech design §4). */
export interface GetConfigPayload {
  pageId: string;
}

export interface SaveConfigPayload {
  pageId: string;
  assignedUsers: string[];
  assignedGroups: string[];
  dueDate: string | null;
  reconfirmOnChange: boolean;
}

export interface ConfigResponse {
  pageId: string;
  assignedUsers: string[];
  assignedGroups: string[];
  /** `assignedGroups` with names resolved (data model §2.2 only stores IDs)
   * — lets the config modal pre-populate the group field with real labels
   * instead of raw IDs. Best-effort: a group that fails to resolve (e.g.
   * deleted) is simply omitted here while its ID stays in `assignedGroups`. */
  assignedGroupOptions: GroupOption[];
  dueDate: string | null;
  reconfirmOnChange: boolean;
}

/**
 * searchGroups (T7 config modal — group picker). @forge/react's UserPicker
 * is self-contained (searches Confluence's user directory internally); no
 * equivalent GroupPicker component exists in this UI Kit version, so group
 * search is our own resolver over the classic group-picker REST endpoint.
 */
export interface SearchGroupsPayload {
  pageId: string;
  query: string;
}

export interface GroupOption {
  id: string;
  name: string;
}
