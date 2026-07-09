import kvs, { WhereConditions } from '@forge/kvs';
import { ENTITY, pageConfigKey } from './entities';
import { drainPages, MAX_PAGE_SIZE, type CursorPage } from './pagination';

/** data model §2.2 — mutable, unlike `confirmation`. */
export interface PageConfigCounters {
  /** Advisory only (tech design §5) — dashboard list hint, never the source
   * of truth for an audit answer. Drill-down/export always recompute from
   * `confirmation` records; a stale counter self-heals on drill-down load. */
  confirmedCurrentVersion: number;
}

export interface PageConfigRecord {
  pageId: string;
  spaceKey: string;
  /** Soft-delete flag: removing the requirement flips this; records remain (data model §2.2). */
  active: boolean;
  dueDate: string | null;
  reconfirmOnChange: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  schemaVersion: number;
  assignedUsers: string[];
  assignedGroups: string[];
  counters: PageConfigCounters;
}

export async function getPageConfig(pageId: string): Promise<PageConfigRecord | undefined> {
  return kvs.entity<PageConfigRecord>(ENTITY.pageConfig).get(pageConfigKey(pageId));
}

/**
 * page-config is mutable by design (data model §2.2 — unlike `confirmation`).
 * Overwrites are expected: config changes, due-date edits, soft-delete via
 * `active: false`. Callers are responsible for `updatedBy`/`updatedAt`
 * (T4/T7) and for appending a `config-audit` entry alongside every save
 * (storage/audit.ts) — this function only persists the config itself.
 */
export async function savePageConfig(config: PageConfigRecord): Promise<void> {
  await kvs.entity<PageConfigRecord>(ENTITY.pageConfig).set(pageConfigKey(config.pageId), config);
}

/**
 * Pure counter transform (data model §2.2, tech design §5). Used directly
 * and from inside storage/confirmations.ts's confirm transaction — kept
 * here, not in domain/, because it operates on a storage-owned record shape
 * that has no independent business meaning outside persistence.
 */
export function bumpConfirmedCounter(config: PageConfigRecord): PageConfigRecord {
  return {
    ...config,
    counters: {
      ...config.counters,
      confirmedCurrentVersion: config.counters.confirmedCurrentVersion + 1,
    },
  };
}

function queryTracked(
  spaceKey: string | undefined,
  cursor: string | undefined,
): Promise<CursorPage<PageConfigRecord>> {
  let q = kvs
    .entity<PageConfigRecord>(ENTITY.pageConfig)
    .query()
    .index('tracked', { partition: [true] })
    .limit(MAX_PAGE_SIZE);
  if (spaceKey) {
    q = q.where(WhereConditions.equalTo(spaceKey));
  }
  if (cursor) {
    q = q.cursor(cursor);
  }
  return q.getMany().then((page) => ({
    results: page.results.map((r) => r.value),
    nextCursor: page.nextCursor,
  }));
}

/**
 * Cursor-paged read of tracked (active) pages, optionally filtered to one
 * space (dashboard list, tech design §5/§9 — never fans out across
 * `confirmation` records).
 */
export function drainTrackedPages(spaceKey?: string): AsyncGenerator<PageConfigRecord[]> {
  return drainPages((cursor) => queryTracked(spaceKey, cursor));
}
