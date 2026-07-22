import kvs from '@forge/kvs';
import { ENTITY, SETTINGS_KEY } from './entities';

/** data model §2.3 — singleton, key `settings#global`. */
export interface SettingsRecord {
  schemaVersion: number;
  complianceManagersGroupIds: string[];
  complianceManagersUserIds: string[];
  /** v1 default off (tech design §6.2); v1.1 flips the default for *new* configs only. */
  reconfirmDefault: boolean;
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  schemaVersion: 1,
  complianceManagersGroupIds: [],
  complianceManagersUserIds: [],
  reconfirmDefault: false,
};

/**
 * On-disk shape, wider than SettingsRecord: `complianceManagersGroupId` is
 * the pre-multi-manager singular field (manifest.yml keeps it declared for
 * schema compat, dead write path). getSettings folds it into
 * complianceManagersGroupIds for any site that configured a manager group
 * before compliance managers became multi-group/multi-user; saveSettings
 * never writes it again.
 */
interface StoredSettingsRecord {
  schemaVersion: number;
  complianceManagersGroupId?: string;
  complianceManagersGroupIds?: string[];
  complianceManagersUserIds?: string[];
  reconfirmDefault: boolean;
}

function fromStoredSettings(record: StoredSettingsRecord): SettingsRecord {
  const groupIds = record.complianceManagersGroupIds ?? (record.complianceManagersGroupId ? [record.complianceManagersGroupId] : []);
  return {
    schemaVersion: record.schemaVersion,
    complianceManagersGroupIds: groupIds,
    complianceManagersUserIds: record.complianceManagersUserIds ?? [],
    reconfirmDefault: record.reconfirmDefault,
  };
}

/** Falls back to defaults before the settings page has ever been saved. */
export async function getSettings(): Promise<SettingsRecord> {
  const existing = await kvs.entity<StoredSettingsRecord>(ENTITY.settings).get(SETTINGS_KEY);
  return existing ? fromStoredSettings(existing) : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  await kvs.entity<StoredSettingsRecord>(ENTITY.settings).set(SETTINGS_KEY, settings);
}
