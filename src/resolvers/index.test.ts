import Resolver from '@forge/resolver';
import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse, type FakeRequestHandler } from '../testUtils/forgeApiFake';
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
import { registerResolvers } from './index';
import { savePageConfig } from '../storage/configs';
import { drainByPage } from '../storage/confirmations';
import { drainAuditByPage } from '../storage/audit';
import type {
  Result,
  PageStatusPayload,
  PageStatusResponse,
  ConfirmPayload,
  ConfirmResponse,
  GetConfigPayload,
  SaveConfigPayload,
  ConfigResponse,
} from '../shared';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

// Build one real Resolver, register the real handlers, and call through
// getDefinitions() exactly like the Forge runtime would — this exercises
// the actual invoke() dispatch path, not just the handler functions in isolation.
const resolver = new Resolver();
registerResolvers(resolver);
const handler = resolver.getDefinitions();

// The real @forge/resolver only ever populates request.context.accountId
// from the *second* argument's `principal.accountId` (verified against the
// package's compiled source, not just its .d.ts) — never from a
// caller-supplied `context` on the invoke payload itself. Simulate that
// exactly so this test exercises the real dispatch contract.
function invoke<Payload, Data>(functionKey: string, payload: Payload, accountId = 'acc-1'): Promise<Result<Data>> {
  return handler(
    { call: { functionKey, payload: payload as never }, context: {} },
    { principal: { accountId } },
  ) as Promise<Result<Data>>;
}

/** Handles the two Confluence calls getPageStatus/confirm need: page read and space read. */
function pageAndSpaceHandler(page: { id: string; title: string; version: number; spaceId: string }): FakeRequestHandler {
  return (url) => {
    if (url === `/wiki/api/v2/pages/${page.id}`) {
      return jsonResponse(200, { id: page.id, title: page.title, version: { number: page.version }, spaceId: page.spaceId });
    }
    if (url === `/wiki/api/v2/spaces/${page.spaceId}`) {
      return jsonResponse(200, { key: 'SEC' });
    }
    if (url.includes('/permission/check')) {
      return jsonResponse(200, { hasPermission: true });
    }
    if (url.includes('/user/memberof')) {
      return jsonResponse(200, { results: [] });
    }
    return jsonResponse(404, {});
  };
}

beforeEach(() => {
  fakeKvs.reset();
  fakeApi.setHandler(() => jsonResponse(404, {}));
});

describe('getPageStatus', () => {
  it('outstanding + not assigned when there is no config and no confirmation', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 3, spaceId: '111' }));

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });

    expect(result).toEqual({
      ok: true,
      data: { status: 'outstanding', pageVersion: 3, dueDate: null, isAssigned: false, confirmedAt: null },
    });
  });

  it('isAssigned true when directly assigned', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'], dueDate: '2026-08-15' }));

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });

    expect(result).toEqual({
      ok: true,
      data: { status: 'outstanding', pageVersion: 1, dueDate: '2026-08-15', isAssigned: true, confirmedAt: null },
    });
  });

  it('isAssigned true when assigned only via a group', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'sec-all' }] });
      return pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' })(url);
    });
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [], assignedGroups: ['sec-all'] }));

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    expect((result as { ok: true; data: PageStatusResponse }).data.isAssigned).toBe(true);
  });

  it('status confirmed after a prior confirmation at the current version', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 5, spaceId: '111' }));
    const confirmResult = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 5 });

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    const data = (result as { ok: true; data: PageStatusResponse }).data;
    expect(data.status).toBe('confirmed');
    // confirmedAt must survive a page reload (getPageStatus), not just the
    // fresh confirm response — R3 needs it on every render, not once.
    const confirmData = (confirmResult as { ok: true; data: ConfirmResponse & { outcome: 'confirmed' } }).data;
    expect(data.confirmedAt).toBe(confirmData.confirmedAt);
  });

  it('returns a typed error when the page cannot be read', async () => {
    fakeApi.setHandler(() => jsonResponse(403, {}));
    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    expect(result).toMatchObject({ ok: false, code: 'PAGE_READ_FAILED' });
  });
});

describe('confirm (tech design §6.1/§6.3/§8)', () => {
  it('records a confirmation at the server-read version when the client version matches', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 7, spaceId: '111' }));

    const result = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 7 });

    expect(result).toMatchObject({ ok: true, data: { outcome: 'confirmed', status: 'confirmed', pageVersion: 7 } });
    const records = [];
    for await (const page of drainByPage('page-1')) records.push(...page);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 7, spaceKey: 'SEC' });
  });

  it('a forged client version cannot make the server record the wrong version (tech design §6.3)', async () => {
    // Server truth is v7; the client claims it rendered v3 (devtools-forged payload).
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 7, spaceId: '111' }));

    const result = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 3 });

    expect(result).toEqual({ ok: true, data: { outcome: 'pageChanged', currentVersion: 7 } });
    const records = [];
    for await (const page of drainByPage('page-1')) records.push(...page);
    expect(records).toHaveLength(0); // nothing written
  });

  it('repeat confirm is idempotent — same confirmedAt both times', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));

    const first = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });
    const second = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });

    const firstData = (first as { ok: true; data: ConfirmResponse & { outcome: 'confirmed' } }).data;
    const secondData = (second as { ok: true; data: ConfirmResponse & { outcome: 'confirmed' } }).data;
    expect(secondData.confirmedAt).toBe(firstData.confirmedAt);

    const records = [];
    for await (const page of drainByPage('page-1')) records.push(...page);
    expect(records).toHaveLength(1);
  });

  it('assignmentType is voluntary when the user is not assigned', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });

    const records = [];
    for await (const page of drainByPage('page-1')) records.push(...page);
    expect(records[0].assignmentType).toBe('voluntary');
  });

  it('assignmentType is assigned when the user is directly assigned', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'] }));
    await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });

    const records = [];
    for await (const page of drainByPage('page-1')) records.push(...page);
    expect(records[0].assignmentType).toBe('assigned');
  });

  it('a user without page view permission cannot confirm (404-equivalent, nothing leaks)', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    const result = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });
    expect(result).toMatchObject({ ok: false, code: 'PAGE_READ_FAILED' });
  });

  it('a storage failure surfaces as a retryable error, not a crash', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    const originalTransact = fakeKvs.transact.bind(fakeKvs);
    jest.spyOn(fakeKvs, 'transact').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });

    const result = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 1 });

    expect(result).toMatchObject({ ok: false, code: 'CONFIRM_FAILED' });
    fakeKvs.transact = originalTransact;
  });
});

describe('getConfig / saveConfig (tech design §4 — edit permission OR compliance manager)', () => {
  it('getConfig is forbidden without edit permission or manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: false, results: [] }));
    const result = await invoke<GetConfigPayload, ConfigResponse>('getConfig', { pageId: 'page-1' });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('getConfig returns defaults when the page has no config yet', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: true }));
    const result = await invoke<GetConfigPayload, ConfigResponse>('getConfig', { pageId: 'page-1' });
    expect(result).toEqual({
      ok: true,
      data: { pageId: 'page-1', assignedUsers: [], assignedGroups: [], dueDate: null, reconfirmOnChange: false },
    });
  });

  it('saveConfig creates a new config, resolves spaceKey via a page read, and appends an audit entry', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' })(url);
    });

    const payload: SaveConfigPayload = {
      pageId: 'page-1',
      assignedUsers: ['acc-2'],
      assignedGroups: ['sec-all'],
      dueDate: '2026-08-15',
      reconfirmOnChange: true,
    };
    const result = await invoke<SaveConfigPayload, ConfigResponse>('saveConfig', payload);

    expect(result).toEqual({ ok: true, data: payload });

    const audit = [];
    for await (const page of drainAuditByPage('page-1')) audit.push(...page);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: 'acc-1', entry: { action: 'created', before: null } });
  });

  it('saveConfig on an existing config preserves createdBy/createdAt/counters and logs a before/after diff', async () => {
    await savePageConfig(
      aPageConfig({
        pageId: 'page-1',
        spaceKey: 'SEC',
        createdBy: 'acc-original',
        createdAt: '2026-01-01T00:00:00.000Z',
        assignedUsers: ['acc-2'],
        counters: { confirmedCurrentVersion: 4 },
      }),
    );
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: true }));

    const payload: SaveConfigPayload = {
      pageId: 'page-1',
      assignedUsers: ['acc-2', 'acc-3'],
      assignedGroups: [],
      dueDate: null,
      reconfirmOnChange: false,
    };
    await invoke<SaveConfigPayload, ConfigResponse>('saveConfig', payload);

    const config = await import('../storage/configs').then((m) => m.getPageConfig('page-1'));
    expect(config).toMatchObject({
      createdBy: 'acc-original',
      createdAt: '2026-01-01T00:00:00.000Z',
      counters: { confirmedCurrentVersion: 4 },
      assignedUsers: ['acc-2', 'acc-3'],
    });

    const audit = [];
    for await (const page of drainAuditByPage('page-1')) audit.push(...page);
    expect(audit[0].entry).toMatchObject({
      action: 'updated',
      before: { assignedUsers: ['acc-2'] },
      after: { assignedUsers: ['acc-2', 'acc-3'] },
    });
  });

  it('saveConfig is forbidden without edit permission or manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: false, results: [] }));
    const payload: SaveConfigPayload = {
      pageId: 'page-1',
      assignedUsers: [],
      assignedGroups: [],
      dueDate: null,
      reconfirmOnChange: false,
    };
    const result = await invoke<SaveConfigPayload, ConfigResponse>('saveConfig', payload);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
