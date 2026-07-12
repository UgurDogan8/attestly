import kvs, { Sort } from '@forge/kvs';
import type { ConfirmationRecord } from '../domain/confirm';
import { ENTITY, confirmationKey, pageConfigKey } from './entities';
import { getPageConfig, bumpConfirmedCounter, toStorableConfig } from './configs';
import { drainPages, MAX_PAGE_SIZE, type CursorPage } from './pagination';

export interface WriteConfirmationResult {
  record: ConfirmationRecord;
  created: boolean;
}

/**
 * Idempotent, append-only write (tech design §6.1). Read-then-write on the
 * deterministic key `confirm#{pageId}#{accountId}#{pageVersion}`: an
 * existing record is returned unchanged (`created: false`), never
 * overwritten. Bumps the page-config's advisory counter in the same
 * transaction when a config exists for this page (tech design §5) —
 * voluntary confirmations on untracked pages simply skip the bump, there is
 * nothing to bump. Correctness never depends on the counter being exact;
 * drill-down self-heals it (tech design §5).
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
  const tx = kvs.transact();
  tx.set(key, record, { entityName: ENTITY.confirmation });
  if (config) {
    tx.set(pageConfigKey(record.pageId), toStorableConfig(bumpConfirmedCounter(config)), { entityName: ENTITY.pageConfig });
  }
  await tx.execute();

  return { record, created: true };
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
