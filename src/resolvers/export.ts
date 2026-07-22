import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { matchesDateRange, exportFilename, type ExportRow } from '../domain/export';
import { buildPdf } from '../domain/pdf';
import { isComplianceManager, getGroupMemberAccountIds, checkViewPermission, resolveUserDisplayName } from './auth';
import { resolvePageVisibility, buildDashboardRow, matchesStatusFilter, type PageVisibility } from './dashboard';
import { mapWithConcurrency } from './concurrency';
import { getPageConfig, queryTrackedPage, type PageConfigRecord } from '../storage/configs';
import { drainByPage } from '../storage/confirmations';
import { APP_VERSION } from '../version';
import {
  ok,
  err,
  isUnresolvedSpaceKey,
  type Result,
  type ExportRowsPayload,
  type ExportRowsResponse,
  type BuildPdfExportPayload,
  type BuildPdfExportResponse,
  type AssignmentType,
} from '../shared';

/** Found in review: the dashboard's "unresolved space key" placeholder (Dashboard.tsx) was never
 * applied here, so the raw numeric spaceId fallback (auth.ts's resolveSpaceKey) leaked into the
 * CSV/PDF audit artifact handed to a third party. English/ASCII to match this file's existing
 * machine-readable conventions (status/assignment_type are already unlocalized enum strings). */
const UNRESOLVED_SPACE_KEY_PLACEHOLDER = '(unresolved)';

/**
 * exportRows (T11/T12, revised a second time). The prior version of this
 * file (`exportFile`, git history) ran entirely in one `asUser()` resolver
 * call: resolve the whole in-scope page set, drain every one of those
 * pages' confirmations, permission-check every eligible user, and return
 * the finished CSV/PDF. That correctly reused
 * `resolvePageVisibility`/`buildDashboardRow`/`matchesStatusFilter` for the
 * visibility rule (unchanged below) but never actually satisfied this
 * task's own accept line for a large export: docs/06 T11 measured ~10s of
 * KVS/permission work per 10k records during the original spike and called
 * spanning invocations mandatory; docs/07 §10 flagged the single-call
 * version as an unconfirmed residual risk, not a proven-safe simplification.
 *
 * This is that fallback, built now rather than waited on: one bounded chunk
 * of tracked pages per call, using `queryTrackedPage`'s own KVS cursor — the
 * identical client-driven-pagination contract `getDashboard` already uses
 * (tech design §9; `storage/configs.ts`'s docstring on `queryTrackedPage`
 * says exactly this: "a generator can't resume across separate serverless
 * invocations"). The Custom UI export surface (`static/export-ui/`) loops
 * `invoke('exportRows', …)` until `nextCursor` is null, accumulating
 * `ExportRow[]` itself, then assembles the final file: CSV client-side
 * (`domain/csv.ts` is pure, already cross-imported by that bundle for
 * i18n) or via one final `buildPdfExport` call below (`domain/pdf.ts`
 * writes a Node `Buffer`, which the Custom UI page's browser context
 * doesn't have).
 *
 * scope="page" is exempt from chunking: a single page's assignee list is
 * already small (data model §2.2's soft assignee-count cap) and comes back
 * complete in one call, same as it always did.
 *
 * Trade-off from chunking: `createGroupMembersLookup`'s cache below now
 * only covers the pages in *one* chunk, not the whole export — a group
 * assigned on pages spread across many chunks gets its member list
 * refetched once per chunk instead of once per export. Accepted rather than
 * threading a cache through the client-held cursor: the KVS drain this
 * whole change targets dominates real-world cost far more than one extra
 * group-membership fetch every few dozen pages.
 */

/** Data model §4: exported timestamps are YYYY-MM-DDTHH:mm:ssZ, no milliseconds. */
function dropMilliseconds(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

const PERMISSION_CHECK_CONCURRENCY = 10;
// Kept modest (unlike PERMISSION_CHECK_CONCURRENCY's per-page 10) since each
// page already fans out up to PERMISSION_CHECK_CONCURRENCY permission checks
// of its own -- this bounds the *product* of the two to a similar order of
// magnitude as a single large page used to issue alone, rather than
// multiplying page-level and user-level concurrency together unchecked.
const PAGE_PROCESSING_CONCURRENCY = 4;

async function candidatePageConfigs(payload: ExportRowsPayload): Promise<{ configs: PageConfigRecord[]; nextCursor: string | null }> {
  if (payload.scope === 'page') {
    if (!payload.scopeValue) {
      return { configs: [], nextCursor: null };
    }
    const config = await getPageConfig(payload.scopeValue);
    return { configs: config && config.active ? [config] : [], nextCursor: null };
  }

  const spaceKey = payload.scope === 'space' ? payload.scopeValue : undefined;
  const page = await queryTrackedPage(spaceKey, payload.cursor);
  return { configs: page.results, nextCursor: page.nextCursor ?? null };
}

interface ExportPage {
  config: PageConfigRecord;
  title: string | null;
  deleted: boolean;
  /** The page's real, live version — undefined only when `deleted` (data model §3.1: no current version of a page that no longer exists). */
  currentVersion: number | undefined;
}

interface PageRowsContext {
  page: ExportPage;
  displayNameCache: Map<string, string>;
  groupMembersOf: (groupId: string) => Promise<string[]>;
  exportedAtUtc: string;
}

/**
 * Memoizes getGroupMemberAccountIds for the lifetime of one exportFile call.
 * Found in review: a site/space-wide export previously re-fetched the same
 * group's full member list once per page that group was assigned to -- a
 * group required on hundreds of pages (the common case for a site-wide
 * "everyone reads this" policy) paid for the same paginated fetch hundreds
 * of times in a single export. Caches the in-flight promise (not just the
 * resolved value) so pages processed concurrently for the same group share
 * one fetch rather than each starting their own before any completes.
 */
function createGroupMembersLookup(): (groupId: string) => Promise<string[]> {
  const cache = new Map<string, Promise<string[]>>();
  return (groupId: string) => {
    let entry = cache.get(groupId);
    if (!entry) {
      entry = getGroupMemberAccountIds(groupId);
      cache.set(groupId, entry);
    }
    return entry;
  };
}

async function buildPageRows(ctx: PageRowsContext): Promise<ExportRow[]> {
  const { page, displayNameCache, groupMembersOf, exportedAtUtc } = ctx;
  const config = page.config;

  const latestByAccount = new Map<string, ConfirmationRecord>();
  for await (const chunk of drainByPage(config.pageId)) {
    for (const record of chunk) {
      const existing = latestByAccount.get(record.accountId);
      if (!existing || record.pageVersion > existing.pageVersion) {
        latestByAccount.set(record.accountId, record);
      }
    }
  }

  const groupMembers = await Promise.all(config.assignedGroups.map((id) => groupMembersOf(id)));
  const eligibleIds = new Set(config.assignedUsers);
  for (const members of groupMembers) {
    for (const accountId of members) {
      eligibleIds.add(accountId);
    }
  }

  async function displayNameFor(accountId: string): Promise<string> {
    const cached = displayNameCache.get(accountId);
    if (cached) {
      return cached;
    }
    const name = await resolveUserDisplayName(accountId, 'user');
    displayNameCache.set(accountId, name);
    return name;
  }

  async function buildRow(accountId: string, assignmentType: AssignmentType): Promise<ExportRow> {
    const latest = latestByAccount.get(accountId);

    // Same reasoning as T10's drill-down for a deleted page (data model
    // §3.1): no live page to check permission against, so any existing
    // record simply means confirmed, no record means outstanding.
    const canView = page.deleted ? true : (await checkViewPermission(config.pageId, accountId)) !== 'cannot-view';
    const status = computeStatus({
      confirmedVersions: latest ? [latest.pageVersion] : [],
      // Bug fix (PR review): the page's own live version, not the
      // confirmer's last-confirmed one — falls back to the latest confirmed
      // version only for a deleted page (mirrors pageDetail.ts's drill-down:
      // any existing record then compares equal to "current" -> confirmed).
      currentVersion: page.currentVersion ?? latest?.pageVersion ?? 0,
      reconfirmOnChange: config.reconfirmOnChange,
      canView,
    });

    return {
      pageTitle: page.deleted ? `[deleted page ${config.pageId}]` : (page.title ?? config.pageId),
      pageId: config.pageId,
      spaceKey: isUnresolvedSpaceKey(config.spaceKey) ? UNRESOLVED_SPACE_KEY_PLACEHOLDER : config.spaceKey,
      pageVersionConfirmed: status === 'outstanding' || status === 'cannot-view' ? null : (latest?.pageVersion ?? null),
      userDisplayName: await displayNameFor(accountId),
      userAccountId: accountId,
      assignmentType,
      status,
      confirmedAtUtc: latest ? dropMilliseconds(latest.confirmedAt) : null,
      dueDate: config.dueDate,
      exportedAtUtc,
      appVersion: APP_VERSION,
    };
  }

  const assignedRows = await mapWithConcurrency(Array.from(eligibleIds), PERMISSION_CHECK_CONCURRENCY, (accountId) =>
    buildRow(accountId, 'assigned'),
  );

  const voluntaryAccountIds = Array.from(latestByAccount.keys()).filter((accountId) => !eligibleIds.has(accountId));
  const voluntaryRows = await mapWithConcurrency(voluntaryAccountIds, PERMISSION_CHECK_CONCURRENCY, (accountId) =>
    buildRow(accountId, 'voluntary'),
  );

  return [...assignedRows, ...voluntaryRows];
}

export async function exportRows(payload: ExportRowsPayload, accountId: string): Promise<Result<ExportRowsResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to export.');
  }

  const { configs, nextCursor } = await candidatePageConfigs(payload);
  const visibility = await resolvePageVisibility(configs.map((c) => c.pageId));

  const pages: ExportPage[] = configs
    .map((config): ExportPage | null => {
      const visible: PageVisibility = visibility.get(config.pageId) ?? { kind: 'restricted' };
      const row = buildDashboardRow(config, visible);
      if (!row || !matchesStatusFilter(row, payload.statusFilter ?? 'all')) {
        return null;
      }
      return {
        config,
        title: row.title,
        deleted: row.deleted,
        currentVersion: visible.kind === 'visible' ? visible.version : undefined,
      };
    })
    .filter((page): page is ExportPage => page !== null);

  // First call generates it; every later call in this export must echo the
  // exact same value back (data model §4: identical exported_at_utc on every
  // row of one export) rather than let this chunk re-read the clock.
  const exportedAtUtc = payload.exportedAtUtc ?? dropMilliseconds(new Date().toISOString());
  const displayNameCache = new Map<string, string>();
  const groupMembersOf = createGroupMembersLookup();

  // Found in review: pages were processed one at a time despite being fully
  // independent (each has its own confirmations, group members, and
  // permission checks) -- a site-wide export of hundreds of pages paid for
  // hundreds of sequential round-trip chains instead of overlapping them.
  const pageRowSets = await mapWithConcurrency(pages, PAGE_PROCESSING_CONCURRENCY, (page) =>
    buildPageRows({ page, displayNameCache, groupMembersOf, exportedAtUtc }),
  );
  const rows: ExportRow[] = pageRowSets
    .flat()
    .filter((row) => matchesDateRange(row, payload.dateFrom, payload.dateTo));

  return ok({ rows, nextCursor, exportedAtUtc });
}

export async function buildPdfExport(payload: BuildPdfExportPayload, accountId: string): Promise<Result<BuildPdfExportResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to export.');
  }

  const pdf = buildPdf({ scope: payload.scope, exportedAtUtc: payload.exportedAtUtc, appVersion: APP_VERSION }, payload.rows);
  return ok({ filename: exportFilename(payload.scope, payload.exportedAtUtc, 'pdf'), base64: pdf.toString('base64') });
}
