# Spikes M0-1, M0-2 & M0-7 — KVS indexes/latency · asUser/asApp · multi-entry resources

**Status: all resolved (Jul 3, 2026).** Findings are folded into
[tech design §2–§4, §7, §10, §11](../../docs/02_read_confirm_tech_design.md) and
[data model §2.1–2.2](../../docs/03_read_confirm_data_model.md).

Forge app `kvs-latency-spike` (`ari:cloud:ecosystem::app/506cd05b-b77c-4ca1-acb9-e11ac9fc6868`),
registered under the Köstebek Teknoloji developer space, deployed to `development`,
installed on `kostebekteknoloji.atlassian.net` (Confluence, scope `storage:app` only — no content access).

## Results (warm, 10 iterations, 1,700 seeded records)

| Pattern | Index | p50 | p95 |
|---|---|---|---|
| Macro latest-version lookup (page,user) | `by-page-user`, `Sort.DESC`, limit 1 | 49 ms | 52 ms |
| Drill-down first page (100 of 1,000) | `by-page` | 102 ms | 155 ms |
| Full drain 1,000 records (10 cursor pages) | `by-page` | 1.02 s | 1.09 s |
| User history (100 of 200) | `by-user` | 100 ms | 112 ms |
| Tracked list (100 of 500) | `tracked`, partition `[true]` | 98 ms | 142 ms |
| Tracked filtered to one space (50 rows) | `tracked` + `where equalTo` | 78 ms | 115 ms |

Cold start adds ~150–200 ms to the first invocation.

## Key findings

1. `by-page`/`by-user` alone can't serve the macro's "(user, page) → latest version" hot path;
   added composite index `by-page-user` (partition `pageId, accountId`, range `pageVersion`).
2. Index `range` accepts exactly **one** attribute; partitions accept several. Booleans are legal partition keys.
3. Entity names must be lowercase (`^[a-z0-9:\-_.]*`): manifest uses `page-config`, `config-audit`.
4. Cursor pages read sequentially at ~100 ms each → 10k-record export ≈ 10 s; chunked export design confirmed.
5. Non-indexed-attribute `filters` are in-memory and may return empty pages — don't rely on them for correctness.
6. Every entity gets a default `by-key` index (range = data key); lexicographic order makes it unsuitable for version-numbered keys.

## M0-2: asUser/asApp + content permission check (`src/permcheck.ts`)

Scopes added for the spike: `read:page:confluence`, `read:content.permission:confluence`.
Live results on kostebekteknoloji.atlassian.net (`asApp`):

- `GET /wiki/api/v2/pages?limit=3` → 200, ~460 ms cold (page id/title/version resolution path).
- `POST /wiki/rest/api/content/{id}/permission/check` with `{subject:{type:"user",identifier},operation:"read"}`
  → `{hasPermission: true}` for a real account, ~150–250 ms per check.
- Unknown accountId → **HTTP 404** `NotFoundException` (not `hasPermission: false`) — handle as deleted-user.
- `asUser()` is untestable from webtriggers by design: no user context there (same for scheduled
  triggers and async events) — v1.1 reminder job must be all-`asApp`.
- Not covered: a `hasPermission: false` case (test page had no view restrictions) — verify in Epic B.

```
permcheck: https://506cd05b-b77c-4ca1-acb9-e11ac9fc6868.hello.atlassian-dev.net/x1/HmcNCopWZtN9N3RLdgMD8xKDhcg
           ?accountId=<atlassian-account-id>[&pageId=<id>][&operation=read]
```

## M0-7: multi-entry resource (`static/ui/`, app v3.1.0)

One resource `ui` with four HTML entries; modules reference `ui/<entry>`. Deployed live:
`entrytest-macro (spike)`, `entrytest-dashboard (spike)` (Apps menu), `entrytest-settings (spike)`
are visible on the dev install — open any of them to see the raw entry page render.
contentBylineItem was validated via `forge lint` only (a dev byline chip would show on every page).

Learned: entry files must be root-level full `<html>` documents (deploy rejects fragments);
`globalPage` requires `route`; needs CLI ≥ 13 which needs Node 22/24; adding these modules
bumped only the minor version (3.0.0 → 3.1.0) — no admin re-consent, corroborating spike M0-5;
`forge eligibility` reports the webtrigger module alone breaks Runs on Atlassian eligibility.

## M0-6: macro custom-config probe (`ui-src/config.js` → `static/ui/config.js`) — ✅ CONFIRMED

Verified in the live editor (Jul 3, 2026): modal opened on insert, contentId present in
frontend context, `invoke(ping)` returned `{"pong":true, accountId, contentId}` (server-side
context includes both — exactly what `saveConfig` needs), Save/Cancel worked.

The `entrytest-macro (spike)` now has a Custom UI config modal (`config: {resource: ui/config, openOnInsert: true}`).
**Manual check (~2 min):** edit any page → insert `entrytest-macro (spike)` → the config modal
should open automatically and print three lines:

1. `contentId from context: <id>` — draft contentId available at insert time
2. `invoke(ping): {"pong":true,...}` — **the critical one**: resolvers callable from config resources
3. Save button closes the modal and inserts the macro; Cancel aborts

If line 2 shows an error, the product falls back to a "Manage assignment" modal launched
from the macro body (tech design §11.6). Rebuild the bundle after edits with:
`npx esbuild ui-src/config.js --bundle --format=iife --outfile=static/ui/config.js`

## Re-run

Webtrigger URLs (dev install; recreate with `forge webtrigger create -f <seed|measure|wipe> -s kostebekteknoloji.atlassian.net -p Confluence -e development`):

```
seed:    https://506cd05b-b77c-4ca1-acb9-e11ac9fc6868.hello.atlassian-dev.net/x1/ISfZlauoc_rbFd3aGyA_C_39vZw
measure: https://506cd05b-b77c-4ca1-acb9-e11ac9fc6868.hello.atlassian-dev.net/x1/rgLyMWgirlZzVHHcTc3lmNsQgpg
wipe:    https://506cd05b-b77c-4ca1-acb9-e11ac9fc6868.hello.atlassian-dev.net/x1/qpWawKeWQ47B_bA8QQhewsznkME
```

Seed (1,700 records, five + two + two calls; see `src/index.ts` header), then `measure?iterations=10`.

## Cleanup

Seeded data is still present (harmless; app has no UI). To remove everything:
`curl <wipe-url>`, then `forge uninstall -e development` and delete the app in the developer console.
