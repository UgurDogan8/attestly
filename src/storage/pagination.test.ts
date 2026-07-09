import { drainPages, drainAll, MAX_PAGE_SIZE, type CursorPage } from './pagination';

describe('MAX_PAGE_SIZE', () => {
  it('matches the platform constraint (tech design §5)', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});

describe('drainPages', () => {
  it('walks every page until nextCursor is undefined, passing the previous cursor forward', async () => {
    const pages: CursorPage<number>[] = [
      { results: [1, 2], nextCursor: 'a' },
      { results: [3, 4], nextCursor: 'b' },
      { results: [5], nextCursor: undefined },
    ];
    const seenCursors: Array<string | undefined> = [];
    let call = 0;
    const fetchPage = async (cursor: string | undefined) => {
      seenCursors.push(cursor);
      return pages[call++];
    };

    const collected: number[][] = [];
    for await (const page of drainPages(fetchPage)) {
      collected.push(page);
    }

    expect(collected).toEqual([[1, 2], [3, 4], [5]]);
    expect(seenCursors).toEqual([undefined, 'a', 'b']);
  });

  it('stops after a single page when nextCursor is undefined from the start', async () => {
    const fetchPage = jest.fn(async () => ({ results: ['only'], nextCursor: undefined }));

    const collected: string[][] = [];
    for await (const page of drainPages(fetchPage)) {
      collected.push(page);
    }

    expect(collected).toEqual([['only']]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('yields an empty page rather than skipping it (row-count laws must see every page)', async () => {
    const fetchPage = jest.fn(async () => ({ results: [], nextCursor: undefined }));

    const collected: unknown[][] = [];
    for await (const page of drainPages(fetchPage)) {
      collected.push(page);
    }

    expect(collected).toEqual([[]]);
  });
});

describe('drainAll', () => {
  it('flattens every page into one array', async () => {
    const pages: CursorPage<number>[] = [
      { results: [1, 2], nextCursor: 'a' },
      { results: [3], nextCursor: undefined },
    ];
    let call = 0;
    const all = await drainAll(async () => pages[call++]);
    expect(all).toEqual([1, 2, 3]);
  });

  it('returns an empty array for an empty first page', async () => {
    const all = await drainAll(async () => ({ results: [], nextCursor: undefined }));
    expect(all).toEqual([]);
  });
});
