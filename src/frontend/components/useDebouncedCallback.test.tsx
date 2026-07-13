import React from 'react';
import { act, create } from 'react-test-renderer';
import { useDebouncedCallback, type UseDebouncedCallbackResult } from './useDebouncedCallback';

function TestComponent({
  fn,
  delayMs,
  onResult,
}: {
  fn: (value: string) => void;
  delayMs: number;
  onResult: (result: UseDebouncedCallbackResult<[string]>) => void;
}): null {
  const result = useDebouncedCallback(fn, delayMs);
  onResult(result);
  return null;
}

function renderHook(fn: (value: string) => void, delayMs: number): { result: UseDebouncedCallbackResult<[string]>; unmount: () => void } {
  let captured!: UseDebouncedCallbackResult<[string]>;
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <TestComponent
        fn={fn}
        delayMs={delayMs}
        onResult={(result) => {
          captured = result;
        }}
      />,
    );
  });
  return { result: captured, unmount: () => renderer.unmount() };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useDebouncedCallback', () => {
  it('calls fn once after the delay, with the args passed to run', () => {
    const fn = jest.fn();
    const { result } = renderHook(fn, 300);

    act(() => result.run('hello'));
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('a second run before the delay elapses cancels the first (only the latest call fires)', () => {
    const fn = jest.fn();
    const { result } = renderHook(fn, 300);

    act(() => result.run('first'));
    act(() => {
      jest.advanceTimersByTime(200);
    });
    act(() => result.run('second'));
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('cancel() prevents a pending call from firing', () => {
    const fn = jest.fn();
    const { result } = renderHook(fn, 300);

    act(() => result.run('typed then cleared'));
    act(() => result.cancel());
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it('clears a pending timer on unmount so fn never fires after the component is gone', () => {
    const fn = jest.fn();
    const { result, unmount } = renderHook(fn, 300);

    act(() => result.run('pending'));
    // Unwrapped in act(), react-test-renderer doesn't guarantee the cleanup
    // effect (which clears the timer) has flushed before advanceTimersByTime
    // runs below, making this assertion flaky.
    act(() => unmount());
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
