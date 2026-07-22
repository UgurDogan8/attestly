import kvs, { Sort } from '@forge/kvs';
import type { ConfirmationRecord } from '../domain/confirm';
import { ENTITY, confirmationKey, pageConfigKey } from './entities';
import { getPageConfig, bumpConfirmedCounter, toStorableConfig, type PageConfigRecord } from './configs';
import { drainPages, MAX_PAGE_SIZE, type CursorPage } from './pagination';

export interface WriteConfirmationResult {
  record: ConfirmationRecord;
  created: boolean;
}

/**
 * Idempotent, append-only write (tech design §6.1). Read-then-write on the
 * deterministic key `confirm#{pageId}#{accountId}#{pageVersion}`: an
 * existing record is returned unchanged (`created: false`), never
 * overwritten.
 *
 * Auto-tracks the page (bug found live, 2026-07-22): a page with the macro
 * dropped on it but never explicitly configured (nobody opened "Configure
 * read confirmation" and hit Save) had no `page-config` record at all —
 * confirmations were still written and permanent, but since the dashboard
 * and every export scope (page/space/site) discover pages exclusively via
 * `page-config`'s `tracked` index (never by fanning out over `confirmation`
 * records, by design — tech design §5), such a page's real audit records
 * were invisible everywhere except a direct KVS read. The very first
 * confirmation for a page with no existing config now creates one: `active:
 * true`, empty assignment (voluntary — the reader confirmed with no one
 * having required it), same as if a manager had opened Configure and saved
 * with nobody selected. This makes the page discoverable on the dashboard
 * and exportable immediately, and is edit-in-place afterwards (Dashboard's
 * page search / PageDetail's Configure button). No `config-audit` entry is
 * written for this — nothing about assignment changed, there is no human
 * "who did this" to record, unlike a real saveConfig.
 *
 * Bumps the page-config's advisory counter in the same transaction either
 * way (tech design §5) — correctness never depends on the counter being
 * exact; drill-down self-heals it.
 *
 * Races between two near-simultaneous confirms for the same key converge on
 * that key — last write is a valid confirmation of the same (page, user,
 * version), so no corruption is possible (tech design §6.1's own words);
 * a doubled counter bump in that rare case is tolerated by design (advisory).
 *
 * This module exposes no update/delete path for `confirmation` records
 * (data model invariant 1) — see confirmations.test.ts.
 */
export async function writeConfirmation(record: ConfirmationRecord): Promise<WriteConfirmationResult> {
  const key = confirmationKey(record.pageId, record.accountId, record.pageVersion);
  const entity = kvs.entity<ConfirmationRecord>(ENTITY.confirmation);

  const existing = await entity.get(key);
  if (existing) {
    return { record: existing, created: false };
  }

  const config = await getPageConfig(record.pageId);
  const trackedConfig = config ?? autoTrackedConfig(record);

  const tx = kvs.transact();
  tx.set(key, record, { entityName: ENTITY.confirmation });
  tx.set(pageConfigKey(record.pageId), toStorableConfig(bumpConfirmedCounter(trackedConfig)), { entityName: ENTITY.pageConfig });
  await tx.execute();

  return { record, created: true };
}

/** A never-configured page's first confirmation registers it as tracked, voluntary, empty assignment — see writeConfirmation's docstring. */
function autoTrackedConfig(record: ConfirmationRecord): PageConfigRecord {
  return {
    pageId: record.pageId,
    spaceKey: record.spaceKey,
    active: true,
    dueDate: null,
    reconfirmOnChange: false,
    createdBy: record.accountId,
    createdAt: record.confirmedAt,
    updatedBy: record.accountId,
    updatedAt: record.confirmedAt,
    schemaVersion: 1,
    assignedUsers: [],
    assignedGroups: [],
    counters: { confirmedCurrentVersion: 0 },
  };
}

/**
 * Macro hot path (tech design §5, §9 budget <2s): latest confirmed version
 * for (page, user) in one read via the `by-page-user` index.
 */
export async function getLatestConfirmation(
  pageId: string,
  accountId: string,
): Promise<ConfirmationRecord | undefined> {
  const result = await kvs
    .entity<ConfirmationRecord>(ENTITY.confirmation)
    .query()
    .index('by-page-user', { partition: [pageId, accountId] })
    .sort(Sort.DESC)
    .limit(1)
    .getMany();
  return result.results[0]?.value;
}

function queryByIndex(
  indexName: 'by-page' | 'by-user',
  partition: string[],
  cursor: string | undefined,
): Promise<CursorPage<ConfirmationRecord>> {
  let q = kvs
    .entity<ConfirmationRecord>(ENTITY.confirmation)
    .query()
    .index(indexName, { partition })
    .limit(MAX_PAGE_SIZE);
  if (cursor) {
    q = q.cursor(cursor);
  }
  return q.getMany().then((page) => ({
    results: page.results.map((r) => r.value),
    nextCursor: page.nextCursor,
  }));
}

/** Cursor-paged read of every confirmation for a page (drill-down, export — tech design §5). */
export function drainByPage(pageId: string): AsyncGenerator<ConfirmationRecord[]> {
  return drainPages((cursor) => queryByIndex('by-page', [pageId], cursor));
}

/** Cursor-paged read of every confirmation for a user (user history, per-user export). */
export function drainByUser(accountId: string): AsyncGenerator<ConfirmationRecord[]> {
  return drainPages((cursor) => queryByIndex('by-user', [accountId], cursor));
}
