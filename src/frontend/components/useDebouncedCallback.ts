import { useEffect, useRef } from 'react';

export interface UseDebouncedCallbackResult<Args extends unknown[]> {
  /** Cancels any pending call, then schedules a new one `delayMs` out. */
  run: (...args: Args) => void;
  /** Cancels a pending call without scheduling a new one (e.g. when input is cleared). */
  cancel: () => void;
}

/**
 * Shared debounce-timer bookkeeping (previously duplicated identically three
 * times: Dashboard.tsx's space filter, ConfigModal.tsx's and SettingsPage.tsx's
 * group search — each with its own `useRef<Timeout>` plus an unmount-cleanup
 * `useEffect`). `fn` is captured via a ref rather than a `useCallback` dep so
 * callers don't need to memoize it themselves; `run`'s arguments are still
 * captured at call time (not fire time), matching every existing call site's
 * "read current state when the keystroke happens, not when the timer fires"
 * requirement (Dashboard.tsx's stale-closure comment).
 */
export function useDebouncedCallback<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): UseDebouncedCallbackResult<Args> {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  function cancel(): void {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }

  useEffect(() => cancel, []);

  function run(...args: Args): void {
    cancel();
    timer.current = setTimeout(() => fnRef.current(...args), delayMs);
  }

  return { run, cancel };
}
