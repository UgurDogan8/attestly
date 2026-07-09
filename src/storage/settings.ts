import kvs from '@forge/kvs';
import { ENTITY, SETTINGS_KEY } from './entities';

/** data model §2.3 — singleton, key `settings#global`. */
export interface SettingsRecord {
  schemaVersion: number;
  complianceManagersGroupId: string | null;
  /** v1 default off (tech design §6.2); v1.1 flips the default for *new* configs only. */
  reconfirmDefault: boolean;
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  schemaVersion: 1,
  complianceManagersGroupId: null,
  reconfirmDefault: false,
};

/** Falls back to defaults before the settings page has ever been saved. */
export async function getSettings(): Promise<SettingsRecord> {
  const existing = await kvs.entity<SettingsRecord>(ENTITY.settings).get(SETTINGS_KEY);
  return existing ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  await kvs.entity<SettingsRecord>(ENTITY.settings).set(SETTINGS_KEY, settings);
}
