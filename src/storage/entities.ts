/**
 * KVS custom entity access. Entity/index shapes are validated platform-side
 * (spike M0-1) — manifest.yml and data model §2 are the single source of truth.
 * Query patterns and measured latencies: tech design §5.
 *
 * TODO(T2): typed accessors, cursor pagination helpers, idempotent confirm
 * write with counter bump in one transaction, append-only guards.
 */

export const ENTITY = {
  confirmation: 'confirmation',
  pageConfig: 'page-config', // lowercase manifest names (platform constraint)
  settings: 'settings',
  configAudit: 'config-audit',
} as const;

/** Deterministic → idempotent (tech design §6.1). Keys hold identity only. */
export const confirmationKey = (pageId: string, accountId: string, pageVersion: number): string =>
  `confirm#${pageId}#${accountId}#${pageVersion}`;

export const pageConfigKey = (pageId: string): string => `config#${pageId}`;

export const SETTINGS_KEY = 'settings#global';

export const configAuditKey = (pageId: string, atIso: string, nonce: string): string =>
  `cfgaudit#${pageId}#${atIso}#${nonce}`;
