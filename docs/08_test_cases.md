# Test Cases 1.0.0 — Read Confirmation (Acknowledge for Confluence)

> Format matches the company Test Cases sheet: personas first, then Given/When/Then acceptance
> cases with a Status column. These are **acceptance/manual + integration** cases; the exhaustive
> pure-logic assertions live in Jest unit tests (`docs/05` §2, `docs/07` §7). Sonnet: extend the
> tables per feature as surfaces are built; move `Status` from **Not run** → **PASS/FAIL** with a
> note on failure (as in the reference sheet).

## Personas & fixtures

| Name | Description |
|---|---|
| **Admin A** — site/space admin (the tester) | Confluence admin; opens dashboard, settings, exports. |
| **Admin B** — second admin | For multi-admin / role-visibility checks. |
| **Manager C** — compliance manager, **not** a Confluence admin | Member of the compliance-managers group set in settings; reaches the dashboard but **not** settings. |
| **User N** — normal licensed user, assigned | Assigned to a page; not an admin. Can view the page. |
| **User M** — assigned **via group** only | Member of group `sec-all`; has no direct assignment entry. |
| **User R** — assigned but **restricted** | Assigned to page P but lacks Confluence view permission on P (drives `cannot-view`). |
| **User V** — unassigned viewer | Not assigned; can view the page (drives voluntary state). |
| group **`sec-all`** | User M is a member; User N is not. Used for group-assignment cases. |
| Page **P** (tracked), Page **Q** (restricted from Manager C), Page **T** (trashed) | |

---

## A — Access & role gating

| ID | User Story | Given (state) | When (action) | Then (expectation) | Status |
|---|---|---|---|---|---|
| TC-A1 | Admin sees the dashboard | Logged in as **Admin A** | Open Apps → **Read confirmations** | Dashboard loads, title "Read confirmations"; list renders from tracked index; first paint < 4s @ 500 pages. | Not run |
| TC-A2 | Compliance manager reaches dashboard, not settings | Logged in as **Manager C** (in managers group, not admin) | Open the app; then attempt settings | Dashboard opens; **Settings is blocked** with EmptyState, no data leak. | Not run |
| TC-A3 | Non-privileged user blocked | Logged in as **User N** (no admin, not in managers group) | Open the dashboard global page | EmptyState **"You need compliance-manager access"**; no rows, no counts, no page titles in payload. | Not run |
| TC-A4 | Settings is admin-only | Logged in as **Manager C** | Call `getSettings`/`saveSettings` directly (forged invoke) | Typed error, no settings data returned. | Not run |

## B — Reader macro states (docs/04 §2.1)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-B1 | Required state | **User N** assigned to P, no record | Open P | **R1** "Read confirmation required" + confirm button; due date shown if set. | Not run |
| TC-B2 | Confirm happy path (pessimistic) | R1 as **User N** | Click "I have read and understood this page" | **R2** spinner (no optimistic flip) → server writes → **R3** "Confirmed version {v} on {local time}". | Not run |
| TC-B3 | Voluntary state | **User V** unassigned, can view P | Open P | **R5** voluntary wording (no "required"); confirming records `assignmentType=voluntary`. | Not run |
| TC-B4 | Retryable error | R1 as **User N**, storage write forced to fail | Click confirm | **R6** error SectionMessage, button re-enabled, **never** shows confirmed. | Not run |
| TC-B5 | Page changed mid-read | User reading P v7; page republished to v8 before click | Click confirm | Resolver returns `pageChanged`; **R7** "page was just updated, review latest"; **no record written**. | Not run |
| TC-B6 | Multiple macros on one page | Two macros on P | Open P | First active, others render inert warning (no double records). | Not run |

## C — Confirm integrity (server-authoritative, idempotent)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-C1 | Server sets version, not client | **User N** on P (server v7) | Confirm with a **forged** client payload claiming v3 | Record stores **v7** (server read), not v3; audit hole closed. | Not run |
| TC-C2 | Idempotent double-click | **User N** confirms P v7 twice | Two rapid confirms | **One** record; 2nd call `created:false`, byte-identical. | Not run |
| TC-C3 | New version = new record | **User N** confirmed v7; page now v8, reconfirm on | Confirm v8 | New record for v8; **v7 record untouched** (append-only). | Not run |
| TC-C4 | View permission enforced server-side | **User R** (cannot view P) | Attempt `confirm` on P | 404-equivalent; nothing recorded; no page content leaks. | Not run |

## D — Dashboard, drill-down, visibility rule (docs/02 §4)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-D1 | Visibility rule hides restricted pages | **Manager C** cannot view page **Q** (tracked) | Open dashboard | **Q is omitted entirely** — no row, title, or counts. Manager sees no trace. | Not run |
| TC-D2 | Deleted page degrades, no writes | Page **T** trashed | Open dashboard | Row shows `[deleted page {id}]`, excluded from % and chase lists; **zero writes**; drill-down/export still available. | Not run |
| TC-D3 | Restore resumes tracking | **T** restored from trash | Reopen dashboard | Row returns to normal statuses; **zero writes** on restore. | Not run |
| TC-D4 | Group membership resolved at read time | **User M** in `sec-all` (assigned via group) | Open drill-down for P | User M appears in Outstanding "assigned via group: sec-all"; removing M from `sec-all` drops them next load. | Not run |
| TC-D5 | Cannot-view surfaced separately | **User R** assigned, cannot view P | Open drill-down | User R in **Cannot view** tab with fix hint; **never** counted as outstanding; excluded from % denominator. | Not run |
| TC-D6 | Drill-down performance | P has 100 assignees | Open drill-down | Permission checks batched ~10 concurrent; loads in seconds, not ~20s; deleted accountId → `[deleted user]`, row not crashed. | Not run |
| TC-D7 | Voluntary-only page | P has 0 assigned, some voluntary records | Dashboard row | % shows **"—"** with tooltip, not 0%. | Not run |
| TC-D8 | History tab | Config changed twice on P | Open History | config-audit rows: who assigned/removed/changed due date, when. | Not run |

## E — Assignment config (UI Kit Modal, never ADF — docs/07 §4.3)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-E1 | Assign via modal, no ADF | **Admin A** editing P | Open "Configure read confirmation", pick User N + group `sec-all`, Save | `saveConfig` writes KVS + config-audit; **page ADF unchanged** (inspect storage format). | Not run |
| TC-E2 | Survives version restore | P configured, then restored to an older version | Reopen P | Assignment still present (KVS, not ADF); config-audit intact. | Not run |
| TC-E3 | Empty assignment ⇒ voluntary | Config with no users/groups | Save | Voluntary-only notice; all viewers see R5. | Not run |
| TC-E4 | Group nudge past 50 direct users | 51 direct users added | In modal | Hint to prefer groups (data model §2.2). | Not run |

## F — Export (webtrigger, visibility-safe — docs/07 §5)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-F1 | CSV export happy path | **Admin A**, scope = site | Export dialog → CSV | File downloads; UTF-8 BOM; exact column order (docs/03 §4); outstanding rows have empty confirmation fields; opens in Excel (Turkish locale). | Not run |
| TC-F2 | Row-count law | Seeded: X assigned across pages + Y voluntary | Export | Row count = assigned×pages(in scope) + voluntary records. | Not run |
| TC-F3 | PDF parity | Same scope as TC-F1 | Export → PDF | PDF parses; **same records/statuses/timestamps** as the CSV; report header (scope, exported_at_utc, app version); Turkish chars intact. | Not run |
| TC-F4 | Export honors visibility | **Manager C** cannot view **Q** | Export site scope | **Q not in file** (visibility filtered under asUser before the webtrigger runs). | Not run |
| TC-F5 | Webtrigger rejects no/invalid secret | Export URL captured | GET without `k` / wrong `k` | **403**, no data. | Not run |
| TC-F6 | One-time / TTL token | Valid export URL used once | Reuse same URL / use after TTL | **410 Gone**; job deleted after first serve. | Not run |
| TC-F7 | 10k records, no timeout | Seeded 10k confirmations | Export | Completes without invocation timeout; single header; ordered. | Not run |

## G — Deleted content, users, immutability (docs/03 §7)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-G1 | Records immutable on unassign | User N assigned then removed | Remove assignment | User N drops from %; **confirmation record still exportable** (invariant 1). | Not run |
| TC-G2 | Deactivated/erased user rendering | Confirmed record whose account was closed | Export / drill-down | `[deactivated]` / `[deleted user]`; record retained (compliance interest). | Not run |
| TC-G3 | No delete/update on audit entities | — | Static CI check | No code imports update/delete against `confirmation`/`config-audit`. | Not run |

## H — Platform / release guards (docs/07 §6, §9)

| ID | User Story | Given | When | Then | Status |
|---|---|---|---|---|---|
| TC-H1 | Scope snapshot | PR adds a scope | CI | Scope-snapshot test **fails** until snapshot consciously updated. | Not run |
| TC-H2 | Single-webtrigger guard | PR adds a second webtrigger | CI | Test **fails** ("exactly one export webtrigger"). | Not run |
| TC-H3 | Install scope prompt matches statement | Fresh install on dev site | Install | Prompted scopes == the five in docs/07 §6 == security statement. | Not run |
| TC-H4 | Uninstall→reinstall | App reinstalled on dev site | Reopen macro | Fresh setup state, no crash; empty storage (28-day soft delete noted). | Not run |
| TC-H5 | Free-tier boundary (v1) | Marketplace listing pricing tab | Set the 1–10 user tier price | $0 price configured for the 1–10 tier in the Partner Portal; **not app code** — Atlassian bills by the site's licensed tier, app behaves identically at every tier (corrected T15, was wrongly scoped as a code-path test; `docs/01` §5). Manual listing-config check, not a Jest test. | Not run |
```
