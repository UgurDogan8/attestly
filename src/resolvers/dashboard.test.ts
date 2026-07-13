import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';
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
import { savePageConfig } from '../storage/configs';
import { saveSettings } from '../storage/settings';
import { resolvePageVisibility, buildDashboardRow, matchesStatusFilter, getDashboardRows } from './dashboard';
import type { DashboardRow, GetDashboardPayload } from '../shared';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

beforeEach(() => {
  fakeKvs.reset();
});

describe('resolvePageVisibility (tech design §4, normative)', () => {
  it('returns an empty map without making a request for an empty id list', async () => {
    fakeApi.setHandler(() => {
      throw new Error('should not be called');
    });
    expect(await resolvePageVisibility([])).toEqual(new Map());
  });

  it('marks pages returned by the bulk asUser call as visible with their title', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/api/v2/pages?id=page-1,page-2&limit=100');
      return jsonResponse(200, {
        results: [
          { id: 'page-1', title: 'Security Policy' },
          { id: 'page-2', title: 'Code of Conduct' },
        ],
      });
    });
    const result = await resolvePageVisibility(['page-1', 'page-2']);
    expect(result.get('page-1')).toEqual({ kind: 'visible', title: 'Security Policy' });
    expect(result.get('page-2')).toEqual({ kind: 'visible', title: 'Code of Conduct' });
  });

  it('probes pages missing from the bulk response: 404 -> deleted, 200 -> restricted', async () => {
    fakeApi.setHandler((url) => {
      if (url.startsWith('/wiki/api/v2/pages?')) {
        return jsonResponse(200, { results: [{ id: 'page-1', title: 'Visible Page' }] });
      }
      if (url === '/wiki/api/v2/pages/page-2') {
        return jsonResponse(404, {});
      }
      if (url === '/wiki/api/v2/pages/page-3') {
        return jsonResponse(200, { id: 'page-3' });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await resolvePageVisibility(['page-1', 'page-2', 'page-3']);
    expect(result.get('page-1')).toEqual({ kind: 'visible', title: 'Visible Page' });
    expect(result.get('page-2')).toEqual({ kind: 'deleted' });
    expect(result.get('page-3')).toEqual({ kind: 'restricted' });
  });

  it('falls through every id to the existence probe when the bulk call fails', async () => {
    fakeApi.setHandler((url) => {
      if (url.startsWith('/wiki/api/v2/pages?')) {
        return jsonResponse(500, {});
      }
      return jsonResponse(404, {}); // both individually resolve as deleted
    });
    const result = await resolvePageVisibility(['page-1', 'page-2']);
    expect(result.get('page-1')).toEqual({ kind: 'deleted' });
    expect(result.get('page-2')).toEqual({ kind: 'deleted' });
  });

  it('falls through every id to the existence probe when the bulk call throws', async () => {
    fakeApi.setHandler((url) => {
      if (url.startsWith('/wiki/api/v2/pages?')) {
        throw new Error('network blip');
      }
      return jsonResponse(404, {});
    });
    const result = await resolvePageVisibility(['page-1']);
    expect(result.get('page-1')).toEqual({ kind: 'deleted' });
  });

  it('fails closed to restricted (never a guess at content) when the existence probe itself throws', async () => {
    fakeApi.setHandler((url) => {
      if (url.startsWith('/wiki/api/v2/pages?')) {
        return jsonResponse(200, { results: [] });
      }
      throw new Error('network blip');
    });
    const result = await resolvePageVisibility(['page-1']);
    expect(result.get('page-1')).toEqual({ kind: 'restricted' });
  });

  it('PR review regression: chunks a >100-id request into multiple bulk calls instead of silently dropping the overflow as restricted', async () => {
    const pageIds = Array.from({ length: 150 }, (_, i) => `page-${i}`);
    const bulkCalls: string[] = [];
    fakeApi.setHandler((url) => {
      if (url.startsWith('/wiki/api/v2/pages?')) {
        bulkCalls.push(url);
        const idsParam = new URL(`https://x${url}`).searchParams.get('id') ?? '';
        const ids = idsParam.split(',');
        return jsonResponse(200, { results: ids.map((id) => ({ id, title: `Title ${id}` })) });
      }
      throw new Error(`unexpected existence-probe call for ${url}`);
    });

    const result = await resolvePageVisibility(pageIds);

    // Two batches of ≤100, not one truncated request.
    expect(bulkCalls).toHaveLength(2);
    expect(result.size).toBe(150);
    for (const id of pageIds) {
      expect(result.get(id)).toEqual({ kind: 'visible', title: `Title ${id}` });
    }
  });
});

describe('buildDashboardRow', () => {
  it('returns null for a restricted page (omitted entirely)', () => {
    expect(buildDashboardRow(aPageConfig(), { kind: 'restricted' })).toBeNull();
  });

  it('a deleted page shows title:null, deleted:true, and percent:none regardless of counters', () => {
    const config = aPageConfig({
      pageId: 'page-1',
      assignedUsers: ['acc-1', 'acc-2'],
      counters: { confirmedCurrentVersion: 1 },
      dueDate: '2020-01-01', // long past -- must NOT be marked overdue once deleted
    });
    const row = buildDashboardRow(config, { kind: 'deleted' });
    expect(row).toMatchObject({ title: null, deleted: true, percent: { kind: 'none' }, overdue: false });
  });

  it('a visible page computes assignedCount and percent from advisory counters', () => {
    const config = aPageConfig({
      pageId: 'page-1',
      spaceKey: 'SEC',
      assignedUsers: ['acc-1', 'acc-2'],
      counters: { confirmedCurrentVersion: 1 },
      dueDate: null,
    });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'Security Policy' });
    expect(row).toEqual({
      pageId: 'page-1',
      title: 'Security Policy',
      deleted: false,
      spaceKey: 'SEC',
      assignedCount: 2,
      percent: { kind: 'value', percent: 0.5, confirmedCount: 1, eligibleCount: 2 },
      dueDate: null,
      overdue: false,
    });
  });

  it('overdue: incomplete + past due date', () => {
    const config = aPageConfig({ assignedUsers: ['acc-1'], counters: { confirmedCurrentVersion: 0 }, dueDate: '2020-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.overdue).toBe(true);
  });

  it('not overdue when already 100% complete, even with a past due date', () => {
    const config = aPageConfig({ assignedUsers: ['acc-1'], counters: { confirmedCurrentVersion: 1 }, dueDate: '2020-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.overdue).toBe(false);
  });

  it('not overdue when the due date is in the future', () => {
    const config = aPageConfig({ assignedUsers: ['acc-1'], counters: { confirmedCurrentVersion: 0 }, dueDate: '2999-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.overdue).toBe(false);
  });

  it('a voluntary-only page (0 assigned) is never overdue, regardless of due date', () => {
    const config = aPageConfig({ assignedUsers: [], assignedGroups: [], dueDate: '2020-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.percent).toEqual({ kind: 'none' });
    expect(row?.overdue).toBe(false);
  });

  it('a page assigned only via a group (no direct users) can still be overdue (regression: assignedCount alone used to force overdue=false for every group-only page)', () => {
    const config = aPageConfig({ assignedUsers: [], assignedGroups: ['team-x'], dueDate: '2020-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.percent).toEqual({ kind: 'none' }); // still advisory-none -- list view never resolves group membership
    expect(row?.overdue).toBe(true);
  });

  it('a group-only page with a future due date is not overdue', () => {
    const config = aPageConfig({ assignedUsers: [], assignedGroups: ['team-x'], dueDate: '2999-01-01' });
    const row = buildDashboardRow(config, { kind: 'visible', title: 'X' });
    expect(row?.overdue).toBe(false);
  });
});

describe('matchesStatusFilter', () => {
  function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
    return {
      pageId: 'page-1',
      title: 'X',
      deleted: false,
      spaceKey: 'SEC',
      assignedCount: 2,
      percent: { kind: 'value', percent: 0.5, confirmedCount: 1, eligibleCount: 2 },
      dueDate: null,
      overdue: false,
      ...overrides,
    };
  }

  it('all matches everything', () => {
    expect(matchesStatusFilter(row(), 'all')).toBe(true);
    expect(matchesStatusFilter(row({ percent: { kind: 'none' } }), 'all')).toBe(true);
  });

  it('complete matches only 100%', () => {
    expect(matchesStatusFilter(row({ percent: { kind: 'value', percent: 1, confirmedCount: 2, eligibleCount: 2 } }), 'complete')).toBe(true);
    expect(matchesStatusFilter(row(), 'complete')).toBe(false);
    expect(matchesStatusFilter(row({ percent: { kind: 'none' } }), 'complete')).toBe(false);
  });

  it('incomplete matches only <100%', () => {
    expect(matchesStatusFilter(row(), 'incomplete')).toBe(true);
    expect(matchesStatusFilter(row({ percent: { kind: 'value', percent: 1, confirmedCount: 2, eligibleCount: 2 } }), 'incomplete')).toBe(false);
  });

  it('overdue matches only row.overdue', () => {
    expect(matchesStatusFilter(row({ overdue: true }), 'overdue')).toBe(true);
    expect(matchesStatusFilter(row({ overdue: false }), 'overdue')).toBe(false);
  });
});

describe('getDashboardRows (role gate + orchestration)', () => {
  it('forbidden without compliance-manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    const result = await getDashboardRows({}, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('happy path: returns visible rows and a cursor', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-2'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy' }] });
      return jsonResponse(404, {});
    });

    const result = await getDashboardRows({}, 'acc-1');
    expect(result).toMatchObject({
      ok: true,
      data: { rows: [{ pageId: 'page-1', title: 'Security Policy', deleted: false }], nextCursor: null },
    });
  });

  it('a restricted page is entirely absent from the returned rows', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
    await savePageConfig(aPageConfig({ pageId: 'visible-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'restricted-page', spaceKey: 'SEC' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'visible-page', title: 'Visible' }] });
      if (url === '/wiki/api/v2/pages/restricted-page') return jsonResponse(200, {}); // exists, but not in bulk -> restricted
      return jsonResponse(404, {});
    });

    const result = await getDashboardRows({}, 'acc-1');
    const pageIds = (result as { ok: true; data: { rows: DashboardRow[] } }).data.rows.map((r) => r.pageId);
    expect(pageIds).toEqual(['visible-page']);
  });

  it('applies the status filter', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
    await savePageConfig(
      aPageConfig({ pageId: 'done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 1 } }),
    );
    await savePageConfig(
      aPageConfig({ pageId: 'not-done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 0 } }),
    );
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) {
        return jsonResponse(200, {
          results: [
            { id: 'done', title: 'Done' },
            { id: 'not-done', title: 'Not done' },
          ],
        });
      }
      return jsonResponse(404, {});
    });

    const payload: GetDashboardPayload = { statusFilter: 'complete' };
    const result = await getDashboardRows(payload, 'acc-1');
    const pageIds = (result as { ok: true; data: { rows: DashboardRow[] } }).data.rows.map((r) => r.pageId);
    expect(pageIds).toEqual(['done']);
  });

  it('applies the space filter (via the tracked index, at the storage layer)', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC' }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) {
        return jsonResponse(200, { results: [{ id: 'sec-page', title: 'SEC page' }] });
      }
      return jsonResponse(404, {});
    });

    const result = await getDashboardRows({ spaceKey: 'SEC' }, 'acc-1');
    const pageIds = (result as { ok: true; data: { rows: DashboardRow[] } }).data.rows.map((r) => r.pageId);
    expect(pageIds).toEqual(['sec-page']);
  });
});
