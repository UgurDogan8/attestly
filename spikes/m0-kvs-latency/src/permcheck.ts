/**
 * Spike M0-2 (tech design §11 item 2): validate asApp() usage for the dashboard paths.
 *
 *   permcheck?accountId=<id>[&pageId=<id>][&operation=read]
 *
 * 1. GET /wiki/api/v2/pages (asApp)  — the dashboard's page title/version resolution path.
 * 2. POST /wiki/rest/api/content/{id}/permission/check (asApp) — "can user X view page P",
 *    the cannot-view flag. Also probes a bogus accountId to capture the error shape.
 *
 * asUser() is intentionally NOT tested here: webtriggers have no user context, which is
 * itself the finding — asUser only works in UI-invoked resolvers.
 */
import api, { route } from '@forge/api';

interface WebtriggerRequest {
  queryParameters?: Record<string, string[]>;
}

const param = (req: WebtriggerRequest, name: string): string | undefined =>
  req.queryParameters?.[name]?.[0];

export async function run(req: WebtriggerRequest) {
  const operation = param(req, 'operation') ?? 'read';
  const accountId = param(req, 'accountId');
  let pageId = param(req, 'pageId');
  const out: Record<string, unknown> = {};

  // 1 — asApp v2 pages read (also supplies a pageId if none given)
  const t0 = Date.now();
  const pagesRes = await api.asApp().requestConfluence(route`/wiki/api/v2/pages?limit=3`, {
    headers: { Accept: 'application/json' },
  });
  const pagesBody = await pagesRes.json();
  out.pagesList = {
    status: pagesRes.status,
    ms: Date.now() - t0,
    pages: (pagesBody.results ?? []).map((p: { id: string; title: string; version?: { number: number } }) => ({
      id: p.id,
      title: p.title,
      version: p.version?.number,
    })),
  };
  pageId = pageId ?? pagesBody.results?.[0]?.id;
  if (!pageId) return { statusCode: 200, body: JSON.stringify({ ...out, error: 'no page available' }, null, 2) };
  const pid: string = pageId;

  const check = async (subjectId: string) => {
    const t = Date.now();
    const res = await api
      .asApp()
      .requestConfluence(route`/wiki/rest/api/content/${pid}/permission/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ subject: { type: 'user', identifier: subjectId }, operation }),
      });
    return { status: res.status, ms: Date.now() - t, body: await res.json() };
  };

  out.pageIdChecked = pageId;
  if (accountId) out.realUserCheck = await check(accountId);
  out.bogusUserCheck = await check('712020:00000000-dead-beef-0000-000000000000');

  return {
    statusCode: 200,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify(out, null, 2),
  };
}
