import { webTrigger } from '@forge/api';
import { randomUUID } from 'node:crypto';
import { isComplianceManager } from './auth';
import { resolvePageVisibility, buildDashboardRow, matchesStatusFilter } from './dashboard';
import { getPageConfig, drainTrackedPages, type PageConfigRecord } from '../storage/configs';
import { createExportJob, type ExportJobPage } from '../storage/exportJobs';
import { ok, err, type Result, type StartExportPayload, type StartExportResponse } from '../shared';

/**
 * startExport (T11, docs/07 §5) — the only place that decides *which pages*
 * this export may touch. Runs asUser() (a resolver, UI-invoked context) so
 * the viewer-visibility rule (tech design §4) applies exactly as it does on
 * the dashboard — reusing resolvePageVisibility/buildDashboardRow/
 * matchesStatusFilter verbatim keeps that guarantee true by construction,
 * not by re-implementing the same filter twice. The export webtrigger that
 * redeems the returned URL runs asApp-only and trusts this job's page list
 * completely; it never re-derives visibility itself.
 */

async function candidatePages(payload: StartExportPayload): Promise<PageConfigRecord[]> {
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

export async function startExport(payload: StartExportPayload, accountId: string): Promise<Result<StartExportResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to export.');
  }

  const secret = process.env.EXPORT_SECRET;
  if (!secret) {
    // Deployment prerequisite (manifest.yml's TODO, docs/07 §5) -- fail
    // loudly rather than mint a URL that will 403 for every user forever.
    return err('EXPORT_NOT_CONFIGURED', 'Export is not configured for this environment.');
  }

  const configs = await candidatePages(payload);
  const visibility = await resolvePageVisibility(configs.map((c) => c.pageId));

  const pages: ExportJobPage[] = configs
    .map((config) => {
      const row = buildDashboardRow(config, visibility.get(config.pageId) ?? { kind: 'restricted' });
      if (!row || !matchesStatusFilter(row, payload.statusFilter ?? 'all')) {
        return null;
      }
      return { pageId: row.pageId, title: row.title, deleted: row.deleted };
    })
    .filter((page): page is ExportJobPage => page !== null);

  const token = randomUUID();
  await createExportJob({
    token,
    requestedBy: accountId,
    format: payload.format,
    scope: payload.scope,
    statusFilter: payload.statusFilter ?? 'all',
    dateFrom: payload.dateFrom ?? null,
    dateTo: payload.dateTo ?? null,
    pages,
    createdAt: new Date().toISOString(),
  });

  const baseUrl = await webTrigger.getUrl('export-trigger');
  const url = `${baseUrl}?job=${encodeURIComponent(token)}&k=${encodeURIComponent(secret)}`;

  return ok({ url });
}
