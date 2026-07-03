# Test Plan: Read Confirmation App

> **Status:** Draft v0.1 · July 2026
> **Source:** [PRD](./01_read_confirm_prd.md) §4.1 · [Tech design](./02_read_confirm_tech_design.md) · [Data model](./03_read_confirm_data_model.md) §7
> Company standard: every app ships with test infrastructure (unit + integration) wired into CI.

---

## 1. Strategy

The app's value is **trustworthy records**. Test effort is weighted accordingly:

| Layer | Tooling | Weight | What it protects |
|---|---|---|---|
| Unit — domain layer | Vitest, pure TS, no mocks | ~60% of tests | status computation, expiry, idempotency, CSV formatting — the audit-grade logic |
| Integration — resolvers + storage | Vitest + in-memory KVS fake | ~30% | permission checks, invoke contracts, pagination, counters |
| E2E / manual — dev site | scripted checklist per release | ~10% | Forge platform reality: macro rendering, scopes, real Confluence events |

Rationale: Forge has no headless product environment for cheap E2E, so the architecture (tech design §1 layering rule) pushes all correctness-critical logic into the pure domain layer where it's exhaustively testable, and keeps the platform-touching surface thin and checklist-verified.

## 2. Unit tests — domain layer (Vitest)

### 2.1 Status computation (data model §3) — the highest-value suite

Table-driven over (records, currentVersion, reconfirmOnChange, permission):

- no records → `outstanding`
- record @ current version → `confirmed`
- record @ older version, reconfirm **off** → `confirmed`
- record @ older version, reconfirm **on** → `expired`
- multiple records → latest version wins
- no view permission → `cannot-view` regardless of records
- page resolution 404 (trashed/purged) → `page-deleted`; excluded from % denominator; statuses resume when resolution succeeds again (restore) — no stored mutation either way (invariant 6)
- purity: no `Date.now()`/clock reads inside (data model invariant 4) — enforced by lint rule + test injecting fixed clock

### 2.2 Idempotent confirm (tech design §6.1)

- same (page, user, version) twice → single record, second call `created: false`, byte-identical
- different version → new record, old untouched
- key derivation is deterministic and collision-safe for IDs containing `#` (escape or reject)

### 2.3 % complete & counting (PRD C1, A4)

- voluntary confirmations excluded from % (PRD A4)
- `cannot-view` excluded from denominator (PRD B1)
- 0 assigned → "—" semantics, not 0% (UX §5)
- group + direct assignment overlap → user counted once

### 2.4 CSV generation (data model §4)

- exact header order; RFC 4180 quoting (names with commas, quotes, newlines); UTF-8 BOM present
- outstanding assignees emitted with empty confirmation fields (invariant 3)
- row count law: assigned×pages + voluntary records (invariant 3), property-tested with generated fixtures
- deleted page / deactivated / erased user placeholders (`[deleted page {id}]`, `[deactivated]`, `[deleted user]`)
- timestamps ISO 8601 UTC with `Z`
- PDF export (PRD F2): record parity with CSV of the same scope (same rows, statuses, timestamps); report header carries scope, `exported_at_utc`, app version

### 2.5 Assignment resolution

- group membership resolved at read time (fixture group changes between calls → outstanding set updates, PRD B1)
- removing assignment never removes records (invariant 1); user disappears from % but voluntary-style record still exportable
- deleted group → flagged, members dropped from denominator, configAudit entry

## 3. Integration tests — resolvers + storage fake

In-memory fake implementing the KVS custom-entity interface (get/put/query-with-cursor, transactions). The fake enforces platform limits (query page max 100 / default 10, 240 KiB value cap, 25 ops per transaction) so limit bugs surface in CI, not production.

### 3.1 Resolver authorization (tech design §4)

- `confirm` rejects users without page view permission (server-side check, not UI trust)
- `getDashboard` / `exportCsv` reject non-admin, non-compliance-manager callers with typed error, no data in payload
- `saveConfig` requires page edit permission or compliance-manager role

### 3.2 Confirm end-to-end (resolver → storage)

- happy path writes record with **server-read** page version and server clock (data model invariant 5), ignoring client-sent version
- version drift (client v5, server v7) → `pageChanged: true`, **no record written** (tech design §6.3)
- storage failure → typed retryable error, no partial state; retry succeeds

### 3.3 Immutability guard (data model invariant 1)

- storage layer exposes **no** update/delete for `confirmation` / `configAudit` types — compile-time (types) + runtime test asserting the methods don't exist
- static check in CI: grep/AST rule that no code imports a generic delete against those entity names

### 3.4 Pagination & scale

- dashboard resolver over 500 tracked pages → cursor chain complete, no duplicates/gaps
- export of 10k records via chunked cursors → complete, ordered, single header
- advisory counter drift: corrupt counter → drill-down load rewrites it (tech design §5 self-heal)

### 3.5 Config & audit trail

- every `saveConfig` writes a `configAudit` row with actor + diff
- soft-delete (`active: false`) removes page from dashboard index but keeps records exportable

### 3.6 Deleted content (lazy 404 handling — data model §3.1)

- dashboard/export with a page fixture returning 404 → row rendered `[deleted page {id}]`, excluded from % and outstanding, confirmation records untouched (invariant 1)
- fixture resolves again (trash restore) → row and statuses resume with zero writes (invariant 6)
- v1.1: `avi:confluence:deleted:page` event → `configAudit` entry appended, nothing else mutated

## 4. E2E / manual release checklist (Forge dev site)

Run on staging before every production deploy; keep as `docs/release-checklist.md` with checkboxes.

1. Insert macro on fresh page → R1 renders < 2s; confirm → R3 without reload; byline flips ✔
2. Second browser as unassigned user → R5 voluntary state; confirm → appears in Voluntary tab
3. Revoke page permission for an assigned user → shows in "Cannot view" tab
4. Dashboard filters (space, status), sort, Load more against seeded data
5. CSV export (page + site scope) opens correctly in Excel (Turkish locale machine: BOM/encoding check); PDF export renders correctly with Turkish characters and matches the CSV record count
6. Uninstall → reinstall on dev site → macro shows fresh-setup state, no crash (UX §5)
7. Scopes prompt at install matches security statement (scope snapshot — tech design §10)
8. Trash a tracked page → dashboard row shows `[deleted page {id}]`, excluded from chase lists; restore from trash → row returns to normal
9. v1.1 additions: publish page edit → R4 within one page load; scheduled reminder fires on dev cadence

## 5. CI pipeline (GitHub Actions)

```
PR:    lint (ESLint + i18n-string rule + clock-purity rule)
       → tsc --noEmit (strict)
       → vitest run --coverage (unit + integration)
       → manifest scope snapshot test
       → forge lint
main:  all of the above → forge deploy -e staging
prod:  manual gate → forge deploy -e production (checklist §4 signed off)
```

**Coverage gates:** domain layer **95%+ branches** (it's small and pure — near-total coverage is cheap and it's the audit-grade code); overall lines 80%. Gate fails the PR.

## 6. Test data & fixtures

- Fixture builders (`aPage()`, `aConfig().withGroups(...)`, `aConfirmation().atVersion(5)`) — no hand-rolled JSON in tests
- Deterministic seeded dataset generator for scale tests (500 pages / 10k records) reused by staging seeding script
- No real user data in fixtures; Turkish-character names in fixtures (`Ayşe`, `Gökhan`) to keep encoding honest

## 7. Non-functional verification

| Requirement (PRD §4.5) | How verified |
|---|---|
| Macro < 2s | manual timing on staging (checklist §4.1); single-invoke render enforced by integration test (one resolver call per mount) |
| Dashboard < 4s @ 500 pages | staging seeded run, timed |
| Export 10k, no timeout | integration test on chunk counts + staging run |
| A11y WCAG 2.1 AA | axe-core in Vitest against macro/dashboard DOM; keyboard-only pass in checklist |
| No PII in logs | log-call lint rule (display names banned from log args) |

## 8. Out of scope (v1 testing)

- Load testing beyond 10k records (revisit if a customer exceeds it)
- Automated browser E2E against real Confluence (evaluate Playwright + dev site post-launch — flaky-risk vs. value)
- Pen-testing (covered later by Marketplace security programs — Bug Bounty / Cloud Fortified path)
