import { InMemoryKvs } from '../testUtils/kvsFake';

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
import { createExportJob, getExportJob, deleteExportJob, type ExportJobRecord } from './exportJobs';

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

function aJob(overrides: Partial<ExportJobRecord> = {}): ExportJobRecord {
  return {
    token: 'tok-1',
    requestedBy: 'acc-admin',
    format: 'csv',
    scope: 'site',
    statusFilter: 'all',
    dateFrom: null,
    dateTo: null,
    pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }],
    createdAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('createExportJob / getExportJob / deleteExportJob (T11, docs/07 §5 — transient one-time job)', () => {
  it('a created job is readable back by its token', async () => {
    const job = aJob();
    await createExportJob(job);
    expect(await getExportJob('tok-1')).toEqual(job);
  });

  it('an unknown token resolves to undefined (410 Gone at the webtrigger)', async () => {
    expect(await getExportJob('nope')).toBeUndefined();
  });

  it('a deleted job is no longer readable (one-time redemption)', async () => {
    await createExportJob(aJob());
    await deleteExportJob('tok-1');
    expect(await getExportJob('tok-1')).toBeUndefined();
  });

  it('different tokens do not collide', async () => {
    await createExportJob(aJob({ token: 'tok-1', scope: 'page' }));
    await createExportJob(aJob({ token: 'tok-2', scope: 'space' }));
    expect((await getExportJob('tok-1'))?.scope).toBe('page');
    expect((await getExportJob('tok-2'))?.scope).toBe('space');
  });
});
