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

const fake = kvsFake as unknown as InMemoryKvs;

beforeEach(() => {
  fake.reset();
});

describe('getSettings / saveSettings (data model §2.3 — singleton)', () => {
  it('falls back to defaults before anything has been saved', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a saved value', async () => {
    const saved = { schemaVersion: 1, complianceManagersGroupId: 'group-1', reconfirmDefault: true };
    await saveSettings(saved);
    expect(await getSettings()).toEqual(saved);
  });

  it('a second save overwrites the first (singleton, mutable)', async () => {
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'group-1', reconfirmDefault: false });
    await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'group-2', reconfirmDefault: true });

    expect(await getSettings()).toEqual({
      schemaVersion: 1,
      complianceManagersGroupId: 'group-2',
      reconfirmDefault: true,
    });
  });
});
