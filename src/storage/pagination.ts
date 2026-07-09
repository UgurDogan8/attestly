/**
 * Cursor pagination helpers shared by every KVS custom-entity query (tech
 * design §5). Kept generic and Forge-free so it is trivially unit-testable.
 */

/** Platform constraint (tech design §5): query pages cap at 100 results. */
export const MAX_PAGE_SIZE = 100;

export interface CursorPage<T> {
  results: T[];
  nextCursor?: string;
}

/** Walks a cursor-paged KVS query to completion, one page of values at a time. */
export async function* drainPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
): AsyncGenerator<T[], void, void> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    yield page.results;
    cursor = page.nextCursor;
  } while (cursor);
}

/**
 * Convenience for bounded result sets (tests, tracked-page lists). Large
 * drains (10k-record export, tech design §9 performance budget) should
 * consume `drainPages` directly so callers can stream instead of buffering
 * everything in memory.
 */
export async function drainAll<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  for await (const page of drainPages(fetchPage)) {
    all.push(...page);
  }
  return all;
}
