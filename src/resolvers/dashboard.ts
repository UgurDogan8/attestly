import api, { route } from '@forge/api';
import { computeAdvisoryPercent } from '../domain/status';
import { isComplianceManager } from './auth';
import { queryTrackedPage, type PageConfigRecord } from '../storage/configs';
import { ok, err, type Result, type GetDashboardPayload, type GetDashboardResponse, type DashboardRow, type StatusFilter } from '../shared';

/**
 * Dashboard row assembly (docs/06 T9, UX doc §3.2, tech design §4/§5/§9).
 *
 * Role gate: "admin or compliance-managers group" (T9's own accept
 * criteria), implemented in full as of T13 — isComplianceManager (auth.ts)
 * now checks isConfluenceAdmin() first. That admin check's own residual
 * (the `targetType: "application"` signal is community-documented, not
 * Atlassian's own published reference) is disclosed and fails closed in
 * auth.ts's docstring, not repeated here.
 *
 * Visibility rule (tech design §4, normative): resolvePageVisibility does
 * ONE bulk asUser() read (`GET /wiki/api/v2/pages?id=a,b,c`, confirmed via
 * Atlassian's v2 API docs this task: "Only pages that the user has
 * permission to view will be returned") for however many tracked pages are
 * in the current KVS page, then an asApp() existence probe ONLY for the
 * pages missing from that bulk response (bounded by exceptions, not every
 * row) to tell deleted (404) apart from viewer-restricted (200, omitted
 * entirely). This is the one place asApp() answers a question about
 * content the viewer might not be able to see themselves — limited to
 * "does it exist at all", never its title or content.
 *
 * "Never fan out across confirmation records" (tech design §5): row counts
 * come from the page-config's advisory aggregate fields only
 * (assignedUsers.length, counters.confirmedCurrentVersion via
 * computeAdvisoryPercent) — no per-page confirmation query runs here.
 * Exact per-user truth is drill-down's job (T10).
 *
 * Disclosed simplification: `assignedCount` is direct-assigned-users only,
 * not group-resolved. Resolving full membership for every assigned group
 * of every tracked page on every list load would itself be an expensive
 * fan-out (the thing tech design §5 says to avoid) — group-resolved counts
 * are exact only in drill-down (T10), which is bounded per-page, not
 * per-list. `spaceKey` likewise comes from the page-config's own
 * denormalized value, not a fresh per-row space lookup — data model §2.2
 * explicitly tolerates this going stale if a page moves.
 */

export type PageVisibility =
  | { kind: 'visible'; title: string; version?: number }
  | { kind: 'deleted' }
  | { kind: 'restricted' };

interface BulkPagesResponse {
  results?: { id: string; title: string; version?: { number: number } }[];
}

/** Confluence v2 pages GET's own page cap; matches this app's own MAX_PAGE_SIZE chunking. */
const BULK_FETCH_LIMIT = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Bug fix (PR review, T11 export): a single un-chunked request here silently
 * capped at `BULK_FETCH_LIMIT` results — callers passing more than 100 ids
 * (site/space export via `drainTrackedPages`) got every id beyond the first
 * page misread as "missing from the bulk response" and, since the existence
 * probe below fails closed to `restricted` on any non-404 status, a real,
 * viewable page got silently dropped rather than exported. The dashboard
 * itself never hit this (it only ever passes one KVS page's worth of ids,
 * already ≤ `MAX_PAGE_SIZE` = `BULK_FETCH_LIMIT`), which is why no test
 * caught it. One bulk request per `BULK_FETCH_LIMIT`-sized batch fixes every
 * caller from this one shared place.
 */
export async function resolvePageVisibility(pageIds: string[]): Promise<Map<string, PageVisibility>> {
  const result = new Map<string, PageVisibility>();
  if (pageIds.length === 0) {
    return result;
  }

  await Promise.all(
    chunk(pageIds, BULK_FETCH_LIMIT).map(async (batch) => {
      try {
        const idsParam = batch.join(',');
        const response = await api
          .asUser()
          .requestConfluence(route`/wiki/api/v2/pages?id=${idsParam}&limit=${BULK_FETCH_LIMIT}`, {
            headers: { Accept: 'application/json' },
          });
        if (response.ok) {
          const body = (await response.json()) as BulkPagesResponse;
          for (const page of body.results ?? []) {
            result.set(page.id, { kind: 'visible', title: page.title, version: page.version?.number });
          }
        }
      } catch {
        // Every id in this batch falls through to the existence probe below.
      }
    }),
  );

  const missing = pageIds.filter((id) => !result.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        const probe = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${id}`, {
          headers: { Accept: 'application/json' },
        });
        // 404 -> trashed/purged (data model §3.1: page-deleted). Any other
        // status (200 restricted, or an unexpected error status) fails
        // closed to "restricted" -- omitted entirely, never a guess at content.
        result.set(id, probe.status === 404 ? { kind: 'deleted' } : { kind: 'restricted' });
      } catch {
        result.set(id, { kind: 'restricted' });
      }
    }),
  );

  return result;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns null for a restricted (viewer-invisible) page -- omit the row entirely. */
export function buildDashboardRow(config: PageConfigRecord, visibility: PageVisibility): DashboardRow | null {
  if (visibility.kind === 'restricted') {
    return null;
  }

  const deleted = visibility.kind === 'deleted';
  const assignedCount = config.assignedUsers.length;
  // data model §3.1: a deleted page is excluded from % complete entirely,
  // not computed from its (now frozen, possibly stale) counters.
  const percent = deleted ? { kind: 'none' as const } : computeAdvisoryPercent(assignedCount, config.counters.confirmedCurrentVersion);
  const isComplete = percent.kind === 'value' && percent.percent >= 1;
  // Bug found in review (2026-07-12): `overdue` used to also require
  // `percent.kind === 'value'`, which requires `assignedCount > 0` --
  // direct users only (the disclosed simplification above never resolves
  // group membership for the list view). A page assigned *only* via a
  // group (assignedUsers: [], assignedGroups: ['x']) always had
  // `assignedCount === 0`, so `percent` was always `{kind:'none'}` and the
  // page could never be flagged overdue no matter how late it was --
  // silently exempting the exact assignment style the UX copy itself
  // recommends ("For teams, prefer groups"). Fixed by checking
  // "is anything assigned at all" (direct or group) separately from the
  // advisory percent: a voluntary-only page (neither) still can never be
  // overdue: a group-only page now can be, on a past due date, same as a
  // page with direct assignees -- exact completion is still one click away
  // in the drill-down, same as the percent column already tells the viewer
  // for any group-assigned page.
  const hasAnyAssignment = assignedCount > 0 || config.assignedGroups.length > 0;
  const overdue = !deleted && !!config.dueDate && hasAnyAssignment && !isComplete && config.dueDate < todayIsoDate();

  return {
    pageId: config.pageId,
    title: visibility.kind === 'visible' ? visibility.title : null,
    deleted,
    spaceKey: config.spaceKey,
    assignedCount,
    percent,
    dueDate: config.dueDate,
    overdue,
  };
}

export function matchesStatusFilter(row: DashboardRow, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'complete':
      return row.percent.kind === 'value' && row.percent.percent >= 1;
    case 'incomplete':
      return row.percent.kind === 'value' && row.percent.percent < 1;
    case 'overdue':
      return row.overdue;
    default:
      return true;
  }
}

export async function getDashboardRows(
  payload: GetDashboardPayload,
  accountId: string,
): Promise<Result<GetDashboardResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to view the dashboard.');
  }

  const { cursor, spaceKey, statusFilter = 'all' } = payload;
  const page = await queryTrackedPage(spaceKey, cursor);

  const visibility = await resolvePageVisibility(page.results.map((c) => c.pageId));

  const rows = page.results
    .map((config) => buildDashboardRow(config, visibility.get(config.pageId) ?? { kind: 'restricted' }))
    .filter((row): row is DashboardRow => row !== null)
    .filter((row) => matchesStatusFilter(row, statusFilter));

  return ok({ rows, nextCursor: page.nextCursor ?? null });
}
