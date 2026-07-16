import React from 'react';
import { act, create } from 'react-test-renderer';
import { useLatestOnly, type UseLatestOnlyResult } from './useLatestOnly';

function TestComponent({ onResult }: { onResult: (result: UseLatestOnlyResult) => void }): null {
  const result = useLatestOnly();
  onResult(result);
  return null;
}

function renderHook(): { result: UseLatestOnlyResult } {
  let captured!: UseLatestOnlyResult;
  act(() => {
    create(<TestComponent onResult={(result) => (captured = result)} />);
  });
  return { result: captured };
}

/** A promise this test controls the resolution timing of. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useLatestOnly', () => {
  it('returns the result of a single call', async () => {
    const { result } = renderHook();
    const value = await result.runLatest(() => Promise.resolve('hello'));
    expect(value).toBe('hello');
  });

  it('an older call that resolves after a newer one is superseded (returns undefined)', async () => {
    const { result } = renderHook();
    const first = deferred<string>();
    const second = deferred<string>();

    const firstCall = result.runLatest(() => first.promise);
    const secondCall = result.runLatest(() => second.promise);

    // Older resolves last -- must not win.
    second.resolve('second');
    const secondValue = await secondCall;
    first.resolve('first');
    const firstValue = await firstCall;

    expect(secondValue).toBe('second');
    expect(firstValue).toBeUndefined();
  });

  it('a newer call that resolves after an older one still wins', async () => {
    const { result } = renderHook();
    const first = deferred<string>();
    const second = deferred<string>();

    const firstCall = result.runLatest(() => first.promise);
    const secondCall = result.runLatest(() => second.promise);

    first.resolve('first');
    const firstValue = await firstCall;
    second.resolve('second');
    const secondValue = await secondCall;

    expect(firstValue).toBeUndefined();
    expect(secondValue).toBe('second');
  });
});
