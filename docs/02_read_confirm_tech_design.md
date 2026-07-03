# Technical Design: Read Confirmation App

> **Status:** Draft v0.1 · July 2026
> **Source:** [PRD](./01_read_confirm_prd.md) · [Product brief](./00_read_confirm_product_brief.md)
> **Related:** [Data model spec](./03_read_confirm_data_model.md) · [UX flows](./04_read_confirm_ux_flows.md) · [Test plan](./05_read_confirm_test_plan.md)
> ⚠️ Items marked **[SPIKE]** must be validated in milestone M0 before being treated as decided.

---

## 1. Architecture overview

A single Forge app for Confluence Cloud. All compute runs on Forge FaaS; all data lives in Forge storage; **no external egress** (keep `permissions.external` empty — this is a compliance selling point and simplifies the security statement).

```
┌─────────────────────────── Confluence Cloud ───────────────────────────┐
│                                                                        │
│  Page                          Admin                                   │
│  ┌──────────────┐              ┌─────────────────┐                     │
│  │ Macro        │              │ Global page      │                    │
│  │ (Custom UI)  │              │ (Custom UI)      │                    │
│  ├──────────────┤              ├─────────────────┤                     │
│  │ Byline item  │              │ Settings page    │                    │
│  └──────┬───────┘              └────────┬────────┘                     │
│         │  invoke (Forge bridge)        │                              │
│  ┌──────┴──────────────────────────────┴────────┐                     │
│  │            Resolvers (TypeScript)             │                     │
│  │  confirm / getStatus / assign / dashboard /   │                     │
│  │  export / settings                            │                     │
│  ├───────────────────────────────────────────────┤                     │
│  │  Domain layer (pure TS, fully unit-tested)    │                     │
│  │  status computation · expiry · idempotency    │                     │
│  ├───────────────────────────────────────────────┤                     │
│  │  Storage layer (Forge KVS custom entities)    │                     │
│  └───────────────────────────────────────────────┘                     │
│         ▲                            ▲                                 │
│  trigger: page updated        scheduledTrigger: daily reminders (v1.1) │
└────────────────────────────────────────────────────────────────────────┘
```

**Layering rule:** resolvers are thin; all business logic (status computation, expiry, assignment resolution) lives in a pure domain layer with no Forge imports, so it is unit-testable without mocking the platform.

## 2. Forge modules & manifest sketch

```yaml
modules:
  macro:
    - key: acknowledge-macro          # Epic A — confirmation block
      resource: ui/macro
      resolver: { function: resolver }
      title: Read confirmation
      config:                         # Custom UI config modal (spike M0-6)
        resource: ui/config           # Atlaskit pickers; Save writes to KVS via
        viewportSize: large           # invoke — page ADF stores NO assignment data
        openOnInsert: true
  confluence:contentBylineItem:
    - key: acknowledge-byline         # Epic A3 — per-user status
      resource: ui/byline
      resolver: { function: resolver }
  confluence:globalPage:
    - key: acknowledge-dashboard      # Epic C — admin dashboard
      resource: ui/dashboard
      resolver: { function: resolver }
  confluence:globalSettings:
    - key: acknowledge-settings       # Epic G — app settings [SPIKE: module choice]
      resource: ui/settings
      resolver: { function: resolver }
  trigger:
    - key: page-updated
      function: onPageUpdated         # Epic D (v1.1) — expiry bookkeeping
      events: [avi:confluence:updated:page]
  scheduledTrigger:
    - key: reminder-daily             # Epic E (v1.1)
      function: sendReminders
      interval: day
  function:
    - { key: resolver,      handler: index.resolver }
    - { key: onPageUpdated, handler: events.onPageUpdated }
    - { key: sendReminders, handler: events.sendReminders }
resources:                              # ONE multi-entry resource (spike M0-7)
  - key: ui
    path: static/app/build              # single Vite multi-page build output
    entry:                              # entry files must sit at the path root,
      macro: macro.html                 # each a full <html> document (deploy
      byline: byline.html               # validation rejects fragments)
      dashboard: dashboard.html
      settings: settings.html
```

- **Custom UI (not UI Kit)** for all four surfaces (macro, byline, dashboard, settings), per PRD §4.1. All four are named entries of **one** static resource built from a single React app (see §3, resolved spike M0-7).
- **Do not declare `trigger`/`scheduledTrigger` in v1** (resolved, spike M0-5). Adding modules later is a **minor** version — auto-rolled to every site with no admin consent; only permission changes (scopes, egress), licensing, providers, remotes, and *dynamic webtrigger* changes create major versions. Declaring a scheduledTrigger early would just bill daily no-op invocations (consumption billing) for zero consent benefit. v1.1's only real consent gate is the `write:comment:confluence` scope (§7): ship it via **rolling releases** (Preview) — code rolls out immediately, the reminder feature stays dark behind a Permissions SDK check (`permissions.hasScope()`) until each site's admin approves the scope. Hygiene note: never add a *dynamic* webtrigger casually — that is a major-version change.

## 3. Frontend design

- **Stack:** React 18, TypeScript strict, `@atlaskit/*` components, `@forge/bridge` for `invoke()`, `view.getContext()` for page/user context.
- **Repo layout** (resolved, spike M0-7 — single multi-entry static app): top-level `src/` is **backend-only** (bundled by Forge); the four surfaces are pages of **one** React app under `static/app/`, built once with Vite's multi-page mode into `static/app/build/`, which the manifest's single `ui` resource points at:
  ```
  manifest.yml
  package.json        # backend deps: @forge/api, @forge/resolver; npm workspaces root
  src/                # Forge FaaS backend only
    resolvers/        # thin request handlers
    domain/           # pure logic — no Forge imports
    storage/          # KVS entity access, pagination helpers
    events/           # trigger handlers (v1.1)
  static/
    app/              # ONE React app — Vite multi-page build
      macro.html byline.html dashboard.html settings.html   # MPA inputs, root level
      src/entries/    # macro.tsx · byline.tsx · dashboard.tsx · settings.tsx
      src/            # shared components, hooks (useInvoke), Atlaskit wrappers
      package.json  build/                                  # build/ = resource path
  packages/
    shared/           # workspace package: types shared between static/app and src/
  ```
- **Multi-entry resource decision (spike M0-7):** the resource `entry` property (max 50 entries, `resource: ui/<entry>` module syntax) is **Preview** but adopted: Atlassian's own `forge module add` scaffolds multi-entry resources, and we live-validated macro + globalPage + globalSettings deployments (byline via lint) on a Confluence dev app. Payoff: one build, one dependency tree, and shared chunks so Atlaskit isn't bundled four times. Fallback is mechanical (split back into four resources) if the Preview feature regresses. Platform gotchas, learned the hard way: entry HTML files must sit at the resource path **root** (no subdirectories) and be full `<html>` documents — deploy validation rejects fragments; `globalPage` additionally requires a `route` property. `packages/shared` still carries the invoke-contract types shared with `src/` (a direct relative import across the `static/` ↔ `src/` boundary would break the static build).
- **State:** no global state library; per-surface local state + a small `useInvoke` hook with loading/error handling. The confirm button uses **pessimistic** UI: disable → invoke → render confirmed state only from the resolver's authoritative response (PRD A2: never a false confirmed state).
- **Shared types:** one `types.ts` in `packages/shared`, imported by both the static apps and the resolvers — the invoke payload contract is typed end-to-end across the `static/` ↔ `src/` boundary via the workspace package (a direct relative import across that boundary would break the static apps' standalone builds).

## 4. Resolver API (invoke contract)

| Resolver | Caller | Input | Output | Notes |
|---|---|---|---|---|
| `getPageStatus` | macro, byline | `{pageId}` (context) | current user's status, page config, due date, counts | Single call renders the macro — keep it one round-trip |
| `confirm` | macro | `{pageId, pageVersion}` | new status record | Idempotent (see §6); validates user's view permission server-side |
| `getConfig` / `saveConfig` | macro config, dashboard | assignment, due date, reconfirm flag | config | Write restricted: page edit permission or compliance manager |
| `getDashboard` | dashboard | `{cursor?, spaceKey?, statusFilter?}` | page rows + cursor | Paginated; never full-scan per load |
| `getPageDetail` | dashboard | `{pageId, cursor?}` | per-user rows | Resolves group membership at call time (PRD B1) |
| `exportCsv` | dashboard | `{scope, filters, cursor?}` | CSV chunk + cursor | Chunked to stay inside invocation timeout (25s); client assembles + downloads. PDF export (PRD F2, P0) renders client-side from the same chunked dataset — no separate resolver |
| `getSettings` / `saveSettings` | settings | global defaults | settings | Admin-only |

**Authorization (resolved, spike M0-2 — validated live Jul 2026):** three call tiers, chosen per path:

1. **Frontend `requestConfluence` (@forge/bridge)** — runs as the **current user** (docs: "call the Confluence Cloud platform REST API as the current user"). Allowed only for display-only reads (e.g. rendering page titles the viewer can anyway see). Never for anything the audit record depends on.
2. **Resolver + `asUser()`** — current user's permissions, but **server-authoritative**: the `confirm` resolver reads the page version itself via `GET /wiki/api/v2/pages/{id}` under `asUser()` — one call both proves the user can view the page (404/403 if not) and supplies the version the record stores (data model §1.4). Constraint: `asUser()` **only works in UI-invoked contexts**; it fails in webtriggers, scheduled triggers, and async events → the v1.1 reminder job must be all-`asApp`.
3. **`asApp()`** — used *only* for questions the viewer's own token cannot answer, never to show content. Gated by an explicit role check (admin / compliance-manager group) in the resolver, **and** by the visibility rule below.

**Visibility rule (normative — the app is never a permission bypass):** the dashboard and all exports show only pages the *viewing* compliance manager can themselves view. Page title/metadata resolution for dashboard rows therefore runs `asUser()`, not `asApp()`, as a **bulk** call — `GET /wiki/api/v2/pages?id=a,b,c` returns *"only pages that the user has permission to view"* (v2 docs), so one chunked round-trip yields titles, versions, and the visibility filter simultaneously. Tracked pages missing from the response are disambiguated with an `asApp` existence probe: **404 → page-deleted** (rendered `[deleted page {id}]` — no title leak, §6.4); **200 → viewer-restricted → the row is omitted entirely** (its existence, title, and confirmations are all invisible to this viewer). A manager who must oversee a restricted space needs view access granted in Confluence — the dashboard note in the UX doc should say so. Role membership alone never reveals content.

`asApp()` REST usage is thus limited to: (a) the **other-user cannot-view checks** — `POST /wiki/rest/api/content/{id}/permission/check` (v1 API, not deprecated; scope `read:content.permission:confluence`) with `{subject: {type: "user", identifier: accountId}, operation: "read"}` → `{hasPermission}` — run only for pages that already passed the viewer-visibility filter; and (b) the deleted-vs-restricted existence probe above. Live-measured ~150–250 ms per permission check: per-user fan-out on drill-down must run concurrently (batches of ~10) and cache per (page, user) within an invocation; a full 100-user drill-down is ~2–3 s, not 20 s sequential. **Unknown/deleted accountId returns HTTP 404** (`NotFoundException`), not `hasPermission: false` — map 404 to the deleted-user rendering, never crash the row.

## 5. Storage design

Use **Forge KVS custom entities** (not plain KV) — the dashboard and export require queries by page, by user, and by status, which need declared indexes. **Forge SQL is GA** (usage billed per GB-hour since Jan 2026) and would also cover these query shapes; KVS custom entities remain the default (no relational needs, simpler ops, free quota) — revisit only if the index limits below bite.

Entities and indexes are specified in the [data model spec](./03_read_confirm_data_model.md). Key platform constraints the design must respect (verified against Forge docs, Jul 2026):

- Limits: value size **240 KiB**, key length 500 chars; max **20 entities per app**, **7 custom indexes** and 50 attributes per entity → our 4 entities with 1–2 indexes each fit comfortably. Assignments stored as lists capped with overflow to linked records if a page has >~1k direct user assignments (groups are the recommended path and are stored by reference).
- Query pagination via cursors; **default 10, max 100 results per query page** → all list resolvers accept/return cursors; the dashboard index entity keeps per-page aggregate counters so the global view never fans out across confirmation records.
- **Aggregate counters:** `config` entity stores a denormalized `confirmedCurrentVersion` count. KVS supports **transactions** via `@forge/kvs` (max 25 operations / 4 MB per transaction) — the confirm resolver writes the confirmation record and bumps the counter atomically in one transaction. Counters remain *advisory* for the dashboard list as defense-in-depth: the drill-down and CSV export always compute truth from records, and a mismatch self-heals on drill-down load, which rewrites the counter.

## 6. Correctness-critical behaviors

### 6.1 Idempotent confirm
Record key is deterministic: `confirm#{pageId}#{accountId}#{version}`. `confirm` resolver does read-then-write on that key; a repeat click returns the existing record (`created: false`). Races between double-clicks converge on the same key — last write is byte-identical, so no corruption is possible. Unit-tested in domain layer.

### 6.2 Version-aware status (Epic D groundwork in v1)
Status is **always computed, never stored**: `confirmed | expired | outstanding | cannot-view`, derived from (record.version, page.currentVersion, config.reconfirmOnChange). v1 ships the computation with `reconfirmOnChange` forced to "off" default; v1.1 only flips the setting UI on and adds the page-updated trigger for *notification* purposes — correctness never depends on the trigger firing (events can be missed; computation from versions cannot).

### 6.3 Page version source of truth
The macro receives the rendered page version from context; `confirm` stores what the **server** reads at write time (`GET page` current version), not what the client sends. If they differ (page updated mid-read), resolver returns `pageChanged: true` and the UI re-renders the new version's content prompt instead of recording. This closes the "confirmed a version they weren't reading" audit hole.

### 6.4 Deleted content resolution
Page existence is resolved **lazily** wherever a page is rendered or exported: a 404 (trashed or purged) yields the `page-deleted` state — row shows `[deleted page {id}]`, excluded from % complete and reminders, records untouched (data model §3.1). No delete-event handler mutates state: Confluence trash is restorable, so a restored page resumes tracking with zero writes. v1.1's `avi:confluence:deleted:page` trigger only appends a `configAudit` entry for the History tab.

## 7. Scopes & permissions

| Scope | Why |
|---|---|
| `storage:app` | KVS entities |
| `read:page:confluence` | page version + title resolution (v2 pages API) |
| `read:user:confluence` | display names at render time (granular scope — classic equivalent is `read:confluence-user`; prefer granular) |
| `read:group:confluence` | group membership resolution for assignments |
| `read:content.permission:confluence` | "can user X view page P" checks for cannot-view flagging (content permission check API) |

No `write:*` Confluence scopes in v1 (app never mutates content). No external egress. **Runs on Atlassian (spike M0-7 finding):** a `webtrigger` module alone disqualifies an app from the RoA program ("can egress data") — the product app must **never** declare one, including for ops/debugging; verify with `forge eligibility` in CI before each release. **Resolved (spike M0-4):** the v1.1 reminder channel is comment-based @mentions, which adds `write:comment:confluence` in v1.1 — the only write scope, limited to the app's own reminder comments; the security statement and scope-snapshot test (§10) must be updated in the same PR. No egress in any version.

## 8. Error handling & observability

- All resolvers return typed `{ok: true, data} | {ok: false, code, message}`; frontend maps codes to Atlaskit flags/section messages (see UX doc §5).
- Storage failures on `confirm` surface as retryable errors; the button re-enables (PRD A2).
- Logging: `console.log` structured JSON (Forge log conventions), no PII in logs (account IDs allowed, display names not). Use Forge's metrics/log tail during development; document `forge logs` workflow for support.

## 9. Performance budget (from PRD §4.5)

| Path | Budget | Design lever |
|---|---|---|
| Macro first render | < 2s | single `getPageStatus` invoke; byline shares cached response via `view` context where possible |
| Dashboard first paint | < 4s @ 500 pages | `index` entity + counters; no record fan-out |
| CSV export 10k records | no timeout | cursor-chunked resolver, client assembly |

## 10. Build & CI

- `forge lint` + `tsc --noEmit` + ESLint + Vitest in CI (GitHub Actions); CI builds the static app (`npm run build` in `static/app` — `forge deploy` uploads `static/app/build`, it does not build it); deploy to a staging Forge environment on main merge, production deploy manual (`forge deploy -e production`).
- **Toolchain floor (spike M0-7):** Forge CLI **≥ 13** (the multi-entry `entry` property fails lint on 12.x) and **Node 22 or 24** (CLI 13 crashes on Node 20). Forge's bundler compiles backend TS with its own ts-loader — `moduleResolution` must be `node`/`node16`, not `Bundler`. Pin both in CI and `.nvmrc`.
- Environments: `development` (per-dev), `staging`, `production` — Forge native environments.
- Snapshot the manifest scopes in a test — a PR that changes scopes must consciously update the snapshot (scope creep guard, ties to security statement).

## 11. Spike checklist (M0 exit — feeds back into this doc)

1. ~~Confirm KVS custom entity index shapes; measure query latency at 1k records~~ — **resolved** (spike app: `spikes/m0-kvs-latency`, deployed + measured on Forge, Jul 2026). Shapes validated with one addition: a third `confirmation` index `by-page-user` (partition `pageId, accountId`, range `pageVersion`) is required for the macro hot path — see data model §2.1. Warm latencies at 1k records: macro latest-version lookup ~50ms p50; 100-row query page ~100ms p50 (drill-down first paint, user history, tracked list all alike); full 1k-record drain via 10 sequential cursor pages ~1.0s → extrapolated ~10s for a 10k-record export, confirming the chunked-export design (§4) is necessary and sufficient. Platform findings: entity names must be lowercase (`page-config`, `config-audit`); index `range` holds exactly one attribute; `filters` on non-indexed attributes exist but are in-memory (may return empty pages — avoid for correctness-critical paths).
2. ~~`asUser` vs `asApp` split; validate the content permission check API~~ — **resolved** (spike M0-2, live-tested via `spikes/m0-kvs-latency` `permcheck` webtrigger): three-tier model now normative in §4. Key facts: bridge `requestConfluence` = current user (display-only use); `asUser()` = server-authoritative confirm path, but unavailable outside UI-invoked resolvers (reminders must be `asApp`); permission-check API validated `asApp` against a real site — `hasPermission` returned for real users, **404 for unknown accountIds**, ~150–250 ms/check → concurrent batching required for drill-down fan-out. Residual (verify during Epic B implementation): a real `hasPermission: false` case with a genuinely restricted page — the test site page had no restrictions. **Amended after review:** dashboard page resolution moved from `asApp` to bulk `asUser` so the dashboard/exports can never reveal pages the viewing manager can't access (visibility rule in §4) — `asApp` is confined to other-user permission checks and the deleted-vs-restricted probe.
3. ~~Exact scope names~~ — **resolved:** granular scopes verified against the Confluence scopes reference (§7).
4. ~~Reminder channel options without egress~~ — **resolved as a decision** (research Jul 2026; carries PRD §8.2). Facts: Forge has **no notification-send or email-send API** (changelog checked Jul 2026; FRGE-275 is the protected email *address read* API — sending would need an external mail provider = egress, rejected as it kills the no-egress security statement). Confluence Cloud REST has no arbitrary-notification endpoint; Forge realtime/flags reach only users currently in Confluence. **Decision — two tiers for v1.1:**
   - **Push (default-on, admin-toggleable):** the daily scheduled job posts **one footer comment per page** @mentioning that page's outstanding assignees (storage-format `<ri:user ri:account-id>` mention) — Confluence itself then delivers bell + email natively. Zero egress. Throttled to one comment per page per cadence; the job deletes the app's previous reminder comment before posting so pages accumulate at most one. Cost: v1.1 adds `write:comment:confluence` (+ delete of own comments) — the *first* write scope; §7 and the security statement must be updated consciously.
   - **Pull (always available, v1):** byline status chip, macro state, and dashboard outstanding lists.
   - **Live-test gate before building (v1.1 M0):** verify an `asApp()`-created comment whose body contains a mention actually triggers the mention notification (bell + email) and renders an acceptable author; if mentions from app-authored comments don't notify, fall back to pull-only in v1.1 and revisit when a Forge notification API ships.
5. ~~Declare-triggers-early decision~~ — **resolved: don't** (see §2). The spike's premise was wrong: module additions are minor versions (no admin consent); only permissions/licensing/providers/remotes/dynamic-webtriggers are major. The v1.1 `write:comment` scope is the sole consent event — handled with rolling releases + Permissions SDK gating so v1.1 code reaches all sites regardless of approval timing.
6. ~~Macro-in-editor UX~~ — **resolved** (spike M0-6, probe verified in the live editor Jul 3, 2026: config modal rendered our Custom UI, `invoke()` returned from the resolver **with the acting user's accountId and the draft contentId in server-side context**, `view.submit`/`view.close` behaved, existing config read back correctly). Macro `config` supports **full Custom UI** (`config.resource`, `viewportSize` up to fullscreen/resizable, `openOnInsert`) — so Atlaskit user/group pickers fit in the native config modal and UX doc §3.1's flow stands. **Architecture rule that falls out (normative):** macro config parameters live in the page ADF — assignments must **never** be stored there. (a) The dashboard's `saveConfig` (compliance managers, §4) can't write ADF without a write scope — would break the v1 no-write posture; (b) page version restore would silently roll back assignments past `configAudit`; (c) anyone with page edit could tamper via raw content. Therefore the config modal's Save calls `invoke('saveConfig')` → KVS `page-config` + `config-audit`, then `view.submit({config: {}})` purely to close/insert; the macro always renders from KVS by pageId. The fallback (bridge Modal from the macro body) is no longer needed but stays documented in UX doc §3.1 in case the Preview-era behavior regresses. Residuals for M1: user/group *search* endpoint + scope for the pickers; behavior when a config is saved on a never-published draft (lazy resolution already degrades it like a deleted page until first publish).
7. ~~Resource `entry` property~~ — **resolved: adopted** (spike M0-7, live-validated Jul 2026 via `spikes/m0-kvs-latency` v3.1.0). Still Preview, but Atlassian's `forge module add` scaffolds multi-entry by default; macro + globalPage + globalSettings deployed successfully against a multi-entry resource on Confluence (contentBylineItem lint-validated only — a dev byline would render on every page of the test site). §2/§3 rewritten around one `static/app` Vite MPA build. Gotchas captured in §3 (root-level full-HTML entries, `globalPage` needs `route`) and §10 (CLI ≥ 13 + Node 22/24). Side-findings: module additions confirmed minor-version in practice (3.0.0 → 3.1.0, no re-consent — corroborates M0-5); `webtrigger` modules break Runs on Atlassian eligibility (§7). Residual for M1: visual render check of each surface once real UIs exist; re-check `entry` GA status at marketplace submission.
