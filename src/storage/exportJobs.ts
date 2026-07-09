import kvs from '@forge/kvs';
import { ENTITY, exportJobKey } from './entities';
import type { ExportFormat, ExportScope, StatusFilter } from '../shared';

/**
 * Transient export job (docs/07 §5): the `startExport` resolver (asUser,
 * UI-invoked) is the only place that can safely resolve viewer-visibility;
 * the export webtrigger (asApp-only, per tech design §4 — asUser() fails
 * outside UI-invoked contexts) re-reads confirmation data fresh but never
 * makes its own visibility decision, it only touches the pages this job
 * already cleared.
 *
 * Deliberately small — page IDs + titles only, well under the 240 KiB KVS
 * value cap even for a large site's tracked-page set (docs/07 §5). Heavier
 * per-user data (group membership, confirmations, cannot-view checks) is
 * recomputed fresh by the webtrigger, never stored here, so the job can't go
 * stale between creation and redemption.
 */
export interface ExportJobPage {
  pageId: string;
  /** null for a deleted page (data model §4: "[deleted page {id}]", no title leak). */
  title: string | null;
  deleted: boolean;
}

export interface ExportJobRecord {
  token: string;
  requestedBy: string;
  format: ExportFormat;
  scope: ExportScope;
  statusFilter: StatusFilter;
  dateFrom: string | null;
  dateTo: string | null;
  pages: ExportJobPage[];
  createdAt: string;
}

/** One-time capability, short-lived (docs/07 §5: "TTL ~5 min, one-time"). */
const EXPORT_JOB_TTL = { value: 5, unit: 'MINUTES' as const };

export async function createExportJob(job: ExportJobRecord): Promise<void> {
  await kvs.entity<ExportJobRecord>(ENTITY.exportJob).set(exportJobKey(job.token), job, { ttl: EXPORT_JOB_TTL });
}

export async function getExportJob(token: string): Promise<ExportJobRecord | undefined> {
  return kvs.entity<ExportJobRecord>(ENTITY.exportJob).get(exportJobKey(token));
}

/** One-time redemption (docs/07 §5) — called by the webtrigger after it has read the job, success or failure. */
export async function deleteExportJob(token: string): Promise<void> {
  await kvs.entity<ExportJobRecord>(ENTITY.exportJob).delete(exportJobKey(token));
}
