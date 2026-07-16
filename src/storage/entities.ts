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

/**
 * Review finding (docs/07 §7.1): key builders below interpolate a
 * caller-supplied `pageId` unescaped between `#`-delimited segments -- a
 * `pageId` containing `#` could collide/shift key segments (e.g. forge a
 * `confirmationKey` that lands on another account's slot). Throws rather
 * than escaping/truncating: a `#` in a pageId is never legitimate (a real
 * Confluence page ID is purely numeric), so failing loudly here is strictly
 * safer than trying to silently sanitize a value that should never occur.
 */
function assertSafeKeySegment(pageId: string): string {
  if (pageId.includes('#')) {
    throw new Error(`pageId must not contain '#' (KVS key delimiter): ${pageId}`);
  }
  return pageId;
}

/** Deterministic → idempotent (tech design §6.1). Keys hold identity only. */
export const confirmationKey = (pageId: string, accountId: string, pageVersion: number): string =>
  `confirm#${assertSafeKeySegment(pageId)}#${accountId}#${pageVersion}`;

export const pageConfigKey = (pageId: string): string => `config#${assertSafeKeySegment(pageId)}`;

export const SETTINGS_KEY = 'settings#global';

export const configAuditKey = (pageId: string, atIso: string, nonce: string): string =>
  `cfgaudit#${assertSafeKeySegment(pageId)}#${atIso}#${nonce}`;
