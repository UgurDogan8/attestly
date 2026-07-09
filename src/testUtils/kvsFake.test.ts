import { InMemoryKvs } from './kvsFake';

interface Widget {
  id: string;
  group: string;
  seq: number;
}

describe('InMemoryKvs (test-infra sanity — test plan §3)', () => {
  it('enforces the platform max page size so limit bugs surface in CI, not production', () => {
    const fake = new InMemoryKvs();
    expect(() =>
      fake.entity<Widget>('confirmation').query().index('by-page', { partition: ['p'] }).limit(101),
    ).toThrow(/exceeds the platform max/);
  });

  it('get/set round-trips a value scoped to its own entity name', async () => {
    const fake = new InMemoryKvs();
    await fake.entity<Widget>('confirmation').set('k1', { id: 'k1', group: 'g', seq: 1 });

    expect(await fake.entity<Widget>('confirmation').get('k1')).toEqual({ id: 'k1', group: 'g', seq: 1 });
    // Same key, different entity — must not leak across entities.
    expect(await fake.entity<Widget>('page-config').get('k1')).toBeUndefined();
  });

  it('reset() clears every entity', async () => {
    const fake = new InMemoryKvs();
    await fake.entity<Widget>('confirmation').set('k1', { id: 'k1', group: 'g', seq: 1 });

    fake.reset();

    expect(await fake.entity<Widget>('confirmation').get('k1')).toBeUndefined();
  });

  it('rejects an index that was not declared in INDEX_DEFINITIONS', async () => {
    const fake = new InMemoryKvs();
    await expect(
      fake.entity<Widget>('confirmation').query().index('not-a-real-index', { partition: ['p'] }).getMany(),
    ).rejects.toThrow(/unknown index/);
  });
});
