import { InMemoryKvs } from '../testUtils/kvsFake';
import { aConfirmation, aPageConfig } from '../testUtils/fixtures';
import type { ConfirmationRecord } from '../domain/confirm';

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

// Imported after the mock so these modules see the fake @forge/kvs.
import kvsFake from '@forge/kvs';
import { getPageConfig, savePageConfig } from './configs';
import { writeConfirmation, getLatestConfirmation, drainByPage, drainByUser } from './confirmations';

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

async function drainAll(gen: AsyncGenerator<ConfirmationRecord[]>): Promise<ConfirmationRecord[]> {
  const all: ConfirmationRecord[] = [];
  for await (const page of gen) {
    all.push(...page);
  }
  return all;
}

describe('writeConfirmation (tech design §6.1 — idempotent, append-only)', () => {
  it('creates a new record on the first write', async () => {
    const record = aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 7 });

    const result = await writeConfirmation(record);

    expect(result.created).toBe(true);
    expect(result.record).toEqual(record);
  });

  it('repeat confirm for the same (page, user, version) returns the original record unchanged', async () => {
    const first = aConfirmation({
      pageId: 'page-1',
      accountId: 'acc-1',
      pageVersion: 7,
      confirmedAt: '2026-07-09T10:00:00.000Z',
    });
    const firstResult = await writeConfirmation(first);

    // Second call carries a different confirmedAt to prove it is discarded,
    // not merged — the stored record must win, byte-identical to the first.
    const second = aConfirmation({
      pageId: 'page-1',
      accountId: 'acc-1',
      pageVersion: 7,
      confirmedAt: '2026-07-09T10:05:00.000Z',
    });
    const secondResult = await writeConfirmation(second);

    expect(secondResult.created).toBe(false);
    expect(secondResult.record).toEqual(firstResult.record);
    expect(secondResult.record.confirmedAt).toBe('2026-07-09T10:00:00.000Z');
  });

  it('a different page version creates a new record and leaves the old one untouched', async () => {
    const v7 = aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 7 });
    await writeConfirmation(v7);

    const v8 = aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 8 });
    const result = await writeConfirmation(v8);

    expect(result.created).toBe(true);
    const all = await drainAll(drainByPage('page-1'));
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.pageVersion).sort()).toEqual([7, 8]);
  });

  it('bumps the page-config counter in the same write when a config exists for the page', async () => {
    const config = aPageConfig({ pageId: 'page-1', counters: { confirmedCurrentVersion: 3 } });
    await savePageConfig(config);

    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1 }));

    const updated = await getPageConfig('page-1');
    expect(updated?.counters.confirmedCurrentVersion).toBe(4);
  });

  it('auto-tracks a never-configured page on its first confirmation (bug fix, 2026-07-22): creates an active, voluntary page-config with the counter bumped to 1', async () => {
    await expect(
      writeConfirmation(aConfirmation({ pageId: 'untracked-page', spaceKey: 'SEC', accountId: 'acc-1', pageVersion: 1, confirmedAt: '2026-07-22T10:00:00.000Z' })),
    ).resolves.toMatchObject({ created: true });

    const config = await getPageConfig('untracked-page');
    expect(config).toMatchObject({
      pageId: 'untracked-page',
      spaceKey: 'SEC',
      active: true,
      assignedUsers: [],
      assignedGroups: [],
      dueDate: null,
      counters: { confirmedCurrentVersion: 1 },
    });
  });

  it('does not re-track (or double-bump) an already-tracked page on a second confirmation from a different user', async () => {
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1 }));
    const afterFirst = await getPageConfig('page-1');

    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-2', pageVersion: 1 }));
    const afterSecond = await getPageConfig('page-1');

    expect(afterSecond?.counters.confirmedCurrentVersion).toBe((afterFirst?.counters.confirmedCurrentVersion ?? 0) + 1);
    expect(afterSecond?.createdAt).toBe(afterFirst?.createdAt);
  });

  it('does not bump the counter again on a repeat (idempotent) confirm', async () => {
    const config = aPageConfig({ pageId: 'page-1', counters: { confirmedCurrentVersion: 0 } });
    await savePageConfig(config);
    const record = aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1 });

    await writeConfirmation(record);
    await writeConfirmation(record);

    const updated = await getPageConfig('page-1');
    expect(updated?.counters.confirmedCurrentVersion).toBe(1);
  });
});

describe('getLatestConfirmation (macro hot path, tech design §5/§9)', () => {
  it('returns undefined when there are no records', async () => {
    expect(await getLatestConfirmation('page-1', 'acc-1')).toBeUndefined();
  });

  it('returns the highest pageVersion record for (page, user)', async () => {
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 3 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 5 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1 }));

    const latest = await getLatestConfirmation('page-1', 'acc-1');
    expect(latest?.pageVersion).toBe(5);
  });

  it('does not mix up different users on the same page', async () => {
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 9 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-2', pageVersion: 1 }));

    expect((await getLatestConfirmation('page-1', 'acc-2'))?.pageVersion).toBe(1);
  });
});

describe('drainByPage / drainByUser (drill-down, export, user history — tech design §5)', () => {
  it('drainByPage only returns records for that page', async () => {
    await writeConfirmation(aConfirmation({ pageId: 'page-A', accountId: 'acc-1', pageVersion: 1 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-A', accountId: 'acc-2', pageVersion: 1 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-B', accountId: 'acc-1', pageVersion: 1 }));

    const pageA = await drainAll(drainByPage('page-A'));
    expect(pageA).toHaveLength(2);
    expect(pageA.every((r) => r.pageId === 'page-A')).toBe(true);
  });

  it('drainByUser only returns records for that user, across pages', async () => {
    await writeConfirmation(aConfirmation({ pageId: 'page-A', accountId: 'acc-1', pageVersion: 1 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-B', accountId: 'acc-1', pageVersion: 1 }));
    await writeConfirmation(aConfirmation({ pageId: 'page-A', accountId: 'acc-2', pageVersion: 1 }));

    const forUser = await drainAll(drainByUser('acc-1'));
    expect(forUser).toHaveLength(2);
    expect(forUser.every((r) => r.accountId === 'acc-1')).toBe(true);
  });

  it('drains across multiple KVS query pages without dropping or duplicating records', async () => {
    const total = 145; // forces more than one page at MAX_PAGE_SIZE=100
    for (let v = 1; v <= total; v++) {
      await writeConfirmation(aConfirmation({ pageId: 'page-multi', accountId: `acc-${v}`, pageVersion: 1 }));
    }

    const all = await drainAll(drainByPage('page-multi'));
    expect(all).toHaveLength(total);
    expect(new Set(all.map((r) => r.accountId)).size).toBe(total);
  });
});

describe('append-only invariant (data model invariant 1)', () => {
  it('exposes no update or delete function for confirmation records', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require('./confirmations');
    const forbidden = Object.keys(exported).filter((name) => /update|delete|remove/i.test(name));
    expect(forbidden).toEqual([]);
  });
});
