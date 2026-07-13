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

/**
 * manifest.yml declares `complianceManagersGroupId: type: string` on the
 * `settings` entity — the same non-nullable Custom Entity Store shape as
 * `page-config`'s `dueDate` (see storage/configs.ts's `toStorableConfig`
 * docstring for the live-confirmed error text). Verified live again here
 * (2026-07-12): clearing a previously-set compliance managers group and
 * saving threw `Value for attribute "complianceManagersGroupId" cannot be
 * null` — saveSettings wrote the field unconditionally. Same fix as
 * configs.ts: omit the key entirely when there's no group instead of
 * writing `null`, and map an absent key back to `null` on read.
 */
type StorableSettings = Omit<SettingsRecord, 'complianceManagersGroupId'> & { complianceManagersGroupId?: string };

function toStorableSettings(settings: SettingsRecord): StorableSettings {
  const { complianceManagersGroupId, ...rest } = settings;
  return complianceManagersGroupId === null ? rest : { ...rest, complianceManagersGroupId };
}

function fromStorableSettings(record: SettingsRecord): SettingsRecord {
  return record.complianceManagersGroupId ? record : { ...record, complianceManagersGroupId: null };
}

/** Falls back to defaults before the settings page has ever been saved. */
export async function getSettings(): Promise<SettingsRecord> {
  const existing = await kvs.entity<SettingsRecord>(ENTITY.settings).get(SETTINGS_KEY);
  return existing ? fromStorableSettings(existing) : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: SettingsRecord): Promise<void> {
  await kvs.entity<StorableSettings>(ENTITY.settings).set(SETTINGS_KEY, toStorableSettings(settings));
}
