import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('preserves input order in the output regardless of completion order', async () => {
    const delays = [30, 10, 20, 0, 15];
    const result = await mapWithConcurrency(delays, 3, (ms, i) => new Promise((resolve) => setTimeout(() => resolve(i), ms)));
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than `concurrency` calls at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return i;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('handles an empty list without invoking fn', async () => {
    const fn = jest.fn();
    const result = await mapWithConcurrency([], 10, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs every item even when concurrency exceeds the item count', async () => {
    const result = await mapWithConcurrency([1, 2], 10, (n) => Promise.resolve(n * 2));
    expect(result).toEqual([2, 4]);
  });
});
