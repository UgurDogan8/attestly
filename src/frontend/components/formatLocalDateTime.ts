/**
 * Local-timezone display of a server-stored UTC value (UX doc R3: "Local
 * timezone display; UTC stored"). Runs client-side (UI Kit resources render
 * in the viewer's own browser), so `Intl`/`Date` correctly reflect the
 * viewer's own locale/timezone via the `undefined` locale idiom below.
 *
 * Deliberately simpler than the UX mockup's literal "(UTC+3)" suffix —
 * a numeric offset label needs `timeZoneName` support that isn't reliably
 * available everywhere; the functional requirement (show local time, not
 * raw UTC) doesn't need it.
 */
export function formatLocalDateTime(isoUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoUtc));
}

/** Date-only variant for due dates (data model §2.2: `dueDate` has no time component). */
export function formatLocalDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(isoDate));
}
