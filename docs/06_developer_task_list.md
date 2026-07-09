# Developer Task List: Read Confirmation App (v1)

> **Status:** Ready for Jira import · July 2026
> **Source:** [PRD](./01_read_confirm_prd.md) §6 release plan · [Tech design](./02_read_confirm_tech_design.md) · [Data model](./03_read_confirm_data_model.md) · [UX flows](./04_read_confirm_ux_flows.md) · [Test plan](./05_read_confirm_test_plan.md)
> **Jira import:** [jira-import.csv](./jira-import.csv) — 3 epics + 15 tasks, descriptions and dependencies included.
> Estimates are rough person-days for one mid-level developer (PRD budget: 6–8 weeks to v1).
> v1.1 epics (re-confirmation, reminders) are deliberately excluded — post-launch per the release plan.

**Read before starting any task:** tech design §11 (all spike findings — the platform constraints in there are load-bearing), mockups/index.html (the visual + copy reference), and the UX doc §6 copy rules.

**Global definition of done** (applies to every task): TypeScript strict passes; unit tests for domain logic; `forge lint` clean; all UI via Atlaskit with design tokens (no hardcoded colors); every user-visible string in `packages/shared/i18n` (en + tr); works in light and dark theme; deployed to the `development` environment and exercised on a real page.

---

## Epic M1 — Core loop (target: wk 2–4)

**Exit criteria (PRD §6):** a user can be assigned, confirm, and the record is queryable.

### T1 · Scaffold Forge app skeleton — 3d
Manifest per tech design §2: macro / contentBylineItem / globalPage / globalSettings on **one multi-entry resource** (`static/app/build`; entries macro, byline, dashboard, settings, config); scopes exactly per §7; **no webtrigger modules ever** (kills Runs on Atlassian — §7). npm workspaces per §3 (src/ backend, static/app Vite MPA, packages/shared). CI per §10: forge lint, tsc, ESLint, Vitest, per-workspace builds; staging deploy on main merge. Toolchain: Forge CLI ≥ 13, Node 22 (.nvmrc), backend tsconfig moduleResolution `node`.
**Accept:** `forge deploy -e development` succeeds; all four surfaces render a hello page on the dev site; CI green on a PR.

### T2 · Storage layer: KVS entities + idempotent confirm — 3d *(depends: T1)*
Entities/indexes exactly per data model §2 manifest YAML (validated on Forge — don't improvise names: lowercase only). Typed access module + cursor pagination helpers (§5 query code). Deterministic key `confirm#{pageId}#{accountId}#{version}`; read-then-write idempotent confirm; counter bump in the same `@forge/kvs` transaction (max 25 ops). No code path may update/delete `confirmation` or `config-audit` records (data model §7.1).
**Accept:** unit tests prove idempotency (repeat confirm → `created:false`, byte-identical record) and append-only invariants; indexes report ACTIVE after deploy.

### T3 · Domain layer: status computation — 2d *(depends: T1)*
Pure TS, zero Forge imports (§1 layering rule). Status per data model §3 normative algorithm (confirmed / expired / outstanding / cannot-view; page-deleted at page level); % complete rules; voluntary exclusion; `reconfirmOnChange` computed from versions, never from events (§6.2).
**Accept:** exhaustive unit tests incl. data model §7 invariants (pure function, no clock reads inside, same input → same output).

### T4 · Core resolvers with three-tier authorization — 4d *(depends: T2, T3)*
`getPageStatus` (one round-trip renders macro + byline, §9 budget <2s), `confirm` (asUser page read = permission proof + server-authoritative version; `pageChanged` response per §6.3; retryable error envelope §8), `getConfig`/`saveConfig` (gate: page edit permission OR compliance manager; every change appends a `config-audit` entry). Authorization tiers per §4 — asUser for viewer-scoped reads, asApp **only** for other-user permission checks (validated call + 404 semantics in §4) and the deleted-vs-restricted probe. Typed `{ok,data}|{ok,code,message}` envelope in packages/shared.
**Accept:** confirm from a devtools-forged payload cannot record a wrong version; user without page view permission gets 404-equivalent, nothing leaks; test plan resolver cases pass.

### T5 · Shared i18n (en/tr) + theming — 2d *(depends: T1)*
Lift catalogs from `mockups/index.html` MESSAGES into `packages/shared/i18n/{en,tr}.ts`; react-intl provider on all surfaces; locale from Confluence context; `setGlobalTheme` following Confluence theme. Confirm button copy is exact and never shortened (UX §6).
**Accept:** switching Confluence language/theme switches all surfaces; no literal strings in components (lint rule or review checklist).

### T6 · Macro UI: reader states R1–R7 — 3d *(depends: T4, T5)*
Per UX §2.1 + mockups: R1 required, R2 confirming (pessimistic — never optimistic confirmed state), R3 confirmed (local tz), R5 voluntary, R6 retryable error, R7 page-changed-mid-read (reload prompt); R4 ships behind v1.1 flag. `aria-live` on transitions; keyboard reachable. Multi-macro on one page: first active, others inert warning (UX §5).
**Accept:** all states demo-able on dev site; R2→R3 only after server ack; a forced storage failure shows R6 with re-enabled button (test plan reader cases).

### T7 · Assignment config modal — 4d *(depends: T4, T5)*
Custom UI macro config (`config.resource`, `openOnInsert`, viewport large — validated M0-6). `@atlaskit/user-picker` + group picker wired to Confluence user/group search (resolve endpoint + scope first — §11.6 residual). Save = `invoke('saveConfig')` → KVS, then `view.submit({config:{}})` **only to close** — assignment data never enters page ADF (§11.6 rule). Empty assignment → voluntary-mode notice. Due date / reconfirm rendered with v1.1 lozenge, disabled.
**Accept:** assignment survives page version restore; same config editable from dashboard later (T10); group-recommendation hint shown past 50 direct users (data model §2.2).

### T8 · Byline item: chip + dialog — 2d *(depends: T6)*
Per UX §2.2: `dynamicProperties` chip (required / confirmed {date} / expired), hidden for uninvolved viewers, dialog reuses macro status/confirm components, chip refreshes after dialog close.
**Accept:** chip states correct for assigned/confirmed/voluntary/uninvolved users; confirm from dialog writes the same record as the macro.

## Epic M2 — Admin & export (target: wk 4–6)

**Exit criteria (PRD §6):** dashboard + CSV and PDF export pass acceptance criteria.

### T9 · Dashboard global page — 4d *(depends: T4, T5)*
Per UX §3.2 + mockups: list from `tracked` index + advisory counters (never fan out across records — §5); space/status filters; cursor "Load more"; progress bars; overdue markers; voluntary "—" with tooltip; deleted rows `[deleted page {id}]` excluded from %; first-run empty state; no-access EmptyState. **Visibility rule (§4, normative):** bulk asUser page resolution filters rows; asApp probe separates deleted (shown, no title) from viewer-restricted (omitted entirely). Role gate: admin or compliance-managers group.
**Accept:** first paint < 4s @ 500 tracked pages (§9); a manager without space permission sees no trace of that space's pages; deleted page row degrades per data model §3.1 with zero writes.

### T10 · Drill-down: tabs, cannot-view, history — 4d *(depends: T9)*
Per UX §3.3: five tabs with counts; group membership resolved at call time (PRD B1); deleted-group badge; cannot-view via permission-check **batched at concurrency ~10** with per-invocation cache and 404 → deleted-user mapping (§4 — sequential would be ~20s/100 users); counter self-heal on load (§5); History tab from `config-audit`. Includes the deferred §11.2 verification: a genuinely restricted page must produce `hasPermission:false`.
**Accept:** 100-user drill-down loads in seconds, not tens of seconds; cannot-view users surface separately, never counted outstanding (PRD B1); history answers "who was required since when".

### T11 · Chunked CSV export — 3d *(depends: T9)*
Data model §4 is normative: UTF-8 BOM, RFC 4180, exact column order, outstanding rows included, `[deleted page {id}]` rows included, viewer-visibility rule applied. Cursor-chunked resolver (measured ~10s for 10k records — must span invocations), client assembly + download, export dialog per UX §3.4 (scope, date range, status filter, progress).
**Accept:** 10k-record export completes without invocation timeout; file passes test plan's export fixture (row count = assigned×pages + voluntary; empty confirmation fields for outstanding).

### T12 · PDF export (client-side) — 2d *(depends: T11)*
Same chunked dataset as CSV — no separate resolver (§4); adds report header (scope, exported_at_utc, app version); bundled PDF lib (no CDN — egress-free must hold).
**Accept:** PDF and CSV of the same scope contain identical records/statuses/timestamps (test plan cross-check); renders sensibly at 1k rows.

### T13 · Settings page — 2d *(depends: T4, T5, T11)*
Per UX §3.5: compliance-managers group picker, defaults (reconfirm off in v1), Export-all-data (reuses T11 pipeline, site scope), data-lifecycle warning (28-day soft delete / 21-day recovery — exact i18n copy). Admin-only gate on `getSettings`/`saveSettings`.
**Accept:** non-admin in managers group reaches dashboard but not settings; export-all yields the full-site CSV.

## Epic M3 — Marketplace listing (target: wk 6–8)

**Exit criteria (PRD §6):** Marketplace submission.

### T14 · CI release guards — 1d *(depends: T1)*
Scope snapshot test (a PR changing manifest scopes must consciously update the snapshot — §10); `forge eligibility` in CI failing the build if Runs on Atlassian eligibility is lost (§7); document staging→production deploy procedure.
**Accept:** adding a scope or webtrigger in a test branch fails CI with a clear message.

### T15 · Marketplace listing preparation — 5d *(depends: T10, T11, T12, T13, T14)*
Security statement (no egress, no write scopes, storage:app only — **not** Runs on Atlassian,
dropped per T14/docs/07 §6); privacy policy per data model §5 (accountId retention as compliance
evidence, `[deleted user]` rendering, uninstall retention, residency); listing assets (screenshots
of the real app, EN copy); **resolve the pricing blocker** (PRD §5: captured QC / Comala /
MiddleCore tiers + a recommendation; Forge consumption-cost projection per install still open);
submit.
**Accept:** listing passes Atlassian review checklist; pricing decision recorded in PRD §5.
**Corrected (T15, Jul 2026):** the free ≤10-users boundary is **not** an in-app code path —
Atlassian Marketplace bills by the host product's licensed user-tier band, with vendors setting a
genuine $0 price for the 1–10 tier in the Partner Portal; the app runs identically at every tier.
An in-app user-count gate would be actively wrong (tier-lock bills a site at its full Confluence
license tier regardless of how many users touch this app). See `docs/01` §5 and `docs/08` TC-H5.

---

## Dependency graph

```
T1 ─┬─ T2 ─┬─ T4 ─┬─ T6 ── T8
    ├─ T3 ─┘      ├─ T7
    ├─ T5 ────────┤
    │             ├─ T9 ─┬─ T10 ──┐
    │             │      └─ T11 ─┬─ T12 ─┤
    │             └─ T13 ◄───────┘       ├─ T15
    └─ T14 ──────────────────────────────┘
```

Parallelizable pairs for a second developer: T2∥T3∥T5, T6∥T7, T9∥(T6–T8), T10∥T11.
