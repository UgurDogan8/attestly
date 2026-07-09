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
 * searchGroups (T7 config modal — group picker; also T13 settings' managers
 * picker). @forge/react's UserPicker is self-contained (searches
 * Confluence's user directory internally); no equivalent GroupPicker
 * component exists in this UI Kit version, so group search is our own
 * resolver over the classic group-picker REST endpoint. `pageId` is
 * present only for the T7 call site (gates on canConfigure(pageId, ...));
 * omitted from the T13 settings call site, which gates on isConfluenceAdmin
 * instead — see resolvers/index.ts's searchGroups handler.
 */
export interface SearchGroupsPayload {
  pageId?: string;
  query: string;
}

export interface GroupOption {
  id: string;
  name: string;
}

/**
 * getDashboard (T9 dashboard global page — tech design §4/§5/§9). Role
 * gate: compliance-managers group only in v1 (§7 Riskler-style disclosed
 * scope tradeoff — see src/resolvers/dashboard.ts's docstring: "OR
 * Confluence admin" needs a scope this app doesn't have yet and an
 * unverified operations/targetType check, deferred rather than guessed at).
 */
export type StatusFilter = 'all' | 'incomplete' | 'complete' | 'overdue';

export interface GetDashboardPayload {
  cursor?: string;
  spaceKey?: string;
  statusFilter?: StatusFilter;
}

/** Same shape as domain/status.ts's PercentComplete, re-declared here (not
 * imported) to keep the invoke contract independent of the domain layer's
 * internal types. */
export type PercentSummary =
  | { kind: 'none' }
  | { kind: 'value'; percent: number; confirmedCount: number; eligibleCount: number };

export interface DashboardRow {
  pageId: string;
  /** null when `deleted` — data model §6.4: never leak a restricted/deleted page's title. */
  title: string | null;
  deleted: boolean;
  spaceKey: string;
  /** Direct assigned users only (see dashboard.ts docstring — a disclosed
   * simplification; group-resolved counts are exact only in drill-down, T10). */
  assignedCount: number;
  percent: PercentSummary;
  dueDate: string | null;
  overdue: boolean;
}

export interface GetDashboardResponse {
  rows: DashboardRow[];
  nextCursor: string | null;
}

/**
 * getPageDetail (T10 drill-down — UX doc §3.3, tech design §4 resolver
 * table). Unlike getDashboard, group membership is resolved fresh on every
 * call and cannot-view is checked per user — a bounded, single-page
 * operation (data model §2.2's soft assignee cap), not the list-wide
 * fan-out getDashboard deliberately avoids (dashboard.ts's docstring).
 */
export interface GetPageDetailPayload {
  pageId: string;
}

export type AssignmentSource = { kind: 'direct' } | { kind: 'group'; groupId: string; groupName: string | null };

export interface DetailUserRow {
  accountId: string;
  status: UserStatus;
  assignmentType: AssignmentType;
  /** null only for voluntary rows — they aren't assigned via anything. */
  assignmentSource: AssignmentSource | null;
  /** Latest confirmed version for this user, if any. */
  pageVersion: number | null;
  confirmedAt: string | null;
  /** 404 from the permission-check API (tech design §4): the account was
   * erased, not merely lacking permission. Still bucketed under cannot-view
   * (they can never act again either way) but flagged so the UI can render
   * "[deleted user]" instead of implying a fixable access problem. */
  deletedUser: boolean;
}

export interface PageDetailSummary {
  assigned: number;
  confirmed: number;
  outstanding: number;
  cannotView: number;
}

export interface GetPageDetailResponse {
  pageId: string;
  /** null when the page can't be resolved to a title (deleted — data model §3.1). */
  title: string | null;
  deleted: boolean;
  /** null only when `deleted` — there is no current version of a page that no longer exists. */
  currentVersion: number | null;
  summary: PageDetailSummary;
  /** Includes `expired` rows (v1: reconfirmOnChange is off by default, T7 —
   * this bucket is practically always "never confirmed" in v1, but the field
   * stays UserStatus-typed so a row can still render the v1.1 expired note). */
  outstanding: DetailUserRow[];
  confirmed: DetailUserRow[];
  voluntary: DetailUserRow[];
  cannotView: DetailUserRow[];
  /** Assigned group IDs that no longer resolve to a name (data model's
   * degraded-states table: "group deleted — members no longer counted").
   * Empty when every assigned group still exists. */
  staleAssignedGroupIds: string[];
}

/** getPageHistory (T10 History tab — data model §2.4, UX doc §3.3). */
export interface GetPageHistoryPayload {
  pageId: string;
  cursor?: string;
}

export interface HistoryEntryView {
  at: string;
  actor: string;
  entry: Record<string, unknown>;
}

export interface GetPageHistoryResponse {
  entries: HistoryEntryView[];
  nextCursor: string | null;
}

/**
 * startExport (T11/T12 — docs/07 §5, data model §4). `format` selects which
 * serializer the export webtrigger uses over the exact same rows (docs/07
 * §5: "CSV + PDF come from the same export.ts rows -> record parity
 * guaranteed") — no separate resolver or job shape per format.
 */
export type ExportFormat = 'csv' | 'pdf';
export type ExportScope = 'page' | 'space' | 'site';

export interface StartExportPayload {
  format: ExportFormat;
  scope: ExportScope;
  /** pageId when scope="page", spaceKey when scope="space"; omitted when scope="site". */
  scopeValue?: string;
  /** Same semantics as getDashboard's filter (docs/04 §3.4): narrows which
   * PAGES are in scope, never which per-user rows within an included page —
   * outstanding rows must survive the filter (PRD F1 "auditors need the
   * negative space"). */
  statusFilter?: StatusFilter;
  /** ISO 8601 dates (inclusive). Filters which rows' confirmed_at_utc falls
   * in range — never excludes outstanding/cannot-view rows, which have no
   * confirmed_at_utc to filter on (data model §4). */
  dateFrom?: string;
  dateTo?: string;
}

export interface StartExportResponse {
  url: string;
}

/**
 * getSettings / saveSettings (T13, docs/04 §3.5, data model §2.3). Gated on
 * isConfluenceAdmin alone (resolvers/auth.ts) — deliberately NOT
 * compliance-manager-accessible, since this page is where the
 * compliance-managers group itself gets configured (auth.ts's
 * isComplianceManager docstring explains the bootstrap reasoning).
 */
export type GetSettingsPayload = Record<string, never>;

export interface GetSettingsResponse {
  complianceManagersGroupId: string | null;
  /** Resolved for display the same way T7's config modal resolves assigned
   * group names — best-effort, null if the group no longer exists. */
  complianceManagersGroupName: string | null;
  reconfirmDefault: boolean;
}

export interface SaveSettingsPayload {
  complianceManagersGroupId: string | null;
  reconfirmDefault: boolean;
}
