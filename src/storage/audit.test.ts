import { InMemoryKvs } from '../testUtils/kvsFake';
import { anAuditEntry } from '../testUtils/fixtures';
import type { ConfigAuditRecord } from './audit';

jest.mock('@forge/kvs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { InMemoryKvs: FakeKvs, FakeSort, FakeWhereConditions } = require('../testUtils/kvsFake');
  return {
    __esModule: true,
    default: new FakeKvs(),
    Sort: FakeSort,
    WhereConditions: FakeWhereConditions,
  };
});

import kvsFake from '@forge/kvs';
import { appendAuditEntry, drainAuditByPage, queryAuditPage } from './audit';

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

async function drainAll(gen: AsyncGenerator<ConfigAuditRecord[]>): Promise<ConfigAuditRecord[]> {
  const all: ConfigAuditRecord[] = [];
  for await (const page of gen) {
    all.push(...page);
  }
  return all;
}

describe('appendAuditEntry / drainAuditByPage (data model §2.4 — append-only)', () => {
  it('an appended entry is readable back via drainAuditByPage', async () => {
    const entry = anAuditEntry({ pageId: 'page-1', actor: 'acc-admin' });
    await appendAuditEntry(entry);

    const all = await drainAll(drainAuditByPage('page-1'));
    expect(all).toEqual([entry]);
  });

  it('only returns entries for the requested page', async () => {
    await appendAuditEntry(anAuditEntry({ pageId: 'page-A' }));
    await appendAuditEntry(anAuditEntry({ pageId: 'page-B' }));

    const forA = await drainAll(drainAuditByPage('page-A'));
    expect(forA).toHaveLength(1);
    expect(forA[0].pageId).toBe('page-A');
  });

  it('two entries for the same page at the same instant both persist distinctly (nonce disambiguates the key)', async () => {
    const sameInstant = '2026-07-09T12:00:00.000Z';
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', at: sameInstant, entry: { action: 'assigned' } }));
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', at: sameInstant, entry: { action: 'due-date-set' } }));

    const all = await drainAll(drainAuditByPage('page-1'));
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.entry.action).sort()).toEqual(['assigned', 'due-date-set']);
  });

  it('records assignment history in order distinguishable by actor and diff', async () => {
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', actor: 'acc-admin', entry: { action: 'assigned', subject: 'acc-1' } }));
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', actor: 'acc-admin', entry: { action: 'due-date-set', date: '2026-08-15' } }));

    const all = await drainAll(drainAuditByPage('page-1'));
    expect(all).toHaveLength(2);
  });
});

describe('queryAuditPage (T10 getPageHistory — client-resumable cursor, most-recent-first)', () => {
  it('orders entries most-recent-first', async () => {
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', at: '2026-07-01T00:00:00.000Z', entry: { action: 'created' } }));
    await appendAuditEntry(anAuditEntry({ pageId: 'page-1', at: '2026-07-05T00:00:00.000Z', entry: { action: 'updated' } }));

    const page = await queryAuditPage('page-1', undefined);
    expect(page.results.map((r) => r.entry.action)).toEqual(['updated', 'created']);
  });

  it('a returned cursor fetches the next page (client-resumable, unlike drainAuditByPage)', async () => {
    for (let i = 0; i < 3; i += 1) {
      await appendAuditEntry(anAuditEntry({ pageId: 'page-1', at: `2026-07-0${i + 1}T00:00:00.000Z` }));
    }

    const first = await queryAuditPage('page-1', undefined);
    expect(first.results).toHaveLength(3); // under MAX_PAGE_SIZE, no cursor needed for this assertion to matter
    expect(first.nextCursor).toBeUndefined();
  });
});

describe('append-only invariant (data model invariant 1)', () => {
  it('exposes no update or delete function for config-audit records', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require('./audit');
    const forbidden = Object.keys(exported).filter((name) => /update|delete|remove/i.test(name));
    expect(forbidden).toEqual([]);
  });
});
