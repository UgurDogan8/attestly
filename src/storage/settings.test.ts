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
import { getSettings, saveSettings, DEFAULT_SETTINGS } from './settings';
import { ENTITY, SETTINGS_KEY } from './entities';

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

describe('getSettings / saveSettings (data model §2.3 — singleton, multi-group + multi-user managers)', () => {
  it('falls back to defaults before anything has been saved', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a saved value', async () => {
    const saved = {
      schemaVersion: 1,
      complianceManagersGroupIds: ['group-1', 'group-2'],
      complianceManagersUserIds: ['acc-1'],
      reconfirmDefault: true,
    };
    await saveSettings(saved);
    expect(await getSettings()).toEqual(saved);
  });

  it('a second save overwrites the first (singleton, mutable)', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: ['group-1'], complianceManagersUserIds: [], reconfirmDefault: false });
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: ['group-2'], complianceManagersUserIds: ['acc-1'], reconfirmDefault: true });

    expect(await getSettings()).toEqual({
      schemaVersion: 1,
      complianceManagersGroupIds: ['group-2'],
      complianceManagersUserIds: ['acc-1'],
      reconfirmDefault: true,
    });
  });

  it('clearing all managers round-trips to empty arrays', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: ['group-1'], complianceManagersUserIds: ['acc-1'], reconfirmDefault: false });
    await saveSettings({ schemaVersion: 1, complianceManagersGroupIds: [], complianceManagersUserIds: [], reconfirmDefault: false });

    expect(await getSettings()).toEqual({
      schemaVersion: 1,
      complianceManagersGroupIds: [],
      complianceManagersUserIds: [],
      reconfirmDefault: false,
    });
  });

  it('migrates a pre-existing single-group record (legacy complianceManagersGroupId) into the new groupIds array', async () => {
    // Simulates a site that configured its manager group before this change,
    // by writing the legacy shape directly through the fake's raw entity API
    // rather than through saveSettings (which never writes it anymore).
    fake.rawSet(ENTITY.settings, SETTINGS_KEY, {
      schemaVersion: 1,
      complianceManagersGroupId: 'legacy-group',
      reconfirmDefault: false,
    });

    expect(await getSettings()).toEqual({
      schemaVersion: 1,
      complianceManagersGroupIds: ['legacy-group'],
      complianceManagersUserIds: [],
      reconfirmDefault: false,
    });
  });
});
