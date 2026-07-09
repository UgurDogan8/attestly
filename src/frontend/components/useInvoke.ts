import { useCallback, useState } from 'react';
import { invoke } from '@forge/bridge';
import type { Result } from '../../shared';

export interface UseInvokeResult<Payload, Data> {
  run: (payload: Payload) => Promise<Result<Data>>;
  loading: boolean;
  error: string | null;
}

/**
 * Thin wrapper around @forge/bridge's invoke() with loading/error tracking
 * (tech design §3: "a small useInvoke hook with loading/error handling").
 * Deliberately does not auto-invoke on mount — the same hook covers both
 * fetch-on-mount (getPageStatus) and fire-on-click (confirm) call sites;
 * callers decide when `run` fires.
 *
 * `invoke()`'s return type technically allows an opt-in `{body, metadata}`
 * wrapper for rate-limit metadata (the third `metadata` argument, unused
 * here), so the resolved value is the plain Result<Data>.
 */
export function useInvoke<Payload extends object, Data>(functionKey: string): UseInvokeResult<Payload, Data> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (payload: Payload): Promise<Result<Data>> => {
      setLoading(true);
      setError(null);
      try {
        // @forge/bridge's own Payload constraint (InvokePayload) isn't part
        // of its public export surface, so it can't be reused here to
        // constrain Payload precisely -- every payload this app sends is a
        // plain JSON-serializable object, which is what that internal
        // constraint actually requires.
        const result = (await invoke<never, Result<Data>>(functionKey, payload as never)) as Result<Data>;
        if (!result.ok) {
          setError(result.message);
        }
        return result;
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : 'Unknown error.';
        setError(message);
        return { ok: false, code: 'INVOKE_FAILED', message };
      } finally {
        setLoading(false);
      }
    },
    [functionKey],
  );

  return { run, loading, error };
}
