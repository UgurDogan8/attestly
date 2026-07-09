import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { CSV_HEADER, exportRowToCsvCells, matchesDateRange, type ExportRow } from '../domain/export';
import { toCsv } from '../domain/csv';
import { buildPdf } from '../domain/pdf';
import { getGroupMemberAccountIds, checkViewPermission, resolveUserDisplayName } from '../resolvers/auth';
import { mapWithConcurrency } from '../resolvers/concurrency';
import { getPageConfig, type PageConfigRecord } from '../storage/configs';
import { drainByPage } from '../storage/confirmations';
import { getExportJob, deleteExportJob, type ExportJobPage } from '../storage/exportJobs';
import { APP_VERSION } from '../version';
import type { AssignmentType } from '../shared';

/**
 * The export webtrigger (docs/07 §5, manifest.yml comment). This handler
 * never makes its own visibility decision — every page it touches was
 * already cleared by the `startExport` resolver's asUser() bulk read
 * (src/resolvers/export.ts). Its own job here is: validate the one-time
 * token+secret, then recompute exact per-user rows the same way T10's
 * drill-down does (group membership, cannot-view, confirmations) — just
 * flattened across every page in the job's scope, shared by both formats
 * (T11 CSV, T12 PDF) per data model §4's normative row list. `job.format`
 * picks the serializer over the exact same `rows` array — CSV/PDF record
 * parity is guaranteed by construction, not by a separate parity check.
 *
 * asApp-only (tech design §4: asUser() fails outside UI-invoked contexts) —
 * every downstream call here explicitly passes tier `'app'`.
 */

const PERMISSION_CHECK_CONCURRENCY = 10;
const TIER = 'app';

function queryParam(request: WebTriggerRequest, name: string): string | undefined {
  return request.queryParameters[name]?.[0];
}

function textResponse(statusCode: number, body: string): WebTriggerResponse {
  return { statusCode, headers: { 'Content-Type': ['text/plain; charset=utf-8'] }, body };
}

/**
 * `isBase64Encoded` isn't in @forge/api's local WebTriggerResponse type
 * (an installed-package gap, this file's standing convention for verifying
 * against real docs rather than trusting incomplete local types) but is
 * documented platform behavior for returning binary bodies from a
 * webtrigger: base64-encode, set this flag, and the platform decodes it
 * before it reaches the browser.
 */
function binaryResponse(statusCode: number, headers: Record<string, string[]>, body: Buffer): WebTriggerResponse & { isBase64Encoded: true } {
  return { statusCode, headers, body: body.toString('base64'), isBase64Encoded: true };
}

interface PageRowsContext {
  page: ExportJobPage;
  config: PageConfigRecord;
  displayNameCache: Map<string, string>;
  exportedAtUtc: string;
}

async function buildPageRows(ctx: PageRowsContext): Promise<ExportRow[]> {
  const { page, config, displayNameCache, exportedAtUtc } = ctx;

  const latestByAccount = new Map<string, ConfirmationRecord>();
  for await (const chunk of drainByPage(page.pageId)) {
    for (const record of chunk) {
      const existing = latestByAccount.get(record.accountId);
      if (!existing || record.pageVersion > existing.pageVersion) {
        latestByAccount.set(record.accountId, record);
      }
    }
  }

  const groupMembers = await Promise.all(config.assignedGroups.map((id) => getGroupMemberAccountIds(id, TIER)));
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
    const name = await resolveUserDisplayName(accountId, TIER);
    displayNameCache.set(accountId, name);
    return name;
  }

  async function buildRow(accountId: string, assignmentType: AssignmentType): Promise<ExportRow> {
    const latest = latestByAccount.get(accountId);

    // Same reasoning as T10's drill-down for a deleted page (data model
    // §3.1): no live page to check permission against, so any existing
    // record simply means confirmed, no record means outstanding.
    const canView = page.deleted ? true : (await checkViewPermission(page.pageId, accountId)) !== 'cannot-view';
    const status = computeStatus({
      confirmedVersions: latest ? [latest.pageVersion] : [],
      currentVersion: latest?.pageVersion ?? 0,
      reconfirmOnChange: config.reconfirmOnChange,
      canView,
    });

    return {
      pageTitle: page.deleted ? `[deleted page ${page.pageId}]` : (page.title ?? page.pageId),
      pageId: page.pageId,
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

export async function handler(request: WebTriggerRequest): Promise<WebTriggerResponse> {
  const token = queryParam(request, 'job');
  const key = queryParam(request, 'k');
  const secret = process.env.EXPORT_SECRET;

  if (!token || !secret || key !== secret) {
    return textResponse(403, 'Forbidden.');
  }

  const job = await getExportJob(token);
  if (!job) {
    return textResponse(410, 'This export link has expired. Start a new export.');
  }
  // One-time redemption (docs/07 §5) -- consumed as soon as it's loaded,
  // before any row-building work that could throw.
  await deleteExportJob(token);

  try {
    const exportedAtUtc = new Date().toISOString();
    const displayNameCache = new Map<string, string>();
    const rows: ExportRow[] = [];

    for (const page of job.pages) {
      const config = await getPageConfig(page.pageId);
      if (!config) {
        continue; // page-config removed between job creation and redemption -- best-effort, never crash the export.
      }
      const pageRows = await buildPageRows({ page, config, displayNameCache, exportedAtUtc });
      rows.push(...pageRows.filter((row) => matchesDateRange(row, job.dateFrom ?? undefined, job.dateTo ?? undefined)));
    }

    const dateStamp = exportedAtUtc.slice(0, 10);

    if (job.format === 'pdf') {
      const pdf = buildPdf({ scope: job.scope, exportedAtUtc, appVersion: APP_VERSION }, rows);
      const filename = `read-confirmations_${job.scope}_${dateStamp}.pdf`;
      return binaryResponse(
        200,
        { 'Content-Type': ['application/pdf'], 'Content-Disposition': [`attachment; filename="${filename}"`] },
        pdf,
      );
    }

    const csv = toCsv(
      CSV_HEADER,
      rows.map((row) => exportRowToCsvCells(row)),
    );
    const filename = `read-confirmations_${job.scope}_${dateStamp}.csv`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': ['text/csv; charset=utf-8'],
        'Content-Disposition': [`attachment; filename="${filename}"`],
      },
      body: csv,
    };
  } catch (error) {
    return textResponse(500, error instanceof Error ? error.message : 'Export failed.');
  }
}
