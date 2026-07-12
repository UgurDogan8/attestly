import kvs, { WhereConditions } from '@forge/kvs';
import { randomUUID } from 'node:crypto';
import { ENTITY, pageConfigKey, configAuditKey } from './entities';
import { drainPages, MAX_PAGE_SIZE, type CursorPage } from './pagination';
import type { ConfigAuditRecord } from './audit';

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

/**
 * manifest.yml declares `dueDate: type: string` on the `page-config` entity
 * (no nullable/optional marker — Forge's Custom Entity Store has none to
 * declare). `PageConfigRecord.dueDate` is `string | null` throughout the
 * domain ("no due date set" is a real, common case — voluntary tracking).
 * Confirmed live (2026-07-12, ugurdogan.atlassian.net dev site) in two
 * steps: a bare `null` write threw a generic wrapped error ("Request
 * cannot be processed due to one or more semantic errors") from inside a
 * transaction; writing `''` instead, outside a transaction, got a precise
 * one straight from the Custom Entity Store — `Value for attribute
 * "dueDate" cannot be empty`. So `type: string` here means "non-empty
 * string or entirely absent", not "nullable" — there is no representable
 * empty value, only omission. `toStorableConfig` drops the key from the
 * written object when there's no due date instead of writing `null`/`''`;
 * `fromStorableDueDate` maps the resulting absent/undefined key back to
 * `null` on read. Every caller of `getPageConfig`/`savePageConfig`/
 * `saveConfigWithAudit` keeps seeing plain `string | null`, unchanged.
 * `toStorableConfig` is exported because storage/confirmations.ts's
 * counter-bump also writes a whole `PageConfigRecord` straight into a
 * transaction (bumpConfirmedCounter) and needs the same treatment there.
 */
type StorablePageConfig = Omit<PageConfigRecord, 'dueDate'> & { dueDate?: string };

export function toStorableConfig(config: PageConfigRecord): StorablePageConfig {
  const { dueDate, ...rest } = config;
  return dueDate === null ? rest : { ...rest, dueDate };
}

function fromStorableDueDate(record: PageConfigRecord): PageConfigRecord {
  return record.dueDate ? record : { ...record, dueDate: null };
}

export async function getPageConfig(pageId: string): Promise<PageConfigRecord | undefined> {
  const record = await kvs.entity<PageConfigRecord>(ENTITY.pageConfig).get(pageConfigKey(pageId));
  return record ? fromStorableDueDate(record) : undefined;
}

/**
 * page-config is mutable by design (data model §2.2 — unlike `confirmation`).
 * Overwrites are expected: config changes, due-date edits, soft-delete via
 * `active: false`. Callers are responsible for `updatedBy`/`updatedAt`
 * (T4/T7) and for appending a `config-audit` entry alongside every save
 * (storage/audit.ts) — this function only persists the config itself.
 */
export async function savePageConfig(config: PageConfigRecord): Promise<void> {
  await kvs.entity<StorablePageConfig>(ENTITY.pageConfig).set(pageConfigKey(config.pageId), toStorableConfig(config));
}

/**
 * `saveConfig` + its `config-audit` entry in one KVS transaction (data model
 * §2.4: "without this, assignment changes silently rewrite history" — a
 * config write that succeeds while its audit write throws would do exactly
 * that). Same pattern as storage/confirmations.ts's writeConfirmation
 * transaction. `audit.at`/nonce must already be set by the caller — this
 * function only persists, it doesn't generate identity.
 */
export async function saveConfigWithAudit(config: PageConfigRecord, audit: ConfigAuditRecord): Promise<void> {
  const tx = kvs.transact();
  tx.set(pageConfigKey(config.pageId), toStorableConfig(config), { entityName: ENTITY.pageConfig });
  tx.set(configAuditKey(audit.pageId, audit.at, randomUUID()), audit, { entityName: ENTITY.configAudit });
  await tx.execute();
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

/**
 * One KVS page of tracked (active) configs, optionally filtered to one
 * space. Exported (not just wrapped by drainTrackedPages below) because
 * T9's getDashboard resolver needs to fetch exactly one page per
 * invocation using a cursor the *client* hands back on "Load more" —
 * a generator can't resume across separate serverless invocations, it
 * only helps within a single one (data model §5, tech design §9: cursor
 * pagination is a resolver-to-client contract here, not just an
 * in-process convenience).
 */
export function queryTrackedPage(
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
    results: page.results.map((r) => fromStorableDueDate(r.value)),
    nextCursor: page.nextCursor,
  }));
}

/**
 * Cursor-paged read of tracked (active) pages, optionally filtered to one
 * space (never fans out across `confirmation` records). For in-process
 * draining only (e.g. tests, full-site export) — resolvers that hand a
 * cursor back to the client must use queryTrackedPage directly instead.
 */
export function drainTrackedPages(spaceKey?: string): AsyncGenerator<PageConfigRecord[]> {
  return drainPages((cursor) => queryTrackedPage(spaceKey, cursor));
}
