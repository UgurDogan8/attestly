import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, FakeWebTrigger, jsonResponse } from '../testUtils/forgeApiFake';
import { aPageConfig } from '../testUtils/fixtures';

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
  const { FakeForgeApi: Fake, FakeWebTrigger: FakeTrigger, fakeRoute, fakeAssumeTrustedRoute } = require('../testUtils/forgeApiFake');
  return {
    __esModule: true,
    default: new Fake(),
    route: fakeRoute,
    assumeTrustedRoute: fakeAssumeTrustedRoute,
    webTrigger: new FakeTrigger(),
  };
});

import kvsFake from '@forge/kvs';
import apiFake, { webTrigger } from '@forge/api';
import { savePageConfig } from '../storage/configs';
import { saveSettings } from '../storage/settings';
import { getExportJob } from '../storage/exportJobs';
import { startExport } from './export';
import type { StartExportPayload } from '../shared';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;
const fakeWebTrigger = webTrigger as unknown as FakeWebTrigger;

const ORIGINAL_SECRET = process.env.EXPORT_SECRET;

beforeEach(() => {
  fakeKvs.reset();
  fakeWebTrigger.getUrl.mockClear();
  process.env.EXPORT_SECRET = 'test-secret';
});

afterAll(() => {
  process.env.EXPORT_SECRET = ORIGINAL_SECRET;
});

async function asManager(): Promise<void> {
  await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
}

function visibleHandler(pages: { id: string; title: string }[] = []) {
  return (url: string) => {
    if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
    if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: pages });
    return jsonResponse(404, {});
  };
}

describe('startExport — access gates', () => {
  it('FORBIDDEN without compliance-manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('EXPORT_NOT_CONFIGURED when EXPORT_SECRET is unset (deployment prerequisite)', async () => {
    delete process.env.EXPORT_SECRET;
    await asManager();
    fakeApi.setHandler(visibleHandler());
    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'EXPORT_NOT_CONFIGURED' });
  });
});

describe('startExport — scope resolution', () => {
  it('scope "site": includes every tracked page across spaces', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR' }));
    fakeApi.setHandler(
      visibleHandler([
        { id: 'sec-page', title: 'Sec' },
        { id: 'hr-page', title: 'HR' },
      ]),
    );

    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result.ok).toBe(true);
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages.map((p) => p.pageId).sort()).toEqual(['hr-page', 'sec-page']);
  });

  it('scope "space": includes only that space\'s tracked pages', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR' }));
    fakeApi.setHandler(visibleHandler([{ id: 'sec-page', title: 'Sec' }]));

    const result = await startExport({ format: 'csv', scope: 'space', scopeValue: 'SEC' }, 'acc-1');
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages.map((p) => p.pageId)).toEqual(['sec-page']);
  });

  it('scope "page": includes only that one page', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR' }));
    fakeApi.setHandler(visibleHandler([{ id: 'sec-page', title: 'Sec' }]));

    const result = await startExport({ format: 'csv', scope: 'page', scopeValue: 'sec-page' }, 'acc-1');
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages.map((p) => p.pageId)).toEqual(['sec-page']);
  });

  it('a restricted page is omitted from the job entirely (visibility rule)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'visible-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'restricted-page', spaceKey: 'SEC' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'visible-page', title: 'Visible' }] });
      if (url === '/wiki/api/v2/pages/restricted-page') return jsonResponse(200, {});
      return jsonResponse(404, {});
    });

    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages.map((p) => p.pageId)).toEqual(['visible-page']);
  });

  it('a deleted page is included, with title:null and deleted:true (never omitted)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'gone-page', spaceKey: 'SEC' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [] });
      if (url === '/wiki/api/v2/pages/gone-page') return jsonResponse(404, {});
      return jsonResponse(404, {});
    });

    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages).toEqual([{ pageId: 'gone-page', title: null, deleted: true }]);
  });

  it('applies the status filter the same way the dashboard does', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 1 } }));
    await savePageConfig(aPageConfig({ pageId: 'not-done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 0 } }));
    fakeApi.setHandler(
      visibleHandler([
        { id: 'done', title: 'Done' },
        { id: 'not-done', title: 'Not done' },
      ]),
    );

    const payload: StartExportPayload = { format: 'csv', scope: 'site', statusFilter: 'complete' };
    const result = await startExport(payload, 'acc-1');
    const token = new URL((result as { ok: true; data: { url: string } }).data.url).searchParams.get('job');
    const job = await getExportJob(token ?? '');
    expect(job?.pages.map((p) => p.pageId)).toEqual(['done']);
  });
});

describe('startExport — the returned URL', () => {
  it('embeds the job token and the export secret as query params', async () => {
    await asManager();
    fakeApi.setHandler(visibleHandler());
    fakeWebTrigger.urlByModuleKey['export-trigger'] = 'https://site.example/x/abc/export-trigger';

    const result = await startExport({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result.ok).toBe(true);
    const url = new URL((result as { ok: true; data: { url: string } }).data.url);
    expect(url.origin + url.pathname).toBe('https://site.example/x/abc/export-trigger');
    expect(url.searchParams.get('k')).toBe('test-secret');
    expect(url.searchParams.get('job')).toBeTruthy();
    expect(fakeWebTrigger.getUrl).toHaveBeenCalledWith('export-trigger');
  });
});
