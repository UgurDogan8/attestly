/**
 * i18n entry point (docs/06 T5, docs/07 §4). Use `useI18n()`
 * (src/frontend/components/useI18n.ts) from any UI Kit surface to get a
 * bound `t(key, vars)`.
 *
 * REVIEW CHECKLIST (docs/06 T5 accept criteria: "no literal strings in
 * components — lint rule or review checklist"; a lint rule was skipped
 * deliberately — a generic "no JSX string literals" rule is either full of
 * false positives on non-user-facing props or requires an allowlist that's
 * as much maintenance as just reviewing it): every user-visible string
 * added to src/frontend/**\/*.tsx from T6 onward must be a `t('...')` call
 * against a key in en.ts (+ tr.ts) — not a literal. Check this in review
 * for every PR touching src/frontend.
 */
import { en } from './en';
import { tr } from './tr';
import type { MessageKey } from './en';

export type { MessageKey } from './en';

export const catalogs = { en, tr } as const;
export type Locale = keyof typeof catalogs;

/** Map a Confluence locale (e.g. "tr-TR") to a supported catalog. */
export function resolveLocale(confluenceLocale: string | undefined): Locale {
  const lang = (confluenceLocale ?? 'en').slice(0, 2).toLowerCase();
  return lang in catalogs ? (lang as Locale) : 'en';
}

export type MessageVars = Record<string, string | number>;

/**
 * Interpolates `{placeholder}` tokens (UX doc §6: catalog strings are used
 * exactly as written, never composed piecemeal from fragments). An
 * unmatched placeholder (missing var) is left as-is rather than silently
 * dropped, so a wiring mistake is visible instead of hidden.
 */
export function formatMessage(template: string, vars?: MessageVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const template: string = catalogs[locale][key];
  return formatMessage(template, vars);
}

export type Translator = (key: MessageKey, vars?: MessageVars) => string;

/** Binds a locale so callers don't have to pass it on every message. */
export function createTranslator(locale: Locale): Translator {
  return (key, vars) => translate(locale, key, vars);
}
