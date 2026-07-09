import { InMemoryKvs } from '../testUtils/kvsFake';
import { aPageConfig } from '../testUtils/fixtures';
import type { PageConfigRecord } from './configs';

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
import { getPageConfig, savePageConfig, bumpConfirmedCounter, drainTrackedPages } from './configs';

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

async function drainAll(gen: AsyncGenerator<PageConfigRecord[]>): Promise<PageConfigRecord[]> {
  const all: PageConfigRecord[] = [];
  for await (const page of gen) {
    all.push(...page);
  }
  return all;
}

describe('getPageConfig / savePageConfig (data model §2.2 — mutable by design)', () => {
  it('returns undefined for a page with no config', async () => {
    expect(await getPageConfig('missing')).toBeUndefined();
  });

  it('round-trips a saved config', async () => {
    const config = aPageConfig({ pageId: 'page-1' });
    await savePageConfig(config);
    expect(await getPageConfig('page-1')).toEqual(config);
  });

  it('overwrites on a second save (unlike confirmation/config-audit)', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', dueDate: null }));
    await savePageConfig(aPageConfig({ pageId: 'page-1', dueDate: '2026-08-15' }));

    expect((await getPageConfig('page-1'))?.dueDate).toBe('2026-08-15');
  });

  it('soft-delete flips active to false without deleting the record', async () => {
    const config = aPageConfig({ pageId: 'page-1', active: true });
    await savePageConfig(config);
    await savePageConfig({ ...config, active: false });

    const after = await getPageConfig('page-1');
    expect(after?.active).toBe(false);
    expect(after).toBeDefined();
  });
});

describe('bumpConfirmedCounter (pure)', () => {
  it('increments confirmedCurrentVersion by one', () => {
    const config = aPageConfig({ counters: { confirmedCurrentVersion: 5 } });
    expect(bumpConfirmedCounter(config).counters.confirmedCurrentVersion).toBe(6);
  });

  it('does not mutate its input', () => {
    const config = aPageConfig({ counters: { confirmedCurrentVersion: 5 } });
    bumpConfirmedCounter(config);
    expect(config.counters.confirmedCurrentVersion).toBe(5);
  });
});

describe('drainTrackedPages (dashboard list, tech design §5/§9)', () => {
  it('returns only active (tracked) pages', async () => {
    await savePageConfig(aPageConfig({ pageId: 'active-1', active: true }));
    await savePageConfig(aPageConfig({ pageId: 'inactive-1', active: false }));

    const tracked = await drainAll(drainTrackedPages());
    expect(tracked.map((c) => c.pageId)).toEqual(['active-1']);
  });

  it('filters to one space when spaceKey is given', async () => {
    await savePageConfig(aPageConfig({ pageId: 'p1', active: true, spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'p2', active: true, spaceKey: 'HR' }));

    const secOnly = await drainAll(drainTrackedPages('SEC'));
    expect(secOnly.map((c) => c.pageId)).toEqual(['p1']);
  });

  it('returns every space when no spaceKey filter is given', async () => {
    await savePageConfig(aPageConfig({ pageId: 'p1', active: true, spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'p2', active: true, spaceKey: 'HR' }));

    const all = await drainAll(drainTrackedPages());
    expect(all.map((c) => c.pageId).sort()).toEqual(['p1', 'p2']);
  });
});
