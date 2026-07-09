import type { WebTriggerRequest } from '@forge/api';
import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';
import { aPageConfig, aConfirmation } from '../testUtils/fixtures';

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

jest.mock('@forge/api', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FakeForgeApi: Fake, fakeRoute, fakeAssumeTrustedRoute } = require('../testUtils/forgeApiFake');
  return {
    __esModule: true,
    default: new Fake(),
    route: fakeRoute,
    assumeTrustedRoute: fakeAssumeTrustedRoute,
  };
});

import kvsFake from '@forge/kvs';
import apiFake from '@forge/api';
import { savePageConfig } from '../storage/configs';
import { writeConfirmation } from '../storage/confirmations';
import { createExportJob, getExportJob, type ExportJobRecord } from '../storage/exportJobs';
import { handler } from './export';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

const ORIGINAL_SECRET = process.env.EXPORT_SECRET;

beforeEach(() => {
  fakeKvs.reset();
  process.env.EXPORT_SECRET = 'test-secret';
});

afterAll(() => {
  process.env.EXPORT_SECRET = ORIGINAL_SECRET;
});

function request(query: Record<string, string>): WebTriggerRequest {
  const queryParameters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(query)) {
    queryParameters[k] = [v];
  }
  return { method: 'GET', body: '', path: '/', headers: {}, queryParameters };
}

function aJob(overrides: Partial<ExportJobRecord> = {}): ExportJobRecord {
  return {
    token: 'tok-1',
    requestedBy: 'acc-admin',
    format: 'csv',
    scope: 'site',
    statusFilter: 'all',
    dateFrom: null,
    dateTo: null,
    pages: [],
    createdAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

function bodyOf(response: { body?: string }): string {
  return response.body ?? '';
}

describe('export webtrigger — request validation', () => {
  it('403s when k does not match EXPORT_SECRET', async () => {
    const response = await handler(request({ job: 'tok-1', k: 'wrong' }));
    expect(response.statusCode).toBe(403);
  });

  it('403s when the job param is missing', async () => {
    const response = await handler(request({ k: 'test-secret' }));
    expect(response.statusCode).toBe(403);
  });

  it('403s when EXPORT_SECRET is not configured, even with a matching-looking key', async () => {
    delete process.env.EXPORT_SECRET;
    const response = await handler(request({ job: 'tok-1', k: 'test-secret' }));
    expect(response.statusCode).toBe(403);
  });

  it('410s (Gone) for an unknown or expired job token', async () => {
    const response = await handler(request({ job: 'nope', k: 'test-secret' }));
    expect(response.statusCode).toBe(410);
  });

  it('consumes the job (one-time): a second request with the same token 410s', async () => {
    await createExportJob(aJob());
    fakeApi.setHandler(() => jsonResponse(404, {}));

    await handler(request({ job: 'tok-1', k: 'test-secret' }));
    const second = await handler(request({ job: 'tok-1', k: 'test-secret' }));
    expect(second.statusCode).toBe(410);
    expect(await getExportJob('tok-1')).toBeUndefined();
  });
});

describe('export webtrigger — CSV generation', () => {
  it('streams a CSV with the correct headers and a BOM-prefixed body', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [] }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler(() => jsonResponse(404, {}));

    const response = await handler(request({ job: 'tok-1', k: 'test-secret' }));

    expect(response.statusCode).toBe(200);
    expect(response.headers?.['Content-Type']).toEqual(['text/csv; charset=utf-8']);
    expect(response.headers?.['Content-Disposition']?.[0]).toContain('attachment; filename="read-confirmations_site_');
    expect(bodyOf(response).charCodeAt(0)).toBe(0xfeff); // BOM
    expect(bodyOf(response)).toContain('page_title,page_id,space_key');
  });

  it('emits one row per assigned user, outstanding when never confirmed (PRD F1: the negative space)', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: true }));

    const response = await handler(request({ job: 'tok-1', k: 'test-secret' }));
    const body = bodyOf(response);
    expect(body).toContain('Security Policy,page-1,SEC,,');
    expect(body).toContain(',acc-1,assigned,outstanding,,');
  });

  it('emits a confirmed row with its version and confirmed_at_utc', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 3, confirmedAt: '2026-07-01T10:00:00.000Z', assignmentType: 'assigned' }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler((url) => (url.includes('/permission/check') ? jsonResponse(200, { hasPermission: true }) : jsonResponse(200, { displayName: 'Ayşe Yılmaz' })));

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('3,Ayşe Yılmaz,acc-1,assigned,confirmed,2026-07-01T10:00:00.000Z');
  });

  it('emits a voluntary row for a confirmer who is not assigned', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-vol', pageVersion: 1, assignmentType: 'voluntary' }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler((url) => (url.includes('/permission/check') ? jsonResponse(200, { hasPermission: true }) : jsonResponse(200, { displayName: 'X' })));

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('acc-vol,voluntary,confirmed');
  });

  it('emits cannot-view for an assigned user who fails the permission check, not outstanding', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-blocked'] }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler((url) => (url.includes('/permission/check') ? jsonResponse(200, { hasPermission: false }) : jsonResponse(404, {})));

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('acc-blocked,assigned,cannot-view');
  });

  it('resolves group-assigned users via membersByGroupId under the app tier', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [], assignedGroups: ['g1'] }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }] }));
    fakeApi.setHandler((url) => {
      if (url.includes('membersByGroupId')) return jsonResponse(200, { results: [{ accountId: 'acc-viaGroup' }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(404, {});
    });

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('acc-viaGroup,assigned,outstanding');
  });

  it('a deleted-page job entry produces "[deleted page {id}]" rows with no permission-check network call', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 5 }));
    await createExportJob(aJob({ pages: [{ pageId: 'page-1', title: null, deleted: true }] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) throw new Error('should never be called for a deleted page');
      return jsonResponse(200, { displayName: 'X' });
    });

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('[deleted page page-1]');
    expect(body).toContain('acc-1,assigned,confirmed');
  });

  it('applies the job\'s date range to confirmed rows only, never dropping outstanding rows', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-in', 'acc-out', 'acc-never'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-in', pageVersion: 1, confirmedAt: '2026-07-15T00:00:00.000Z' }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-out', pageVersion: 1, confirmedAt: '2026-01-01T00:00:00.000Z' }));
    await createExportJob(
      aJob({ pages: [{ pageId: 'page-1', title: 'X', deleted: false }], dateFrom: '2026-07-01', dateTo: '2026-07-31' }),
    );
    fakeApi.setHandler((url) => (url.includes('/permission/check') ? jsonResponse(200, { hasPermission: true }) : jsonResponse(200, { displayName: 'X' })));

    const body = bodyOf(await handler(request({ job: 'tok-1', k: 'test-secret' })));
    expect(body).toContain('acc-in,assigned,confirmed');
    expect(body).not.toContain('acc-out,assigned,confirmed');
    expect(body).toContain('acc-never,assigned,outstanding'); // negative space survives the date filter
  });

  it('skips a page whose config vanished between job creation and redemption, without crashing', async () => {
    await createExportJob(aJob({ pages: [{ pageId: 'page-gone', title: 'X', deleted: false }] }));
    fakeApi.setHandler(() => jsonResponse(404, {}));

    const response = await handler(request({ job: 'tok-1', k: 'test-secret' }));
    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).not.toContain('page-gone');
  });
});
