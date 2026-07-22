import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';

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
import { getSettings } from '../storage/settings';
import { getSettingsForAdmin, saveSettingsForAdmin } from './settings';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

const asAdmin = () => jsonResponse(200, { operations: [{ operation: 'administer', targetType: 'application' }] });
const asNonAdmin = () => jsonResponse(200, { operations: [] });

beforeEach(() => {
  fakeKvs.reset();
});

describe('getSettingsForAdmin', () => {
  it('FORBIDDEN for a non-admin', async () => {
    fakeApi.setHandler(asNonAdmin);
    const result = await getSettingsForAdmin();
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('returns defaults for an admin before anything has been saved', async () => {
    fakeApi.setHandler(asAdmin);
    const result = await getSettingsForAdmin();
    expect(result).toEqual({
      ok: true,
      data: { complianceManagersGroupIds: [], complianceManagersGroupOptions: [], complianceManagersUserIds: [], reconfirmDefault: false },
    });
  });

  it('resolves the configured groups’ names for display', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return asAdmin();
      if (url.includes('id=g1')) return jsonResponse(200, { id: 'g1', name: 'compliance-team' });
      if (url.includes('id=g2')) return jsonResponse(200, { id: 'g2', name: 'security-team' });
      return jsonResponse(404, {});
    });
    await saveSettingsForAdmin({ complianceManagersGroupIds: ['g1', 'g2'], complianceManagersUserIds: ['acc-1'], reconfirmDefault: false });

    const result = await getSettingsForAdmin();
    expect(result).toMatchObject({
      ok: true,
      data: {
        complianceManagersGroupIds: ['g1', 'g2'],
        complianceManagersGroupOptions: expect.arrayContaining([
          { id: 'g1', name: 'compliance-team' },
          { id: 'g2', name: 'security-team' },
        ]),
        complianceManagersUserIds: ['acc-1'],
      },
    });
  });

  it('a deleted/unresolvable group is dropped from the resolved options, ID stays authoritative', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return asAdmin();
      return jsonResponse(404, {}); // group/by-id fails to resolve
    });
    await saveSettingsForAdmin({ complianceManagersGroupIds: ['gone'], complianceManagersUserIds: [], reconfirmDefault: false });

    const result = await getSettingsForAdmin();
    expect(result).toMatchObject({ ok: true, data: { complianceManagersGroupIds: ['gone'], complianceManagersGroupOptions: [] } });
  });
});

describe('saveSettingsForAdmin', () => {
  it('FORBIDDEN for a non-admin, and nothing is persisted', async () => {
    fakeApi.setHandler(asNonAdmin);
    const result = await saveSettingsForAdmin({ complianceManagersGroupIds: ['g1'], complianceManagersUserIds: [], reconfirmDefault: true });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await getSettings()).toMatchObject({ complianceManagersGroupIds: [] });
  });

  it('an admin can clear all managers by saving empty arrays', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/current')) return asAdmin();
      if (url.includes('/group/by-id')) return jsonResponse(200, { id: 'g1', name: 'compliance-team' });
      return jsonResponse(404, {});
    });
    await saveSettingsForAdmin({ complianceManagersGroupIds: ['g1'], complianceManagersUserIds: [], reconfirmDefault: false });

    const result = await saveSettingsForAdmin({ complianceManagersGroupIds: [], complianceManagersUserIds: [], reconfirmDefault: false });
    expect(result).toEqual({
      ok: true,
      data: { complianceManagersGroupIds: [], complianceManagersGroupOptions: [], complianceManagersUserIds: [], reconfirmDefault: false },
    });
  });

  it('persists reconfirmDefault', async () => {
    fakeApi.setHandler(asAdmin);
    await saveSettingsForAdmin({ complianceManagersGroupIds: [], complianceManagersUserIds: [], reconfirmDefault: true });
    expect(await getSettings()).toMatchObject({ reconfirmDefault: true });
  });
});
