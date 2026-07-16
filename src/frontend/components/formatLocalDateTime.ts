import type { Locale } from '../../shared';

/**
 * Local-timezone display of a server-stored UTC value (UX doc R3: "Local
 * timezone display; UTC stored"). Runs client-side (UI Kit resources render
 * in the viewer's own browser), so `Date`'s own runtime timezone is always
 * the viewer's — that part needs no locale argument at all.
 *
 * `locale` (review finding) picks the language *Intl* renders month names
 * etc. in — previously `undefined` let the browser's own locale decide,
 * which could disagree with the app's own resolved en/tr language (e.g. an
 * English-configured Confluence viewer on a Turkish-locale OS). Passing the
 * app's resolved locale (useI18n()'s `locale`) keeps dates consistent with
 * every other piece of UI text on the page.
 *
 * Deliberately simpler than the UX mockup's literal "(UTC+3)" suffix —
 * a numeric offset label needs `timeZoneName` support that isn't reliably
 * available everywhere; the functional requirement (show local time, not
 * raw UTC) doesn't need it.
 */
export function formatLocalDateTime(isoUtc: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoUtc));
}

/**
 * Date-only variant for due dates (data model §2.2: `dueDate` has no time
 * component). Bug found in review: `new Date(isoDate)` parses a date-only
 * string ("2026-07-31") as UTC midnight per the ECMA-262 date-time string
 * spec, but `Intl.DateTimeFormat` above then renders it in the *viewer's*
 * timezone — for any viewer west of UTC (all of the Americas, and parts of
 * Europe/Africa depending on DST), that shifts the displayed date back one
 * day (2026-07-31T00:00Z renders as "Jul 30" at UTC-1 or further west),
 * silently disagreeing with dashboard.ts's own server-side overdue
 * comparison, which correctly compares the plain ISO string and never
 * parses it as a Date at all. A calendar date has no timezone to begin
 * with, so this function must never round-trip through UTC: parse the
 * Y/M/D components directly and construct the Date via the local-time
 * constructor, which stays on the same calendar day when formatted back in
 * that same (viewer's) timezone, regardless of UTC offset.
 */
export function formatLocalDate(isoDate: string, locale: Locale): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}
