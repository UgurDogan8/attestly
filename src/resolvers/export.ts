import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { CSV_HEADER, exportRowToCsvCells, matchesDateRange, type ExportRow } from '../domain/export';
import { toCsv } from '../domain/csv';
import { buildPdf } from '../domain/pdf';
import { isComplianceManager, getGroupMemberAccountIds, checkViewPermission, resolveUserDisplayName } from './auth';
import { resolvePageVisibility, buildDashboardRow, matchesStatusFilter, type PageVisibility } from './dashboard';
import { mapWithConcurrency } from './concurrency';
import { getPageConfig, drainTrackedPages, type PageConfigRecord } from '../storage/configs';
import { drainByPage } from '../storage/confirmations';
import { APP_VERSION } from '../version';
import { ok, err, type Result, type ExportFilePayload, type ExportFileResponse, type AssignmentType } from '../shared';

/**
 * exportFile (T11/T12, revised post-PR-review — docs/07 §5). Runs entirely
 * `asUser()` in one resolver call, the same way `getDashboard`/`getPageDetail`
 * do — there is no webtrigger, token, secret, or transient job record
 * anymore. The old design needed all of that purely to work around UI Kit
 * having no Blob/DOM download API; the Custom UI export surface
 * (`static/export-ui/`) that calls this resolver *can* trigger a real
 * browser download itself, so this function's only job is: resolve the
 * exact same viewer-visible page set the dashboard would (reusing
 * `resolvePageVisibility`/`buildDashboardRow`/`matchesStatusFilter`
 * verbatim, the same reason `startExport` reused them before), build rows,
 * and hand back the finished file. Two review-flagged bugs fixed here:
 *
 *  1. `resolvePageVisibility` now internally chunks — a >100-page site/space
 *     export no longer silently drops every page past the first bulk-read
 *     batch as "restricted" (src/resolvers/dashboard.ts).
 *  2. Status is computed against the page's real live version
 *     (`resolvePageVisibility`'s own `visible.version`), not the confirmer's
 *     own last-confirmed version — an export can now actually report
 *     `expired`, not just `confirmed`/`outstanding`.
 */

const PERMISSION_CHECK_CONCURRENCY = 10;

async function candidatePages(payload: ExportFilePayload): Promise<PageConfigRecord[]> {
  if (payload.scope === 'page') {
    if (!payload.scopeValue) {
      return [];
    }
    const config = await getPageConfig(payload.scopeValue);
    return config && config.active ? [config] : [];
  }

  const spaceKey = payload.scope === 'space' ? payload.scopeValue : undefined;
  const pages: PageConfigRecord[] = [];
  for await (const chunk of drainTrackedPages(spaceKey)) {
    pages.push(...chunk);
  }
  return pages;
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
  exportedAtUtc: string;
}

async function buildPageRows(ctx: PageRowsContext): Promise<ExportRow[]> {
  const { page, displayNameCache, exportedAtUtc } = ctx;
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

  const groupMembers = await Promise.all(config.assignedGroups.map((id) => getGroupMemberAccountIds(id)));
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
      spaceKey: config.spaceKey,
      pageVersionConfirmed: status === 'outstanding' || status === 'cannot-view' ? null : (latest?.pageVersion ?? null),
      userDisplayName: await displayNameFor(accountId),
      userAccountId: accountId,
      assignmentType,
      status,
      confirmedAtUtc: latest?.confirmedAt ?? null,
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

export async function exportFile(payload: ExportFilePayload, accountId: string): Promise<Result<ExportFileResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to export.');
  }

  const configs = await candidatePages(payload);
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

  const exportedAtUtc = new Date().toISOString();
  const displayNameCache = new Map<string, string>();
  const rows: ExportRow[] = [];

  for (const page of pages) {
    const pageRows = await buildPageRows({ page, displayNameCache, exportedAtUtc });
    rows.push(...pageRows.filter((row) => matchesDateRange(row, payload.dateFrom, payload.dateTo)));
  }

  const dateStamp = exportedAtUtc.slice(0, 10);

  if (payload.format === 'pdf') {
    const pdf = buildPdf({ scope: payload.scope, exportedAtUtc, appVersion: APP_VERSION }, rows);
    return ok({ format: 'pdf', filename: `read-confirmations_${payload.scope}_${dateStamp}.pdf`, base64: pdf.toString('base64') });
  }

  const csv = toCsv(
    CSV_HEADER,
    rows.map((row) => exportRowToCsvCells(row)),
  );
  return ok({ format: 'csv', filename: `read-confirmations_${payload.scope}_${dateStamp}.csv`, csv });
}
