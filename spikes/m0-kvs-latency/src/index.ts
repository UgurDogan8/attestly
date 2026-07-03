/**
 * M0 spike (tech design §11 item 1): KVS custom entity query latency at 1k records.
 *
 * Webtriggers:
 *   seed?mode=confirmations&start=0&count=40   — seeds `count` users × 5 versions on the hot page
 *   seed?mode=userfan&start=0&count=100        — seeds 1 hot user × `count` pages
 *   seed?mode=configs&start=0&count=250        — seeds `count` tracked pageConfig rows across 10 spaces
 *   measure?iterations=5                       — times the four query patterns, returns JSON
 *   wipe                                       — deletes everything the seeders wrote
 *
 * Dataset at full seed: 1,000 confirmations on one page (200 users × 5 versions),
 * 200 confirmations by one user, 500 tracked configs.
 */
import { kvs, WhereConditions, Sort } from '@forge/kvs';

const HOT_PAGE = 'hotpage-1';
const HOT_USER = 'hotuser';
const USERS = 200;
const VERSIONS = 5;
const FAN_PAGES = 200;
const CONFIGS = 500;
const SPACES = 10;
const WRITE_CONCURRENCY = 20;

interface WebtriggerRequest {
  queryParameters?: Record<string, string[]>;
}

const param = (req: WebtriggerRequest, name: string, fallback: string): string =>
  req.queryParameters?.[name]?.[0] ?? fallback;

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body, null, 2),
});

async function inBatches(tasks: (() => Promise<unknown>)[]): Promise<number> {
  for (let i = 0; i < tasks.length; i += WRITE_CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + WRITE_CONCURRENCY).map((t) => t()));
  }
  return tasks.length;
}

const confirmationKey = (pageId: string, accountId: string, version: number) =>
  `confirm#${pageId}#${accountId}#${version}`;

export async function seed(req: WebtriggerRequest) {
  const mode = param(req, 'mode', 'confirmations');
  const start = Number(param(req, 'start', '0'));
  const count = Number(param(req, 'count', '40'));
  const tasks: (() => Promise<unknown>)[] = [];

  if (mode === 'confirmations') {
    for (let u = start; u < start + count && u < USERS; u++) {
      for (let v = 1; v <= VERSIONS; v++) {
        tasks.push(() =>
          kvs.entity('confirmation').set(confirmationKey(HOT_PAGE, `user-${u}`, v), {
            pageId: HOT_PAGE,
            accountId: `user-${u}`,
            pageVersion: v,
            confirmedAt: new Date(Date.UTC(2026, 0, 1 + v, 0, 0, u)).toISOString(),
            spaceKey: 'HOT',
          })
        );
      }
    }
  } else if (mode === 'userfan') {
    for (let p = start; p < start + count && p < FAN_PAGES; p++) {
      tasks.push(() =>
        kvs.entity('confirmation').set(confirmationKey(`page-${p}`, HOT_USER, 1), {
          pageId: `page-${p}`,
          accountId: HOT_USER,
          pageVersion: 1,
          confirmedAt: new Date(Date.UTC(2026, 1, 1, 0, 0, p % 60, p)).toISOString(),
          spaceKey: `SP${p % SPACES}`,
        })
      );
    }
  } else if (mode === 'configs') {
    for (let p = start; p < start + count && p < CONFIGS; p++) {
      tasks.push(() =>
        kvs.entity('page-config').set(`config#page-${p}`, {
          pageId: `page-${p}`,
          active: true,
          spaceKey: `SP${p % SPACES}`,
        })
      );
    }
  } else {
    return json(400, { error: `unknown mode: ${mode}` });
  }

  const written = await inBatches(tasks);
  return json(200, { mode, start, count, written });
}

type Timed = { ms: number[]; p50: number; p95: number; max: number; note?: string };

async function time(iterations: number, fn: () => Promise<string | number>): Promise<Timed> {
  const ms: number[] = [];
  let note: string | number = '';
  for (let i = 0; i < iterations; i++) {
    const t0 = Date.now();
    note = await fn();
    ms.push(Date.now() - t0);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { ms, p50: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1], note: String(note) };
}

export async function measure(req: WebtriggerRequest) {
  const iterations = Number(param(req, 'iterations', '5'));

  // P1 — macro hot path: latest confirmed version for (page, user). Target: single-digit ms budget share.
  const macroLookup = await time(iterations, async () => {
    const r = await kvs
      .entity('confirmation')
      .query()
      .index('by-page-user', { partition: [HOT_PAGE, 'user-42'] })
      .sort(Sort.DESC)
      .limit(1)
      .getMany();
    return `latestVersion=${(r.results[0]?.value as { pageVersion?: number })?.pageVersion}`;
  });

  // P2 — dashboard drill-down, first paint: first 100 records for the hot page.
  const pageFirstPage = await time(iterations, async () => {
    const r = await kvs
      .entity('confirmation')
      .query()
      .index('by-page', { partition: [HOT_PAGE] })
      .limit(100)
      .getMany();
    return `results=${r.results.length}`;
  });

  // P2b — full drain of the hot page (1k records, cursor loop) — the CSV-export shape.
  const pageFullDrain = await time(iterations, async () => {
    let cursor: string | undefined;
    let total = 0;
    let pages = 0;
    do {
      let q = kvs.entity('confirmation').query().index('by-page', { partition: [HOT_PAGE] }).limit(100);
      if (cursor) q = q.cursor(cursor);
      const r = await q.getMany();
      total += r.results.length;
      cursor = r.nextCursor;
      pages++;
    } while (cursor && pages < 20);
    return `records=${total} pages=${pages}`;
  });

  // P3 — user history: confirmations by one user across pages.
  const userHistory = await time(iterations, async () => {
    const r = await kvs
      .entity('confirmation')
      .query()
      .index('by-user', { partition: [HOT_USER] })
      .limit(100)
      .getMany();
    return `results=${r.results.length}`;
  });

  // P4 — dashboard list: tracked pages, site-wide.
  const trackedList = await time(iterations, async () => {
    const r = await kvs
      .entity('page-config')
      .query()
      .index('tracked', { partition: [true] })
      .limit(100)
      .getMany();
    return `results=${r.results.length}`;
  });

  // P4b — dashboard list filtered to one space (where on the range attribute).
  const trackedBySpace = await time(iterations, async () => {
    const r = await kvs
      .entity('page-config')
      .query()
      .index('tracked', { partition: [true] })
      .where(WhereConditions.equalTo('SP3'))
      .limit(100)
      .getMany();
    return `results=${r.results.length}`;
  });

  return json(200, {
    iterations,
    patterns: { macroLookup, pageFirstPage, pageFullDrain, userHistory, trackedList, trackedBySpace },
  });
}

export async function wipe() {
  const tasks: (() => Promise<unknown>)[] = [];
  for (let u = 0; u < USERS; u++)
    for (let v = 1; v <= VERSIONS; v++)
      tasks.push(() => kvs.entity('confirmation').delete(confirmationKey(HOT_PAGE, `user-${u}`, v)));
  for (let p = 0; p < FAN_PAGES; p++)
    tasks.push(() => kvs.entity('confirmation').delete(confirmationKey(`page-${p}`, HOT_USER, 1)));
  for (let p = 0; p < CONFIGS; p++) tasks.push(() => kvs.entity('page-config').delete(`config#page-${p}`));
  const deleted = await inBatches(tasks);
  return json(200, { deleted });
}
