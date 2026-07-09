import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse, type FakeRequestHandler } from '../testUtils/forgeApiFake';

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
import { saveSettings } from '../storage/settings';
import {
  readPageAsUser,
  resolveSpaceKey,
  hasEditPermission,
  getCurrentUserGroupIds,
  isMemberOfAnyGroup,
  isComplianceManager,
  canConfigure,
  searchGroupsByQuery,
  resolveGroupNames,
  checkViewPermission,
  getGroupMemberAccountIds,
  resolveUserDisplayName,
} from './auth';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

beforeEach(() => {
  fakeKvs.reset();
});

describe('readPageAsUser (tech design §4/§6.3 — server-authoritative page read)', () => {
  it('returns the page on a 200 response', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/api/v2/pages/page-1');
      return jsonResponse(200, { id: 'page-1', title: 'Security Policy', version: { number: 7 }, spaceId: '111' });
    });

    const result = await readPageAsUser('page-1');
    expect(result).toEqual({
      ok: true,
      page: { id: 'page-1', title: 'Security Policy', version: 7, spaceId: '111' },
    });
  });

  it('returns ok:false with the status on a non-200 (no view permission / not found)', async () => {
    fakeApi.setHandler(() => jsonResponse(403, {}));
    expect(await readPageAsUser('page-1')).toEqual({ ok: false, status: 403 });
  });
});

describe('resolveSpaceKey (best-effort, never blocks a confirmation)', () => {
  it('returns the key on success', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/api/v2/spaces/111');
      return jsonResponse(200, { key: 'SEC' });
    });
    expect(await resolveSpaceKey('111')).toBe('SEC');
  });

  it('falls back to the spaceId on a non-200 response', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await resolveSpaceKey('111')).toBe('111');
  });

  it('falls back to the spaceId when the request throws', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    expect(await resolveSpaceKey('111')).toBe('111');
  });
});

describe('hasEditPermission (own-user permission check, fails closed)', () => {
  it('true when the API reports hasPermission: true', async () => {
    fakeApi.setHandler((url, init) => {
      expect(url).toBe('/wiki/rest/api/content/page-1/permission/check');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body ?? '{}')).toEqual({
        subject: { type: 'user', identifier: 'acc-1' },
        operation: 'update',
      });
      return jsonResponse(200, { hasPermission: true });
    });
    expect(await hasEditPermission('page-1', 'acc-1')).toBe(true);
  });

  it('false when the API reports hasPermission: false', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: false }));
    expect(await hasEditPermission('page-1', 'acc-1')).toBe(false);
  });

  it('fails closed (false) on a non-200 response', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await hasEditPermission('page-1', 'acc-1')).toBe(false);
  });

  it('fails closed (false) when the request throws', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    expect(await hasEditPermission('page-1', 'acc-1')).toBe(false);
  });
});

describe('getCurrentUserGroupIds (paginated)', () => {
  it('collects results from a single page', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ id: 'g1' }, { id: 'g2' }] }));
    const groups = await getCurrentUserGroupIds('acc-1');
    expect(groups).toEqual(new Set(['g1', 'g2']));
  });

  it('follows _links.next across multiple pages', async () => {
    const seenUrls: string[] = [];
    const handler: FakeRequestHandler = (url) => {
      seenUrls.push(url);
      if (url === '/wiki/rest/api/user/memberof?accountId=acc-1&limit=200') {
        return jsonResponse(200, {
          results: [{ id: 'g1' }],
          _links: { next: '/wiki/rest/api/user/memberof?accountId=acc-1&start=200&limit=200' },
        });
      }
      if (url === '/wiki/rest/api/user/memberof?accountId=acc-1&start=200&limit=200') {
        return jsonResponse(200, { results: [{ id: 'g2' }] });
      }
      return jsonResponse(404, {});
    };
    fakeApi.setHandler(handler);

    const groups = await getCurrentUserGroupIds('acc-1');
    expect(groups).toEqual(new Set(['g1', 'g2']));
    expect(seenUrls).toHaveLength(2);
  });

  it('stops (does not throw) on a non-200 response', async () => {
    fakeApi.setHandler(() => jsonResponse(500, {}));
    expect(await getCurrentUserGroupIds('acc-1')).toEqual(new Set());
  });
});

describe('isMemberOfAnyGroup', () => {
  it('returns false without making a request when groupIds is empty', async () => {
    fakeApi.setHandler(() => {
      throw new Error('should not be called');
    });
    expect(await isMemberOfAnyGroup('acc-1', [])).toBe(false);
  });

  it('true when the user belongs to one of the given groups', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ id: 'g1' }, { id: 'g2' }] }));
    expect(await isMemberOfAnyGroup('acc-1', ['g9', 'g2'])).toBe(true);
  });

  it('false when the user belongs to none of the given groups', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ id: 'g1' }] }));
    expect(await isMemberOfAnyGroup('acc-1', ['g9', 'g8'])).toBe(false);
  });
});

describe('isComplianceManager (data model §2.3)', () => {
  it('false without making a request when no managers group is configured', async () => {
    fakeApi.setHandler(() => {
      throw new Error('should not be called');
    });
    expect(await isComplianceManager('acc-1')).toBe(false);
  });

  it('true when the user is a member of the configured managers group', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers-group', reconfirmDefault: false });
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ id: 'managers-group' }] }));
    expect(await isComplianceManager('acc-1')).toBe(true);
  });

  it('false when the user is not a member of the configured managers group', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers-group', reconfirmDefault: false });
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ id: 'other-group' }] }));
    expect(await isComplianceManager('acc-1')).toBe(false);
  });
});

describe('canConfigure (tech design §4 — page edit permission OR compliance manager)', () => {
  it('true when the user has edit permission (not a manager)', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { results: [] });
    });
    expect(await canConfigure('page-1', 'acc-1')).toBe(true);
  });

  it('true when the user is a compliance manager (no edit permission)', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers-group', reconfirmDefault: false });
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: false });
      return jsonResponse(200, { results: [{ id: 'managers-group' }] });
    });
    expect(await canConfigure('page-1', 'acc-1')).toBe(true);
  });

  it('false when neither condition holds', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: false });
      return jsonResponse(200, { results: [] });
    });
    expect(await canConfigure('page-1', 'acc-1')).toBe(false);
  });
});

describe('searchGroupsByQuery (T7 — verified against Confluence Cloud REST API docs)', () => {
  it('maps results to {id, name} and passes the query through', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/rest/api/group/picker?query=sec&limit=20');
      return jsonResponse(200, {
        results: [
          { id: 'g1', name: 'sec-all', type: 'group' },
          { id: 'g2', name: 'sec-managers', type: 'group' },
        ],
      });
    });
    expect(await searchGroupsByQuery('sec')).toEqual([
      { id: 'g1', name: 'sec-all' },
      { id: 'g2', name: 'sec-managers' },
    ]);
  });

  it('returns an empty array on a non-200 response rather than throwing', async () => {
    fakeApi.setHandler(() => jsonResponse(500, {}));
    expect(await searchGroupsByQuery('sec')).toEqual([]);
  });

  it('returns an empty array when the API omits results', async () => {
    fakeApi.setHandler(() => jsonResponse(200, {}));
    expect(await searchGroupsByQuery('sec')).toEqual([]);
  });
});

describe('resolveGroupNames (T7 — pre-populate the config modal with real names, not raw IDs)', () => {
  it('resolves every ID to its name', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('id=g1')) return jsonResponse(200, { id: 'g1', name: 'sec-all' });
      if (url.includes('id=g2')) return jsonResponse(200, { id: 'g2', name: 'hr-all' });
      return jsonResponse(404, {});
    });
    const result = await resolveGroupNames(['g1', 'g2']);
    expect(result).toEqual(
      expect.arrayContaining([
        { id: 'g1', name: 'sec-all' },
        { id: 'g2', name: 'hr-all' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('drops (does not throw for) a group that fails to resolve, e.g. since deleted', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('id=g1')) return jsonResponse(200, { id: 'g1', name: 'sec-all' });
      return jsonResponse(404, {}); // g2 no longer exists
    });
    const result = await resolveGroupNames(['g1', 'g2']);
    expect(result).toEqual([{ id: 'g1', name: 'sec-all' }]);
  });

  it('returns an empty array for an empty input without making a request', async () => {
    fakeApi.setHandler(() => {
      throw new Error('should not be called');
    });
    expect(await resolveGroupNames([])).toEqual([]);
  });
});

describe('checkViewPermission (T10 — other-user cannot-view check, tier-3 asApp exception)', () => {
  it('can-view: hasPermission true', async () => {
    fakeApi.setHandler((url, init) => {
      expect(url).toBe('/wiki/rest/api/content/page-1/permission/check');
      expect(JSON.parse(init?.body ?? '{}')).toEqual({
        subject: { type: 'user', identifier: 'acc-1' },
        operation: 'read',
      });
      return jsonResponse(200, { hasPermission: true });
    });
    expect(await checkViewPermission('page-1', 'acc-1')).toBe('can-view');
  });

  it('cannot-view: hasPermission false', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { hasPermission: false }));
    expect(await checkViewPermission('page-1', 'acc-1')).toBe('cannot-view');
  });

  it('deleted-user: HTTP 404 maps to deleted-user, not cannot-view (data model §4)', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await checkViewPermission('page-1', 'acc-1')).toBe('deleted-user');
  });

  it('fails closed to cannot-view on an unexpected error status', async () => {
    fakeApi.setHandler(() => jsonResponse(500, {}));
    expect(await checkViewPermission('page-1', 'acc-1')).toBe('cannot-view');
  });

  it('fails closed to cannot-view when the request throws', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    expect(await checkViewPermission('page-1', 'acc-1')).toBe('cannot-view');
  });
});

describe('getGroupMemberAccountIds (T10 — reverse of getCurrentUserGroupIds, start/limit paginated)', () => {
  it('collects accountIds from a single page', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/rest/api/group/g1/membersByGroupId?start=0&limit=200');
      return jsonResponse(200, { results: [{ accountId: 'acc-1' }, { accountId: 'acc-2' }] });
    });
    expect(await getGroupMemberAccountIds('g1')).toEqual(['acc-1', 'acc-2']);
  });

  it('follows start/limit pagination until a short page ends it', async () => {
    let calls = 0;
    fakeApi.setHandler((url) => {
      calls += 1;
      if (url.includes('start=0')) {
        return jsonResponse(
          200,
          { results: Array.from({ length: 200 }, (_, i) => ({ accountId: `acc-${i}` })) },
        );
      }
      expect(url).toContain('start=200');
      return jsonResponse(200, { results: [{ accountId: 'acc-200' }] });
    });
    const result = await getGroupMemberAccountIds('g1');
    expect(result).toHaveLength(201);
    expect(calls).toBe(2);
  });

  it('a deleted/unresolvable group contributes zero members (best-effort, never throws)', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await getGroupMemberAccountIds('gone')).toEqual([]);
  });

  it('a thrown request also degrades to zero members', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    expect(await getGroupMemberAccountIds('g1')).toEqual([]);
  });

  it('defaults to the asUser tier (T10 call sites, unchanged)', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    await getGroupMemberAccountIds('g1');
    expect(fakeApi.lastTier).toBe('user');
  });

  it('T11: passing tier "app" calls asApp (webtriggers have no user session)', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [{ accountId: 'acc-1' }] }));
    const result = await getGroupMemberAccountIds('g1', 'app');
    expect(fakeApi.lastTier).toBe('app');
    expect(result).toEqual(['acc-1']);
  });
});

describe('resolveUserDisplayName (T11 — data model §4 user_display_name column)', () => {
  it('returns the resolved display name', async () => {
    fakeApi.setHandler((url) => {
      expect(url).toBe('/wiki/rest/api/user?accountId=acc-1');
      return jsonResponse(200, { displayName: 'Ayşe Yılmaz' });
    });
    expect(await resolveUserDisplayName('acc-1', 'user')).toBe('Ayşe Yılmaz');
  });

  it('maps a null displayName to "[deactivated]"', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { displayName: null }));
    expect(await resolveUserDisplayName('acc-1', 'user')).toBe('[deactivated]');
  });

  it('maps HTTP 404 to "[deleted user]"', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await resolveUserDisplayName('acc-1', 'user')).toBe('[deleted user]');
  });

  it('fails safe to "[deleted user]" on any other error status', async () => {
    fakeApi.setHandler(() => jsonResponse(500, {}));
    expect(await resolveUserDisplayName('acc-1', 'user')).toBe('[deleted user]');
  });

  it('fails safe to "[deleted user]" when the request throws', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    expect(await resolveUserDisplayName('acc-1', 'user')).toBe('[deleted user]');
  });

  it('T11: passing tier "app" calls asApp', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { displayName: 'X' }));
    await resolveUserDisplayName('acc-1', 'app');
    expect(fakeApi.lastTier).toBe('app');
  });
});
