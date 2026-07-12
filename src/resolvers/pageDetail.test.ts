import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';
import { aPageConfig, aConfirmation, anAuditEntry } from '../testUtils/fixtures';

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
import { savePageConfig, getPageConfig } from '../storage/configs';
import { saveSettings } from '../storage/settings';
import { writeConfirmation } from '../storage/confirmations';
import { appendAuditEntry } from '../storage/audit';
import { getPageDetail, getPageHistory } from './pageDetail';
import type { DetailUserRow, GetPageHistoryResponse } from '../shared';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

beforeEach(() => {
  fakeKvs.reset();
});

async function asManager(): Promise<void> {
  await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
}

/** Default handler: the viewer is a compliance manager, the page is visible at v1, no groups. */
function defaultHandler(overrides: Record<string, unknown> = {}) {
  return (url: string) => {
    if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
    if (url.startsWith('/wiki/api/v2/pages?')) {
      return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
    }
    if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
    if (url.includes('/group/') && url.includes('/membersByGroupId')) return jsonResponse(200, { results: [] });
    if (url.includes('/group/by-id')) return jsonResponse(404, {});
    return jsonResponse(404, overrides);
  };
}

describe('getPageDetail — access gates', () => {
  it('FORBIDDEN without compliance-manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('NOT_FOUND for an untracked page', async () => {
    await asManager();
    fakeApi.setHandler(defaultHandler());
    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('FORBIDDEN when the viewing manager cannot see the page themselves (visibility rule)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [] });
      if (url === '/wiki/api/v2/pages/page-1') return jsonResponse(200, {}); // exists but not in bulk -> restricted
      return jsonResponse(404, {});
    });
    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('getPageDetail — assignment sources (TC-D4: group membership resolved at call time)', () => {
  it('a directly assigned user is labeled "direct"', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-direct'], assignedGroups: [] }));
    fakeApi.setHandler(defaultHandler());

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    const rows = (result as { ok: true; data: { outstanding: DetailUserRow[] } }).data.outstanding;
    expect(rows).toEqual([
      expect.objectContaining({ accountId: 'acc-direct', assignmentSource: { kind: 'direct' } }),
    ]);
  });

  it('a group member is labeled with the resolved group name, live at call time', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [], assignedGroups: ['g1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      if (url.includes('membersByGroupId')) return jsonResponse(200, { results: [{ accountId: 'acc-viaGroup' }] });
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'g1', name: 'sec-all' });
      return jsonResponse(404, {});
    });

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    const rows = (result as { ok: true; data: { outstanding: DetailUserRow[] } }).data.outstanding;
    expect(rows).toEqual([
      expect.objectContaining({
        accountId: 'acc-viaGroup',
        assignmentSource: { kind: 'group', groupId: 'g1', groupName: 'sec-all' },
      }),
    ]);
  });

  it('a deleted group contributes zero members and is reported in staleAssignedGroupIds', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [], assignedGroups: ['gone'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
      return jsonResponse(404, {}); // group membership + group name both fail to resolve
    });

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    const data = (result as { ok: true; data: { outstanding: DetailUserRow[]; staleAssignedGroupIds: string[]; summary: { assigned: number } } }).data;
    expect(data.outstanding).toEqual([]);
    expect(data.summary.assigned).toBe(0);
    expect(data.staleAssignedGroupIds).toEqual(['gone']);
  });

  it('direct assignment wins when a user is both directly assigned and in an assigned group', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-both'], assignedGroups: ['g1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      if (url.includes('membersByGroupId')) return jsonResponse(200, { results: [{ accountId: 'acc-both' }] });
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'g1', name: 'sec-all' });
      return jsonResponse(404, {});
    });

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-1');
    const rows = (result as { ok: true; data: { outstanding: DetailUserRow[]; summary: { assigned: number } } }).data;
    expect(rows.summary.assigned).toBe(1); // deduped, not double-counted
    expect(rows.outstanding[0].assignmentSource).toEqual({ kind: 'direct' });
  });
});

describe('getPageDetail — status buckets', () => {
  it('an assigned user with no confirmation record is outstanding', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler(defaultHandler());

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: { outstanding: DetailUserRow[]; confirmed: DetailUserRow[] } }).data;
    expect(data.outstanding).toHaveLength(1);
    expect(data.confirmed).toHaveLength(0);
  });

  it('an assigned user who confirmed the current version is confirmed', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1, assignmentType: 'assigned' }));
    fakeApi.setHandler(defaultHandler());

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: { confirmed: DetailUserRow[] } }).data;
    expect(data.confirmed).toEqual([
      expect.objectContaining({ accountId: 'acc-1', status: 'confirmed', pageVersion: 1 }),
    ]);
  });

  it(
    'TC-D5: an assigned user who cannot view the page is surfaced in cannotView, ' +
      'never counted as outstanding, and excluded from the % denominator',
    async () => {
      await asManager();
      await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-blocked'] }));
      fakeApi.setHandler((url) => {
        if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
        if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
        if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: false });
        return jsonResponse(404, {});
      });

      const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
      const data = (
        result as { ok: true; data: { cannotView: DetailUserRow[]; outstanding: DetailUserRow[]; summary: { cannotView: number; assigned: number } } }
      ).data;
      expect(data.cannotView).toEqual([expect.objectContaining({ accountId: 'acc-blocked', status: 'cannot-view' })]);
      expect(data.outstanding).toEqual([]);
      expect(data.summary.cannotView).toBe(1);
    },
  );

  it('a 404 permission check maps to cannotView with deletedUser: true, not a crash', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-gone'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(404, {});
      return jsonResponse(404, {});
    });

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: { cannotView: DetailUserRow[] } }).data;
    expect(data.cannotView).toEqual([expect.objectContaining({ accountId: 'acc-gone', deletedUser: true })]);
  });

  it('a confirmer who is not currently assigned appears in voluntary, not confirmed', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-vol', pageVersion: 1, assignmentType: 'voluntary' }));
    fakeApi.setHandler(defaultHandler());

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: { voluntary: DetailUserRow[]; confirmed: DetailUserRow[] } }).data;
    expect(data.voluntary).toEqual([expect.objectContaining({ accountId: 'acc-vol', assignmentType: 'voluntary' })]);
    expect(data.confirmed).toEqual([]);
  });

  it('TC-D6: 100 assignees resolve without error and every row lands in exactly one bucket', async () => {
    await asManager();
    const users = Array.from({ length: 100 }, (_, i) => `acc-${i}`);
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: users }));
    fakeApi.setHandler(defaultHandler());

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: { outstanding: DetailUserRow[]; summary: { assigned: number } } }).data;
    expect(data.summary.assigned).toBe(100);
    expect(data.outstanding).toHaveLength(100);
  });
});

describe('getPageDetail — deleted page (data model §3.1: still available for drill-down)', () => {
  it('an assigned user with a record shows confirmed; without, outstanding; no cannot-view checks run', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1', 'acc-2'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 3 }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [] }); // not in bulk response
      if (url === '/wiki/api/v2/pages/page-1') return jsonResponse(404, {}); // 404 -> deleted
      if (url.includes('/permission/check')) throw new Error('should never be called for a deleted page');
      return jsonResponse(404, {});
    });

    const result = await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');
    const data = (
      result as { ok: true; data: { deleted: boolean; title: string | null; confirmed: DetailUserRow[]; outstanding: DetailUserRow[] } }
    ).data;
    expect(data.deleted).toBe(true);
    expect(data.title).toBeNull();
    expect(data.confirmed).toEqual([expect.objectContaining({ accountId: 'acc-1' })]);
    expect(data.outstanding).toEqual([expect.objectContaining({ accountId: 'acc-2' })]);
  });
});

describe('getPageDetail — counter self-heal (tech design §5)', () => {
  it('corrects a stale advisory counter to the exact confirmed-among-assigned count', async () => {
    await asManager();
    await savePageConfig(
      aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'], counters: { confirmedCurrentVersion: 99 } }),
    );
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1 }));
    fakeApi.setHandler(defaultHandler());

    await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');

    const healed = await getPageConfig('page-1');
    expect(healed?.counters.confirmedCurrentVersion).toBe(1);
  });

  it('does not write when the counter is already correct', async () => {
    await asManager();
    await savePageConfig(
      aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'], counters: { confirmedCurrentVersion: 0 }, updatedAt: 'unchanged' }),
    );
    fakeApi.setHandler(defaultHandler());

    await getPageDetail({ pageId: 'page-1' }, 'acc-viewer');

    const config = await getPageConfig('page-1');
    expect(config?.updatedAt).toBe('unchanged'); // savePageConfig was never called again
  });
});

describe('getPageHistory (data model §2.4 — History tab)', () => {
  it('FORBIDDEN without compliance-manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    const result = await getPageHistory({ pageId: 'page-1' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('TC-D8: returns diffed, name-resolved config-audit entries for the page, most recent first', async () => {
    await asManager();
    await appendAuditEntry(
      anAuditEntry({
        pageId: 'page-1',
        at: '2026-07-01T00:00:00.000Z',
        actor: 'acc-admin',
        entry: { action: 'created', before: null, after: { assignedUsers: ['acc-1'], assignedGroups: [], dueDate: null } },
      }),
    );
    await appendAuditEntry(
      anAuditEntry({
        pageId: 'page-1',
        at: '2026-07-05T00:00:00.000Z',
        actor: 'acc-admin',
        entry: {
          action: 'updated',
          before: { assignedUsers: ['acc-1'], assignedGroups: [], dueDate: null },
          after: { assignedUsers: ['acc-1', 'acc-2'], assignedGroups: ['g1'], dueDate: '2026-08-01' },
        },
      }),
    );
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'g1', name: 'Security All' });
      if (url.includes('accountId=acc-admin')) return jsonResponse(200, { displayName: 'Jane Admin' });
      if (url.includes('accountId=acc-2')) return jsonResponse(200, { displayName: 'Ayşe Yılmaz' });
      return jsonResponse(404, {});
    });

    const result = await getPageHistory({ pageId: 'page-1' }, 'acc-viewer');
    const data = (result as { ok: true; data: GetPageHistoryResponse }).data;

    expect(data.entries).toHaveLength(2);
    // Most recent first (the "updated" entry).
    expect(data.entries[0]).toEqual({
      at: '2026-07-05T00:00:00.000Z',
      actorName: 'Jane Admin',
      changes: expect.arrayContaining([
        { kind: 'assigned', subjectType: 'user', subjectName: 'Ayşe Yılmaz' },
        { kind: 'assigned', subjectType: 'group', subjectName: 'Security All' },
        { kind: 'dueDate', dueDate: '2026-08-01' },
      ]),
    });
    expect(data.entries[1]).toEqual({
      at: '2026-07-01T00:00:00.000Z',
      actorName: 'Jane Admin',
      // acc-1 has no mock — falls back to the same "unresolvable" label the export CSV uses.
      changes: [{ kind: 'assigned', subjectType: 'user', subjectName: '[deleted user]' }],
    });
  });
});
