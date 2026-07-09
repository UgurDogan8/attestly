import kvs, { Sort } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { ENTITY, configAuditKey } from './entities';
import { drainPages, MAX_PAGE_SIZE, type CursorPage } from './pagination';

/** data model §2.4 — append-only config-change log; the auditor's "who was required since when". */
export interface ConfigAuditRecord {
  pageId: string;
  /** ISO 8601 UTC, server clock. */
  at: string;
  /** accountId of whoever made the change. */
  actor: string;
  /** Free-form before/after diff (data model §2.4). */
  entry: Record<string, unknown>;
  schemaVersion: number;
}

/**
 * Append-only write (data model §1, §2.4). This module exposes no
 * update/delete path for `config-audit` records (data model invariant 1) —
 * see audit.test.ts. Callers append one entry per `saveConfig` call
 * (test plan §3.5).
 */
export async function appendAuditEntry(record: ConfigAuditRecord): Promise<void> {
  const key = configAuditKey(record.pageId, record.at, randomUUID());
  await kvs.entity<ConfigAuditRecord>(ENTITY.configAudit).set(key, record);
}

function queryByPage(pageId: string, cursor: string | undefined): Promise<CursorPage<ConfigAuditRecord>> {
  let q = kvs
    .entity<ConfigAuditRecord>(ENTITY.configAudit)
    .query()
    .index('by-page', { partition: [pageId] })
    .sort(Sort.DESC) // most recent change first (T10 History tab UX)
    .limit(MAX_PAGE_SIZE);
  if (cursor) {
    q = q.cursor(cursor);
  }
  return q.getMany().then((page) => ({
    results: page.results.map((r) => r.value),
    nextCursor: page.nextCursor,
  }));
}

/**
 * One KVS page of a page's audit log, most-recent-first. Exported (not just
 * wrapped by drainAuditByPage below) for the same reason T9's
 * queryTrackedPage is: the T10 getPageHistory resolver hands its cursor back
 * to the client on "Load more", and a generator can't resume across separate
 * serverless invocations.
 */
export function queryAuditPage(pageId: string, cursor: string | undefined): Promise<CursorPage<ConfigAuditRecord>> {
  return queryByPage(pageId, cursor);
}

/** History tab (docs/04 §3.3), in-process draining for callers that want it all at once. */
export function drainAuditByPage(pageId: string): AsyncGenerator<ConfigAuditRecord[]> {
  return drainPages((cursor) => queryByPage(pageId, cursor));
}
