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
      resource: macro-ui
      resolver: { function: resolver }
      title: Read confirmation
  confluence:contentBylineItem:
    - key: acknowledge-byline         # Epic A3 — per-user status
      resource: byline-ui
      resolver: { function: resolver }
  confluence:globalPage:
    - key: acknowledge-dashboard      # Epic C — admin dashboard
      resource: dashboard-ui
      resolver: { function: resolver }
  confluence:globalSettings:
    - key: acknowledge-settings       # Epic G — app settings [SPIKE: module choice]
      resource: settings-ui
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
resources:                              # each path must contain a built index.html
  - { key: macro-ui,     path: static/macro/build }
  - { key: byline-ui,    path: static/byline/build }
  - { key: dashboard-ui, path: static/dashboard/build }
  - { key: settings-ui,  path: static/settings/build }
```

- **Custom UI (not UI Kit)** for all four surfaces (macro, byline, dashboard, settings), per PRD §4.1. Each surface is its own `resources` entry pointing at a built static app (see §3); shared React + Atlaskit code lives in a workspace package.
- v1 ships without `trigger`/`scheduledTrigger` wired to behavior; add in v1.1. Decide **[SPIKE]** whether to declare them in the v1 manifest anyway (scope-change on upgrade forces admin re-consent — avoid churn by declaring early if cost is acceptable).

## 3. Frontend design

- **Stack:** React 18, TypeScript strict, `@atlaskit/*` components, `@forge/bridge` for `invoke()`, `view.getContext()` for page/user context.
- **Repo layout** — follows the Forge Custom UI convention: top-level `src/` is **backend-only** (bundled by Forge); every Custom UI surface is a standalone static app under `static/<name>/` with its **own `package.json`**, built into `static/<name>/build/`, which is what the manifest `resources.path` points to (must contain `index.html`):
  ```
  manifest.yml
  package.json        # backend deps: @forge/api, @forge/resolver; npm workspaces root
  src/                # Forge FaaS backend only
    resolvers/        # thin request handlers
    domain/           # pure logic — no Forge imports
    storage/          # KVS entity access, pagination helpers
    events/           # trigger handlers (v1.1)
  static/
    macro/            # confirmation block — standalone React app
      src/  public/index.html  package.json  build/   # build/ = resource path
    byline/           # status chip            (same inner structure)
    dashboard/        # admin table + drill-down + export
    settings/
  packages/
    shared/           # workspace package: Atlaskit wrappers, hooks (useInvoke), shared types
  ```
- **Code sharing across the four static apps:** npm workspaces; `packages/shared` is a local package consumed by all four static apps *and* by `src/` (typed invoke contract). Kept outside `static/` so it can never be mistaken for a deployable resource. **[SPIKE]** alternative: a single static app with multiple named entry points via the resource `entry` property (up to 50 entries per resource — currently Preview) would collapse four builds into one; default remains separate apps (GA-only, conservative).
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

**Authorization:** every resolver re-checks permissions server-side (`route`-level trust is zero): user context from Forge, page view permission via Confluence REST (`GET /wiki/api/v2/pages/{id}` as the acting user under `asUser()` where possible **[SPIKE]**: confirm `asUser` vs `asApp` split — confirms must be `asUser`-verifiable; dashboard reads need `asApp` + explicit role check against admin/compliance-manager group). Checking view permission for *other* users (the dashboard's cannot-view flag) uses the content permission check API (`POST /wiki/rest/api/content/{id}/permission/check`, scope `read:content.permission:confluence`) under `asApp()`.

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

No `write:*` Confluence scopes in v1 (app never mutates content). No external egress. Reminder channel (v1.1) may add a notification scope — spike question carried from PRD §8.2.

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

- `forge lint` + `tsc --noEmit` + ESLint + Vitest in CI (GitHub Actions); CI builds each static app (`npm run build` per workspace — `forge deploy` uploads the `static/*/build` directories, it does not build them); deploy to a staging Forge environment on main merge, production deploy manual (`forge deploy -e production`).
- Environments: `development` (per-dev), `staging`, `production` — Forge native environments.
- Snapshot the manifest scopes in a test — a PR that changes scopes must consciously update the snapshot (scope creep guard, ties to security statement).

## 11. Spike checklist (M0 exit — feeds back into this doc)

1. Confirm KVS custom entity index shapes cover the three query patterns (by-page, by-user, tracked-pages list); measure query latency at 1k records. (Forge SQL is GA — only revisit if KVS index limits bite.)
2. `asUser` vs `asApp` split per §4; validate the content permission check API for other-user checks.
3. ~~Exact scope names~~ — **resolved:** granular scopes verified against the Confluence scopes reference (§7).
4. Reminder channel options without egress (carries PRD §8.2).
5. Declare-triggers-early decision (§2).
6. Macro-in-editor UX: config panel capabilities for user/group pickers **[SPIKE]** — if macro config can't host Atlaskit pickers well, move assignment editing fully to the dashboard drill-down.
7. Resource `entry` property (multiple named entry points per resource, Preview) — evaluate collapsing the four static apps into one build (§3); check GA status and Confluence module support.
