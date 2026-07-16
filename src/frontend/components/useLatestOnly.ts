import { useRef } from 'react';

export interface UseLatestOnlyResult {
  /** Runs `fn`; resolves to its result, or `undefined` if a newer `runLatest` call started before `fn` settled. */
  runLatest: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * Stale-response guard (review finding: Dashboard's space/status filter and
 * ConfigModal/SettingsPage's group search can fire a second `invoke()`
 * before the first one resolves -- e.g. two keystrokes each survive their
 * own debounce window -- and nothing stopped an older, slower response from
 * overwriting a newer one that already landed). Distinct from the
 * `cancelled`-flag idiom used elsewhere in this codebase (useReaderState.ts
 * and others), which only guards against the component having unmounted --
 * it doesn't help when the component is still mounted but a newer request
 * has superseded an older, still in-flight one.
 *
 * A plain incrementing generation counter: `runLatest` stamps the call
 * before awaiting `fn`, and only returns `fn`'s result if that stamp is
 * still the most recent one by the time `fn` resolves.
 */
export function useLatestOnly(): UseLatestOnlyResult {
  const latestRequest = useRef(0);

  async function runLatest<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const gen = ++latestRequest.current;
    const result = await fn();
    if (gen !== latestRequest.current) {
      return undefined;
    }
    return result;
  }

  return { runLatest };
}
