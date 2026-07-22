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
import { savePageConfig, getPageConfig } from '../storage/configs';
import { saveSettings } from '../storage/settings';
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
  SearchGroupsPayload,
  GroupOption,
  SearchPagesPayload,
  PageOption,
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
      data: {
        status: 'outstanding',
        pageVersion: 3,
        dueDate: null,
        isAssigned: false,
        confirmedAt: null,
        confirmedVersion: null,
        canConfigure: true,
      },
    });
  });

  it('isAssigned true when directly assigned', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'], dueDate: '2026-08-15' }));

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });

    expect(result).toEqual({
      ok: true,
      data: {
        status: 'outstanding',
        pageVersion: 1,
        dueDate: '2026-08-15',
        isAssigned: true,
        confirmedAt: null,
        confirmedVersion: null,
        canConfigure: true,
      },
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

  it('fetches the caller\'s group memberships at most once even when both canConfigure and isAssigned need them (efficiency fix)', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: ['compliance-team'], complianceManagersUserIds: [], reconfirmDefault: false });
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [], assignedGroups: ['sec-all'] }));

    let memberOfCalls = 0;
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) {
        memberOfCalls += 1;
        return jsonResponse(200, { results: [{ id: 'sec-all' }] });
      }
      return pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' })(url);
    });

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });

    expect((result as { ok: true; data: PageStatusResponse }).data.isAssigned).toBe(true);
    // Both isComplianceManager (via canConfigure) and isMemberOfAnyGroup (via
    // resolveIsAssigned) need this account's group memberships here -- the
    // memoized lookup (resolvers/index.ts's createGroupMembershipLookup)
    // must serve both from one fetch, not one paginated /user/memberof call
    // per consumer.
    expect(memberOfCalls).toBe(1);
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

  it('status expired reports the prior confirmedVersion, distinct from the new pageVersion (R4)', async () => {
    await savePageConfig(aPageConfig({ pageId: 'page-1', reconfirmOnChange: true }));
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 5, spaceId: '111' }));
    const confirmResult = await invoke<ConfirmPayload, ConfirmResponse>('confirm', { pageId: 'page-1', pageVersion: 5 });
    const confirmData = (confirmResult as { ok: true; data: ConfirmResponse & { outcome: 'confirmed' } }).data;

    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 7, spaceId: '111' }));
    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    const data = (result as { ok: true; data: PageStatusResponse }).data;

    expect(data.status).toBe('expired');
    expect(data.pageVersion).toBe(7);
    expect(data.confirmedVersion).toBe(5);
    expect(data.confirmedAt).toBe(confirmData.confirmedAt);
  });

  it('returns a typed error when the page cannot be read', async () => {
    fakeApi.setHandler(() => jsonResponse(403, {}));
    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    expect(result).toMatchObject({ ok: false, code: 'PAGE_READ_FAILED' });
  });

  it('canConfigure is false for a viewer with neither edit permission nor manager membership (T7)', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: false });
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [] });
      return pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' })(url);
    });

    const result = await invoke<PageStatusPayload, PageStatusResponse>('getPageStatus', { pageId: 'page-1' });
    expect((result as { ok: true; data: PageStatusResponse }).data.canConfigure).toBe(false);
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
      data: {
        pageId: 'page-1',
        assignedUsers: [],
        assignedGroups: [],
        assignedGroupOptions: [],
        dueDate: null,
        reconfirmOnChange: false,
      },
    });
  });

  it('saveConfig creates a new config, resolves spaceKey via a page read, and appends an audit entry', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'sec-all', name: 'Security All' });
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

    expect(result).toEqual({
      ok: true,
      data: { ...payload, assignedGroupOptions: [{ id: 'sec-all', name: 'Security All' }] },
    });

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

  it('a storage failure leaves neither the config write nor the audit entry persisted (data model §2.4 atomicity)', async () => {
    fakeApi.setHandler(pageAndSpaceHandler({ id: 'page-1', title: 'Policy', version: 1, spaceId: '111' }));
    jest.spyOn(fakeKvs, 'transact').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });

    const payload: SaveConfigPayload = {
      pageId: 'page-1',
      assignedUsers: ['acc-2'],
      assignedGroups: [],
      dueDate: null,
      reconfirmOnChange: false,
    };
    const result = await invoke<SaveConfigPayload, ConfigResponse>('saveConfig', payload);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    expect(await getPageConfig('page-1')).toBeUndefined();
    const audit = [];
    for await (const page of drainAuditByPage('page-1')) audit.push(...page);
    expect(audit).toHaveLength(0);
  });
});

describe('searchGroups (T7 config modal group field)', () => {
  it('is forbidden without edit permission or manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: false, results: [] }));
    const payload: SearchGroupsPayload = { pageId: 'page-1', query: 'sec' };
    const result = await invoke<SearchGroupsPayload, GroupOption[]>('searchGroups', payload);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('returns mapped group options for an authorized caller', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      if (url.includes('/group/picker')) {
        expect(url).toContain('query=sec');
        return jsonResponse(200, {
          results: [
            { id: 'g1', name: 'sec-all', type: 'group' },
            { id: 'g2', name: 'sec-managers', type: 'group' },
          ],
        });
      }
      return jsonResponse(200, { results: [] });
    });

    const payload: SearchGroupsPayload = { pageId: 'page-1', query: 'sec' };
    const result = await invoke<SearchGroupsPayload, GroupOption[]>('searchGroups', payload);
    expect(result).toEqual({
      ok: true,
      data: [
        { id: 'g1', name: 'sec-all' },
        { id: 'g2', name: 'sec-managers' },
      ],
    });
  });

  it('returns an empty list rather than an error on a non-200 response', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(500, {});
    });
    const payload: SearchGroupsPayload = { pageId: 'page-1', query: 'sec' };
    const result = await invoke<SearchGroupsPayload, GroupOption[]>('searchGroups', payload);
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('T13: without a pageId, gates on isConfluenceAdmin instead of canConfigure', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { operations: [], results: [] }));
    const payload: SearchGroupsPayload = { query: 'sec' };
    const result = await invoke<SearchGroupsPayload, GroupOption[]>('searchGroups', payload);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('T13: an admin without a pageId is authorized to search groups', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return jsonResponse(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
      if (url.includes('/group/picker')) return jsonResponse(200, { results: [{ id: 'g1', name: 'sec-all' }] });
      return jsonResponse(404, {});
    });
    const payload: SearchGroupsPayload = { query: 'sec' };
    const result = await invoke<SearchGroupsPayload, GroupOption[]>('searchGroups', payload);
    expect(result).toEqual({ ok: true, data: [{ id: 'g1', name: 'sec-all' }] });
  });
});

describe('searchPages (dashboard "track a page" search, 2026-07-22)', () => {
  it('is forbidden for a caller who is neither a Confluence admin nor a compliance manager', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { operations: [], results: [] }));
    const payload: SearchPagesPayload = { query: 'Security' };
    const result = await invoke<SearchPagesPayload, PageOption[]>('searchPages', payload);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('returns matching pages for an authorized compliance manager', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: ['managers-group'], complianceManagersUserIds: [], reconfirmDefault: false });
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers-group' }] });
      if (url.includes('/api/v2/pages')) {
        expect(url).toContain('title=Security');
        return jsonResponse(200, { results: [{ id: 'page-42', title: 'Security Policy' }] });
      }
      return jsonResponse(200, { operations: [] });
    });

    const payload: SearchPagesPayload = { query: 'Security' };
    const result = await invoke<SearchPagesPayload, PageOption[]>('searchPages', payload);
    expect(result).toEqual({ ok: true, data: [{ id: 'page-42', title: 'Security Policy' }] });
  });

  it('a genuine Confluence admin is authorized even with no compliance-managers group configured', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return jsonResponse(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
      if (url.includes('/api/v2/pages')) return jsonResponse(200, { results: [] });
      return jsonResponse(404, {});
    });
    const payload: SearchPagesPayload = { query: 'Security' };
    const result = await invoke<SearchPagesPayload, PageOption[]>('searchPages', payload);
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe('getSettings / saveSettings (T13 — admin-only, data model §2.3)', () => {
  it('getSettings is forbidden for a non-admin', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { operations: [] }));
    const result = await invoke('getSettings', {});
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('getSettings returns defaults before anything has been saved, for an admin', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { operations: [{ operation: 'administer', targetType: 'application' }] }));
    const result = await invoke('getSettings', {});
    expect(result).toEqual({
      ok: true,
      data: { complianceManagersGroupIds: [], complianceManagersGroupOptions: [], complianceManagersUserIds: [], reconfirmDefault: false },
    });
  });

  it('saveSettings is forbidden for a non-admin', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { operations: [] }));
    const result = await invoke('saveSettings', { complianceManagersGroupIds: ['g1'], complianceManagersUserIds: [], reconfirmDefault: false });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('an admin can save settings, and a subsequent getSettings reflects them (with group names resolved)', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return jsonResponse(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'g1', name: 'compliance-team' });
      return jsonResponse(404, {});
    });

    const saveResult = await invoke('saveSettings', { complianceManagersGroupIds: ['g1'], complianceManagersUserIds: ['acc-1'], reconfirmDefault: true });
    expect(saveResult).toEqual({
      ok: true,
      data: {
        complianceManagersGroupIds: ['g1'],
        complianceManagersGroupOptions: [{ id: 'g1', name: 'compliance-team' }],
        complianceManagersUserIds: ['acc-1'],
        reconfirmDefault: true,
      },
    });

    const getResult = await invoke('getSettings', {});
    expect(getResult).toEqual({
      ok: true,
      data: {
        complianceManagersGroupIds: ['g1'],
        complianceManagersGroupOptions: [{ id: 'g1', name: 'compliance-team' }],
        complianceManagersUserIds: ['acc-1'],
        reconfirmDefault: true,
      },
    });
  });
});
