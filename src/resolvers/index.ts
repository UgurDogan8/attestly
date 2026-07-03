import type Resolver from '@forge/resolver';
import { err } from '@acknowledge/shared';

/**
 * Thin request handlers only — business logic lives in src/domain (tech
 * design §1 layering rule). Every resolver re-checks permissions server-side
 * per the three-tier model in tech design §4.
 *
 * TODO(T4): getPageStatus, confirm, getConfig, saveConfig
 * TODO(T9): getDashboard
 * TODO(T10): getPageDetail
 * TODO(T11): exportCsv
 * TODO(T13): getSettings, saveSettings
 */
export function registerResolvers(resolver: Resolver): void {
  resolver.define('getPageStatus', async () => {
    return err('NOT_IMPLEMENTED', 'T4');
  });
}
