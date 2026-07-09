/**
 * Bounded-concurrency map (T10 drill-down — tech design §4: permission
 * checks are live-measured ~150–250ms each; a 100-user drill-down run
 * sequentially would be ~20s, blowing past a reasonable UX and risking the
 * invocation timeout. Concurrency ~10 keeps it to a few seconds without
 * hammering the Confluence REST API harder than the platform expects.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
