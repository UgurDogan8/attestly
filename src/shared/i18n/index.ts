import { en } from './en';
import { tr } from './tr';

export type { MessageKey } from './en';

export const catalogs = { en, tr } as const;
export type Locale = keyof typeof catalogs;

/** Map a Confluence locale (e.g. "tr-TR") to a supported catalog. */
export function resolveLocale(confluenceLocale: string | undefined): Locale {
  const lang = (confluenceLocale ?? 'en').slice(0, 2).toLowerCase();
  return lang in catalogs ? (lang as Locale) : 'en';
}
