# UI Kit Architecture & Implementation Plan (v1)

> **Status:** Ready for implementation · July 2026
> **Author:** Opus (architecture) → hand-off to Sonnet (code)
> **Base:** `bitbucket/main` scaffold (`3a141d1`) — the layered TypeScript backend and the
> `docs/00`–`06` specs are the authority. This document records the **one deliberate deviation**
> (Custom UI → UI Kit) and everything that follows from it. Where this doc is silent, the
> existing `docs/02`–`06` are normative and unchanged.
>
> **Revision (PR #1 review, post-July 2026):** §5's export design changed. The original plan below
> served export through a token+secret-guarded webtrigger because UI Kit cannot trigger a browser
> download. Review flagged real problems with that webtrigger (an un-chunked >100-page visibility
> read that silently dropped rows, a status computation that could never report `expired`, and the
> secret traveling in the download URL itself). The fix moves *only* the download action to a small
> Custom UI surface (`static/export-ui/`) — the one deliberate exception to "UI Kit only, no build
> step" below — and deletes the webtrigger outright: role-gating, visibility filtering, row
> building, and CSV/PDF assembly all stay exactly where they were, in a normal `asUser` resolver,
> just returned over `invoke()` instead of a separate HTTP endpoint. §5 reflects the new design;
> §1's table, §3's manifest sample, and §9's invariant 6 are updated to match. The rest of this
> document (§2, §4, §6–§8, §10) is otherwise unchanged.

---

## 0. Why this document exists

The `bitbucket/main` scaffold is an excellent, spike-validated design for the Read Confirmation
("Acknowledge for Confluence") product. We keep its backend architecture wholesale. We change
**one thing** at the owner's direction and follow the consequences precisely:

| Decision | Reference (`docs/02`) | This plan | Reason |
|---|---|---|---|
| Frontend tech | **Custom UI** (Vite MPA, `static/app`, `packages/shared` bridge) | **UI Kit** (`@forge/react`, `render: native`) | Owner directive; proven in the prior Attestly build; no bundler/build step → **maintainability is the stated priority** |
| Test runner | Vitest | **Jest** (`ts-jest`) | Owner directive (PRD §4.1 explicitly permits "Vitest **or Jest**") |
| File download | client-side Blob (Custom UI can) | **one small Custom UI surface** (`static/export-ui/`) calling the same `asUser` resolver every other surface uses (revised post-PR-review — see the box above; originally a token-guarded webtrigger) | UI Kit's sandbox can't trigger a download; Custom UI can — §5 below |
| Scopes | already minimal (`docs/02` §7) | **same, re-justified per-scope** (§6) | Owner: "review permissions, no excess access" — the prior build over-scoped; the reference is already least-privilege |
| Repo shape | npm workspaces + Vite | **single package, flat `src/`** | No static↔src boundary once Custom UI is gone → `packages/shared` loses its only reason to exist (`docs/02` §3) |

**Everything else is unchanged:** layered backend (resolvers → domain → storage → events),
KVS custom entities and indexes (`docs/03` §2), computed-never-stored status (`docs/03` §3),
append-only audit records (`docs/03` §1), three-tier authorization (`docs/02` §4), the visibility
rule (`docs/02` §4), correctness behaviors (`docs/02` §6), i18n en/tr (`docs/02` §5),
and the v1/v1.1 split (reminders + reconfirm-on-change stay v1.1).

---

## 1. What UI Kit changes vs. what it preserves

### Preserved (do not touch — the value of the reference)
- `src/domain/` — pure TS, no Forge imports, exhaustively unit-tested. Status computation,
  expiry, idempotency, %-complete, CSV/PDF row building all live here.
- `src/storage/` — typed KVS custom-entity accessors, cursor pagination, idempotent confirm
  with counter bump in one transaction, append-only guards (no update/delete on
  `confirmation`/`config-audit`).
- `src/resolvers/` — thin handlers, `{ok,data}|{ok,code,message}` envelope, three-tier auth.
- Manifest `app.storage.entities` — **byte-for-byte the reference's** (validated on Forge,
  `docs/03` §2). Never improvise entity/index names (lowercase only).
- `permissions.scopes` — the reference's five scopes, no additions in v1 (§6).

### Changed (the UI Kit consequences)
1. **No `static/app`, no `packages/shared` workspace** for the app proper. Frontend becomes
   `@forge/react` components under `src/frontend/`. Shared types + i18n move to `src/shared/`
   (imported by both backend and frontend — now one Forge bundle, so a plain relative import is
   legal and the workspace package is unnecessary). The one exception, post-PR-review (§5):
   `static/export-ui/` is a small, separate Vite project — see the revision box at the top.
2. **Resources point at `.tsx` UI Kit entries** with `render: native` (not `entry`/`build`) —
   except `export-ui` (§5), which is Custom UI and has no `render:` set.
3. **Assignment config is a UI Kit `Modal`, not a native macro-config panel** — see §4.3. This
   keeps the hard rule from `docs/02` §11.6 (**assignment data never enters page ADF**) trivially
   satisfied: there is no macro config ADF to leak into.
4. **Export's CSV/PDF assembly is server-side** (§5), in the same `asUser` resolver layer as
   everything else — not a webtrigger, not client Blob assembly. PDF generation itself is
   **server-side** (UI Kit/Custom UI both skip a DOM/canvas dependency this way) by a pure
   `src/domain/pdf.ts`. The Custom UI surface only turns the resolver's response into a download.
5. **Test runner Jest** with `ts-jest`; CI swaps `vitest run` → `jest`.

### Cost we accept, stated honestly
Superseded by the PR #1 revision (see the box at the top of this document): the original plan here
traded away the **"Runs on Atlassian"** badge for a token-guarded export webtrigger. There is no
webtrigger in this app anymore — §5 below moved the download action to a small Custom UI surface
instead — so that trade no longer exists and the badge is no longer forfeited. The one remaining,
much narrower cost is the "no build step" rule: `static/export-ui/` is a real Vite project with its
own `package.json`/`node_modules`/build output, the sole exception to "UI Kit only, bundled
directly by the Forge CLI" (§1's "Changed" list, item 1).

---

## 2. Repository layout (target)

```
manifest.yml            UI Kit modules + one Custom UI module (export-ui, §5) + storage entities
                        + 5 scopes; no webtrigger (revised post-PR-review, see the box above)
package.json            single package (NOT workspaces): @forge/api, @forge/react, @forge/resolver,
                        @forge/kvs, @forge/bridge; dev: typescript, jest, ts-jest, @types/*
tsconfig.json           strict; moduleResolution "node" (Forge bundler requirement, docs/02 §10)
jest.config.js          ts-jest preset; coverage gates (domain 95% branches, overall 80%)
.nvmrc                  22
.github/workflows/ci.yml  forge lint · tsc --noEmit · eslint · jest --coverage · scope-snapshot
src/
  index.ts              Resolver() + registerResolvers → export handler
  resolvers/
    index.ts            registerResolvers(): thin handlers, three-tier auth
    auth.ts             role/permission gate helpers (isComplianceManager, assertCanConfigure…)
  domain/               PURE — no @forge/* imports anywhere in this dir
    status.ts           computeStatus (docs/03 §3), %-complete
    confirm.ts          idempotency key derivation + record shape
    csv.ts              CSV builder (docs/03 §4 — exact columns, RFC 4180, BOM)
    pdf.ts              minimal PDF builder from the same rows (server-side; WinAnsi + tr chars)
    export.ts           row assembly shared by csv.ts/pdf.ts (docs/03 §4 row law)
  storage/
    entities.ts         ENTITY names + key builders (already in scaffold — keep)
    confirmations.ts    idempotent write + counter txn; by-page-user hot read; cursor drains
    configs.ts          page-config CRUD (soft-delete via active), tracked-index queries
    settings.ts         singleton get/save
    audit.ts            config-audit append-only writer + by-page reader
  events/               v1.1 only — leave .gitkeep, no modules declared in v1
  frontend/             @forge/react UI Kit surfaces (render: native)
    macro.tsx           reader states R1–R7 (docs/04 §2.1)
    byline.tsx          chip + dialog (docs/04 §2.2)
    dashboard.tsx       list + filters + drill-down (export button navigates out, §5)
    settings.tsx        managers group, defaults, export-all, lifecycle notice (docs/04 §3.5)
    components/         shared UI Kit pieces: StatusLozenge, ConfirmBlock, ConfigModal, useInvoke,
                        exportNavigation.ts (router.navigate to the Custom UI export surface)
  shared/               was packages/shared — types + i18n, imported by backend AND frontend
    types.ts            invoke contract (Result<T>, PageStatusResponse, …)
    i18n/{en,tr,index}.ts
static/export-ui/       the one Custom UI surface (§5) — its own package.json/vite.config.ts,
                        imports src/shared/{types,i18n} by relative path same as the backend does
tests/                  or co-located *.test.ts — Jest
docs/                   00–06 (unchanged) + 07 (this) + 08 (test cases)
```

Delete from the scaffold: `static/app`, `packages/`, `src/events/.gitkeep` stays. Move
`packages/shared/src/{types,i18n}` → `src/shared/`. `src/webtriggers/` and
`src/storage/exportJobs.ts` existed in an earlier revision of this plan and were deleted
post-PR-review (§5) — there is no webtrigger in this app.

---

## 3. Manifest (target)

```yaml
modules:
  macro:
    - key: acknowledge-macro
      resource: macro
      render: native
      resolver: { function: resolver }
      title: Read confirmation
      # NO `config:` block — assignment is a UI Kit Modal (§4.3), never page ADF (docs/02 §11.6)
  confluence:contentBylineItem:
    - key: acknowledge-byline
      resource: byline
      render: native
      title: Read confirmation
      # T8 residual (docs/02 note): byline schema historically rejects `resolver`.
      # Verify: does render:native byline accept `resolver`? If not, the component still
      # invoke()s the shared resolver function; the chip label comes from dynamicProperties.
      dynamicProperties: { function: bylineProps }
  confluence:globalPage:
    - key: acknowledge-dashboard
      resource: dashboard
      render: native
      resolver: { function: resolver }
      route: read-confirmations
      title: Read confirmations
    - key: acknowledge-export        # the ONLY Custom UI module (no render:); §5, post-PR-review
      resource: export-ui
      resolver: { function: resolver }   # same shared resolver function as every other module
      route: read-confirmations-export   # Forge route pattern is ^[a-z0-9-]+$ -- no `/`
      title: Export read confirmations
  confluence:globalSettings:
    - key: acknowledge-settings
      resource: settings
      render: native
      resolver: { function: resolver }
      title: Read Confirmation
  function:
    - { key: resolver,    handler: index.handler }
    - { key: bylineProps, handler: bylineProps.handler }   # if dynamicProperties needs it
resources:
  - { key: macro,      path: src/frontend/macro.tsx }
  - { key: byline,     path: src/frontend/byline.tsx }
  - { key: dashboard,  path: src/frontend/dashboard.tsx }
  - { key: settings,   path: src/frontend/settings.tsx }
  - { key: export-ui,  path: static/export-ui/build }   # Vite build output, §5
app:
  runtime: { name: nodejs22.x }
  id: ari:cloud:ecosystem::app/560c26ed-f8d8-4c20-8646-67d59784d534   # keep scaffold id
  storage:
    entities: [ … EXACTLY as bitbucket/main manifest — confirmation, page-config,
                settings, config-audit with their indexes … ]
permissions:
  scopes:
    - storage:app
    - read:page:confluence
    - read:user:confluence
    - read:group:confluence
    - read:content.permission:confluence
  # No write:* in v1. No permissions.external in any version.
```

> **Toolchain (docs/02 §10):** Forge CLI ≥ 13, Node 22 (`.nvmrc`). Backend tsconfig
> `moduleResolution: node`. Confirm UI Kit `.tsx` resources compile under the Forge bundler in T1
> (the prior Attestly build used `.jsx`; `.tsx` + strict is the only new wrinkle).

---

## 4. Frontend (UI Kit) surface plan

All surfaces: `@forge/react` + `@forge/bridge` `invoke()`; `view.getContext()` for page/user;
strings from `src/shared/i18n` (never literals); Atlaskit tokens (light+dark auto). One
`useInvoke` hook with loading/error. **Pessimistic confirm** everywhere (`docs/04` §1.3).

### 4.1 Macro (`macro.tsx`) — reader states R1–R7 (`docs/04` §2.1)
Single `getPageStatus({pageId})` round-trip renders the whole macro (<2s budget). Map response →
state: R1 required · R2 confirming (button `isLoading`, no optimistic flip) · R3 confirmed
(`SectionMessage success`, local-tz display of UTC) · R5 voluntary · R6 retryable error (button
re-enabled) · R7 page-changed-mid-read (reload prompt). R4 (expired) computed but hidden behind the
v1.1 flag. `aria-live="polite"` on R2→R3/R6. Multi-macro: first active, others inert warning.

### 4.2 Byline (`byline.tsx`) — chip + dialog (`docs/04` §2.2)
`dynamicProperties` sets the chip (required / confirmed {date} / expired / hidden-if-uninvolved).
Click → UI Kit dialog reusing the macro's `ConfirmBlock`; chip refreshes on close. Writes the same
record as the macro (same `confirm` resolver).

### 4.3 Assignment config — UI Kit `Modal`, not native config (**key adaptation**)
Where the reference used a Custom UI macro-config panel (`docs/04` §3.1), we use a UI Kit `Modal`:
- On the macro, a page editor (has edit permission) sees a secondary **"Configure read
  confirmation"** button → opens `ConfigModal` (`UserPicker` multi + group picker + due-date +
  reconfirm lozenge, both disabled/v1.1). **Save → `invoke('saveConfig')` → KVS**; the macro then
  re-reads from KVS. Nothing is written to page ADF.
- The same `ConfigModal` is reachable from a dashboard row (edit an existing config later).
- Empty assignment ⇒ voluntary-only notice (R5 for everyone).
- This preserves `docs/02` §11.6 by construction: there is no ADF config to tamper with or roll
  back on version restore.

> **T7 residual to verify (Sonnet):** confirm `@forge/react` exposes a working group picker
> (`GroupPicker`) and that `UserPicker`/`GroupPicker` are wired to Confluence user/group **search**
> under the current scopes; if a search endpoint/scope is missing, note it before assuming the
> picker resolves. The prior Attestly build used `UserPicker isMulti` successfully.

### 4.4 Dashboard (`dashboard.tsx`) — list + drill-down + export (`docs/04` §3.2–3.4)
- **List** from the `tracked` index + advisory counters (never fan out over records, `docs/02` §5).
  `DynamicTable`, `ProgressBar` in %, overdue marker, voluntary "—" tooltip, `[deleted page {id}]`
  rows excluded from %, first-run `EmptyState`, no-access `EmptyState` (role gate: Confluence admin
  OR compliance-managers group).
- **Visibility rule (normative, `docs/02` §4):** bulk `asUser` page resolution filters rows; an
  `asApp` existence probe separates deleted (shown, no title) from viewer-restricted (row omitted
  entirely). A manager sees no trace of pages they personally can't view.
- **Drill-down:** five tabs (Outstanding / Confirmed / Voluntary / Cannot view / History) with
  counts; group membership resolved at call time; permission-check fan-out **batched ~10 concurrent
  with per-invocation cache**, 404→`[deleted user]`; counter self-heal on load; History from
  `config-audit`.
- **Export:** the "Export" button doesn't open an in-page dialog — UI Kit can't trigger a browser
  download, so it never owned that job. It calls `router.navigate()` to the Custom UI export
  surface (§5, `exportNavigation.ts`), carrying the current scope (page/space) as a query param.
  That surface owns the format/scope/date-range/status-filter form and the download itself.

### 4.5 Settings (`settings.tsx`) — admin only (`docs/04` §3.5)
Compliance-managers group picker, defaults (reconfirm off in v1), "Export all data" (site scope
through the same export pipeline), 28-day/21-day data-lifecycle notice (exact i18n copy).
`getSettings`/`saveSettings` admin-gated.

---

## 5. Export design — revised post-PR-review (superseded the original webtrigger design)

> The original version of this section (webtrigger + transient job + shared-secret token) is kept
> below as **§5.1 (superseded)** for the record. This is the live design.

**Problem:** UI Kit can't download a file (no DOM Blob). The original design worked around that
with a webtrigger, but a PR review (Eren Burak Tutuş, Bitbucket PR #1) found three real problems
with it: (1) the visibility-resolution helper it reused capped its bulk `asUser` read at 100 ids
without chunking, so a site/space export over 100 tracked pages silently dropped the overflow as
"restricted"; (2) status was computed against the confirmer's own last-confirmed version instead of
the page's live version, so export could never report `expired`; (3) the shared secret traveled in
every download URL (browser history, proxy logs, `Referer`), on top of a non-constant-time compare,
a get-then-delete TOCTOU on "one-time" redemption, and a TTL that was stored but never checked
server-side.

**Fix:** stop trying to make a webtrigger UI-Kit-safe and visibility-safe at the same time, and
instead give *only the download action* to a small Custom UI surface — the one part of the app that
actually needs a real browser to trigger a download. Everything else that made the original design
correct (role gate, `asUser` visibility filtering, row building, CSV/PDF assembly) doesn't move at
all; it just returns its result over `invoke()` like every other resolver in this app, instead of
over a separate HTTP endpoint that needed its own auth scheme.

**Flow**
1. **`static/export-ui/`** — a small, framework-free Vite bundle (`confluence:globalPage` module
   `acknowledge-export`, Custom UI, route `read-confirmations-export`). Renders the format/scope/
   date-range/status-filter form. The dashboard/drill-down/settings "Export" buttons reach it via
   `router.navigate()` (`exportNavigation.ts`), passing the fixed page/space scope as a query param
   — there is no in-page UI Kit dialog anymore.
2. **`exportFile` resolver (`asUser`, `src/resolvers/export.ts`)** — role-gated exactly like the
   old `startExport`, called via a normal `invoke('exportFile', payload)` from the Custom UI page.
   Resolves the in-scope, viewer-visible page set the same way the dashboard does
   (`resolvePageVisibility`/`buildDashboardRow`/`matchesStatusFilter`, now chunked past 100 ids —
   fix for finding 1), builds `ExportRow[]` per page (`src/domain/export.ts`, using each page's
   real live version from `resolvePageVisibility` as `currentVersion` — fix for finding 2), and
   serializes with the unchanged `csv.ts`/`pdf.ts`. Returns the file directly in the resolver
   response: `{ format: 'csv', filename, csv }` or `{ format: 'pdf', filename, base64 }`.
3. **The Custom UI page turns the response into a download** — `new Blob([...])` +
   `URL.createObjectURL` + a synthetic `<a download>` click. That's it; there is no second request.

**Why this is correct and safe**
- Visibility filtering still happens under `asUser`, in the same place it always did — nothing
  about that guarantee changed, it just isn't handed off to a separate `asApp`-only endpoint anymore.
- No webtrigger exists in this app at all (`src/release/manifest.test.ts`'s TC-H2 now asserts
  zero, not one) — finding 3's entire class of problem (secret-in-URL, TOCTOU, TTL) has nothing
  left to apply to, because there's no separate one-time-redeemable URL in the first place. The
  file travels back over the same authenticated `invoke()` channel every other feature already uses.
- No transient `export-job` KVS record either — the whole job happens in one resolver invocation,
  so there's nothing to leak, replay, or let expire incorrectly.
- CSV + PDF still come from the **same rows** (`src/domain/export.ts`) ⇒ record parity guaranteed
  (`docs/03` §4) — unchanged from the original design.
- **Cost:** `static/export-ui/` is a real Vite project (own `package.json`, `node_modules`, build
  output) — the one exception to "UI Kit only, no build step" (§1). CI builds it before `forge
  lint`/tests (`.github/workflows/ci.yml`); Forge's own deploy step needs it built too.
- **Open residual, not yet verified against a live site** (this doc's standing convention, `docs/02`
  §11): passing the Custom UI module's flat `route:` as a bare string to `@forge/bridge`'s
  `router.navigate()` (`exportNavigation.ts`) is believed correct per the installed
  `@forge/bridge` type definitions but hasn't been exercised on a real Confluence site in this
  session — verify on the next deploy-and-test pass. A second, smaller residual: whether a
  `confluence:globalPage` module without an explicit "hide from nav" flag shows up as an extra
  entry in Confluence's global nav alongside the main "Read confirmations" dashboard is cosmetic,
  not a blocker, and worth checking the same pass.

### 5.1 Original design (superseded — kept for the record)

**Problem (as understood at the time):** UI Kit can't download a file (no DOM Blob); a webtrigger
can serve one but runs `asApp` only — so a naive webtrigger would **bypass the per-viewer
visibility rule** (`docs/02` §4) and could leak restricted pages. Solution: split responsibilities
so `asUser` does the visibility filtering and the webtrigger is a dumb, short-lived byte-streamer.

**Flow**
1. **`startExport` resolver (`asUser`)** — role-gated. Resolves the in-scope, **viewer-visible**
   page set exactly like the dashboard (bulk `asUser` page reads → titles + visibility filter).
   Writes a transient `export-job` record: `exportjob#{token}` =
   `{ token, requestedBy, format, scope, filters, visiblePageIds[], pageTitles{}, createdAt }`,
   TTL ~5 min, one-time. `token` is high-entropy random. Returns
   `webTrigger.getUrl('export-trigger') + '?job={token}&k={SECRET}'`.
2. **`exportTrigger` webtrigger (`asApp`)** — validates `k` against an encrypted env secret
   (`forge variables set --encrypt EXPORT_SECRET …` **per environment**) → 403 on mismatch. Loads
   the job by token (404/expired → 410 Gone). Reads `confirmation` records for the job's
   `visiblePageIds` (app data — no page-view permission needed), computes rows/status via
   `src/domain/export.ts`, builds CSV (`csv.ts`) or PDF (`pdf.ts`), streams with
   `Content-Disposition: attachment; filename="read-confirmations_{scope}_{YYYY-MM-DD}.{ext}"`.
   Deletes the job (one-time). No visibility decision happens here — it was baked into
   `visiblePageIds` by the `asUser` resolver.

**Why this was believed correct and safe at the time (superseded by the findings above):**
- Visibility filtering happens under `asUser` (can't leak). The webtrigger only ever touches pages
  already cleared for this exporter.
- The job stores only IDs + titles (small — bounded by *tracked* pages, well under the 240 KiB KVS
  value cap; if a site ever exceeds it, chunk the job — note as a scale residual).
- Heavy confirmation records are read fresh by the webtrigger, never stored in the job.
- Token = random one-time job key + short TTL + encrypted shared secret ⇒ the URL isn't a durable
  data-exfil handle, and only a role-gated manager can mint one.
- CSV + PDF come from the **same `export.ts` rows** ⇒ record parity guaranteed (`docs/03` §4).

**Deviations from reference to record:** PDF is **server-side** (reference was client-side —
impossible in UI Kit); this remains true after the post-PR-review revision above (`domain/pdf.ts`
is unchanged) — only the *download* action moved to Custom UI, not PDF generation itself. Export
being a **webtrigger** was the original UI Kit-directive consequence recorded here; §5 above
records why that's no longer the design.

---

## 6. Scope review (least privilege — owner ask)

The reference is already least-privilege; we keep it and justify each, and record what the **prior
Attestly build over-requested** so the reduction is deliberate.

| Scope | Kept? | Why (v1) |
|---|---|---|
| `storage:app` | ✅ | KVS custom entities — the whole datastore |
| `read:page:confluence` | ✅ | server-authoritative page version + title (v2 pages API); the `confirm` proof-of-view read |
| `read:user:confluence` | ✅ | display-name resolution at render/export (granular; not the broad `read:confluence-user`) |
| `read:group:confluence` | ✅ | resolve group membership for assignments + managers group |
| `read:content.permission:confluence` | ✅ | other-user "can view" checks (cannot-view tab) + deleted-vs-restricted probe |

**Removed / never added vs. the prior Attestly build (`macro-project`):**
- `write:comment:confluence` — the prior build used it for @mention reminders. **Reminders are
  v1.1** here; v1 has **zero write scopes**. Ship reminders later via rolling release + Permissions
  SDK gating (`docs/02` §2, §7). This is the single biggest scope reduction.
- `read:confluence-content.summary` — prior page-updated trigger scope. The page-updated **trigger
  is v1.1**; correctness never depends on it (status is computed from versions, `docs/02` §6.2).
- **Webtrigger export was unauthenticated then token-patched** in the prior build; the token-guard
  approach was tried here too (§5.1) before a PR review found it still had real problems and export
  moved off webtriggers entirely (§5) — no export-specific scope was ever needed either way.
- No `read:content.metadata:confluence` beyond what the five scopes cover; no `read:space`,
  no `write:*`, no `permissions.external`.

**CI guard (T14):** manifest scope snapshot test — any PR touching `permissions.scopes` must
consciously update the snapshot. Keep `forge lint` in CI. (RoA `forge eligibility` gate from the
reference is **dropped** — replaced with a test that now asserts **zero** webtriggers exist, so no
*accidental* webtrigger creeps back in; the badge itself is no longer forfeited, see §5.)

---

## 7. Test strategy (Jest) — the app's value is trustworthy records

Weighting per `docs/05`: ~60% domain unit, ~30% resolver/storage integration, ~10% manual E2E.
Runner: **Jest + ts-jest**. Coverage gates: **domain ≥95% branches**, overall ≥80% lines — gate
fails the PR.

### 7.1 Unit — `src/domain/*` (pure, no mocks)
- **status.ts** (`docs/05` §2.1): table-driven over (records, currentVersion, reconfirmOnChange,
  permission) → confirmed/expired/outstanding/cannot-view; latest-version-wins; page-deleted
  excluded from % denominator; **purity: inject a fixed clock, assert no `Date.now()` inside**.
- **confirm.ts** (`docs/05` §2.2): deterministic key; idempotent (2nd write `created:false`,
  byte-identical); IDs containing `#` handled (escape or reject).
- **%-complete** (`docs/05` §2.3): voluntary excluded; cannot-view excluded from denominator;
  0-assigned ⇒ "—" not 0%; group+direct overlap counted once.
- **csv.ts / export.ts** (`docs/05` §2.4): exact header order; RFC 4180 quoting (commas, quotes,
  newlines, `Ayşe`/`Gökhan`); UTF-8 BOM; outstanding rows with empty confirmation fields;
  **row-count law property test** (`assigned×pages + voluntary`); `[deleted page]`/`[deactivated]`/
  `[deleted user]` placeholders; ISO-8601-Z timestamps.
- **pdf.ts**: parses (pypdf/pdf-parse) and carries the same rows as the CSV of the same scope +
  report header (scope, `exported_at_utc`, app version); Turkish characters survive.

### 7.2 Integration — resolvers + **in-memory KVS fake**
Build a fake implementing the custom-entity interface (get/put/query-with-cursor/transaction) that
**enforces platform limits** (page max 100 / default 10, 240 KiB value cap, 25 ops/txn) so limit
bugs fail in CI (`docs/05` §3). Cover: auth rejection with no data leak; confirm writes
**server-read** version + server clock, ignores client version; version drift ⇒ `pageChanged`, no
write; immutability (no update/delete methods exist for confirmation/config-audit — compile + run
assert); pagination over 500 pages / 10k records; counter self-heal; every saveConfig writes a
config-audit row; deleted-content 404 → `[deleted page]`, zero writes, resume on restore.

### 7.3 Manual E2E checklist
Keep `docs/release-checklist.md` (from `docs/05` §4), adapted: drop the client-Blob step, add
"export from the Custom UI surface actually triggers a browser download for both CSV and PDF,
scoped correctly from the dashboard/drill-down/settings entry points", and "a manager cannot
export a page they can't view (visibility rule)". The original checklist item here (webtrigger
403/410 behavior) no longer applies — there is no webtrigger to test.

### 7.4 Acceptance test cases — see `docs/08_test_cases.md`
Given/When/Then persona-driven cases in the owner's required format (the Test Cases 1.0.0 sheet).

---

## 8. Task plan (adapts `docs/06` T1–T15 to UI Kit + Jest)

Same epics/dependencies as `docs/06`; deltas only:

- **T1 Scaffold** — UI Kit modules (§3), **single package (no workspaces)**, Jest not Vitest,
  move `packages/shared`→`src/shared`, delete `static/`+`packages/`. Accept: 4 surfaces render a
  hello page on dev; CI green. **Verify `.tsx` resources bundle.**
- **T2 Storage** — unchanged from `docs/06` (KVS entities exact; idempotent confirm txn;
  append-only). (`exportJobs.ts` was added here originally and removed post-PR-review, §5 — no
  transient job record in the current design.)
- **T3 Domain status** — unchanged.
- **T4 Resolvers** — unchanged three-tier auth; add `exportFile` (§5; originally `startExport`,
  renamed when the webtrigger was removed).
- **T5 i18n + theming** — catalogs already lifted in `src/shared/i18n`; wire `@forge/react` theme
  (auto) + locale from context. (No react-intl needed — a tiny `t(key, vars)` over the catalog.)
- **T6 Macro R1–R7** — UI Kit components; pessimistic confirm.
- **T7 Assignment** — **UI Kit `ConfigModal`** (§4.3), not native macro config.
- **T8 Byline** — chip + dialog; resolve the byline-resolver schema residual.
- **T9 Dashboard** — visibility rule; list from counters.
- **T10 Drill-down** — batched permission checks; History from config-audit.
- **T11 Export** — CSV per `docs/03` §4; **`exportFile` resolver + Custom UI download surface**
  (§5, post-PR-review — originally a webtrigger pipeline).
- **T12 PDF** — **server-side `domain/pdf.ts`** (not client-side); parity test.
- **T13 Settings** — admin gate; export-all via §5 site scope.
- **T14 CI guards** — scope snapshot; **zero-webtrigger assertion** (replaces `forge eligibility`;
  originally asserted exactly one, updated post-PR-review when the webtrigger was removed).
- **T15 Listing** — security statement says "no external egress, no write scopes, data stays in
  Forge" (drop the RoA-badge claim); free ≤10-users boundary is Marketplace-tier billing
  (Partner Portal $0 price for the 1–10 tier), **not** an in-app code path — see `docs/01` §5.

**v1.1 (unchanged, out of scope now):** reconfirm-on-change UI + page-updated trigger (notify
only), reminders (`write:comment`, scheduledTrigger) via rolling release + Permissions SDK gate.

---

## 9. Invariants Sonnet must not break (compile/test-enforced)

1. `src/domain/**` imports nothing from `@forge/*` (lint rule / review).
2. No code path updates or deletes `confirmation` or `config-audit` (storage layer exposes no such
   method; CI grep/AST guard).
3. Status is computed, never stored; no clock read inside domain functions.
4. `confirmedAt` + `pageVersion` come from server reads only, never the client payload.
5. Assignment data never written to page ADF (there is no macro `config:` block — keep it that way).
6. **No webtrigger** (revised post-PR-review, §5) — export runs through the normal `asUser`
   resolver + Custom UI `invoke()` path, the same as every other feature. `manifest.test.ts`'s
   TC-H2 asserts zero webtriggers exist, not one.
7. `permissions.scopes` = the five in §6; any change updates the snapshot test in the same PR.

---

## 10. Open residuals to resolve during coding (not blockers)
- Byline `resolver`-property schema (T8) — confirm the invoke pathway under `render: native`.
- `@forge/react` group picker + user/group **search** endpoint/scope (T7).
- Forge bundling of `.tsx` resources + `src/shared` relative import (T1 — validate early).
- Free-tier (≤10 users) enforcement point + pricing numbers (T15 — still blocked on research,
  `docs/01` §5).
- `router.navigate()` to the Custom UI export surface's flat `route:` string, and whether a
  `confluence:globalPage` module without an explicit "hide from nav" flag adds an unwanted nav
  entry (§5, post-PR-review) — verify both on the next real deploy-and-test pass.
- `invoke()` response payload headroom for a very large single-call export (§5) — the resolver
  builds the whole file in one invocation now, same memory profile the old webtrigger already had,
  but the `invoke()` transport's own size ceiling (as opposed to a webtrigger HTTP response's) is
  unconfirmed against a live site; chunked row-fetching is the fallback if a real deploy hits it.
```
