import { isConfluenceAdmin, resolveGroupNames } from './auth';
import { getSettings, saveSettings, type SettingsRecord } from '../storage/settings';
import { ok, err, type Result, type GetSettingsResponse, type SaveSettingsPayload } from '../shared';

/**
 * Settings resolver bodies (T13, docs/04 §3.5). Gated on isConfluenceAdmin
 * alone — see shared/types.ts's docstring and auth.ts's isComplianceManager
 * docstring for why compliance-manager membership doesn't suffice here.
 */

export async function getSettingsForAdmin(): Promise<Result<GetSettingsResponse>> {
  if (!(await isConfluenceAdmin())) {
    return err('FORBIDDEN', 'You need Confluence admin access to view settings.');
  }

  const settings = await getSettings();
  return ok({
    complianceManagersGroupIds: settings.complianceManagersGroupIds,
    complianceManagersGroupOptions: await resolveGroupNames(settings.complianceManagersGroupIds),
    complianceManagersUserIds: settings.complianceManagersUserIds,
    reconfirmDefault: settings.reconfirmDefault,
  });
}

export async function saveSettingsForAdmin(payload: SaveSettingsPayload): Promise<Result<GetSettingsResponse>> {
  if (!(await isConfluenceAdmin())) {
    return err('FORBIDDEN', 'You need Confluence admin access to change settings.');
  }

  const updated: SettingsRecord = {
    schemaVersion: 1,
    complianceManagersGroupIds: payload.complianceManagersGroupIds,
    complianceManagersUserIds: payload.complianceManagersUserIds,
    reconfirmDefault: payload.reconfirmDefault,
  };
  await saveSettings(updated);

  return ok({
    complianceManagersGroupIds: updated.complianceManagersGroupIds,
    complianceManagersGroupOptions: await resolveGroupNames(updated.complianceManagersGroupIds),
    complianceManagersUserIds: updated.complianceManagersUserIds,
    reconfirmDefault: updated.reconfirmDefault,
  });
}
