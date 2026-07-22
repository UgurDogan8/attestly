# Data Model & Audit Record Spec: Read Confirmation App

> **Status:** Draft v0.1 · July 2026
> **Source:** [PRD](./01_read_confirm_prd.md) §4.4, §3 Epic F · [Tech design](./02_read_confirm_tech_design.md) §5–6
> This document is the authority on what data is stored, its immutability guarantees, and the export format. **The audit record is the product** — changes here need explicit review.

---

## 1. Design principles

1. **Append-only evidence.** A confirmation record, once written, is never updated or deleted by any code path (Forge app-uninstall data deletion aside). Expiry, revocation of assignment, or page deletion never touch existing records.
2. **Status is derived, never stored.** `confirmed / expired / outstanding / cannot-view` is computed at read time from records + page version + config. Stored state can't go stale or be tampered with.
3. **Store IDs, resolve names.** Persist Atlassian `accountId` and `pageId`; resolve display names and titles at render/export time. This keeps records GDPR-lean and immune to renames.
4. **Server-authoritative fields.** Timestamps and page versions are set by the resolver from server-side reads, never trusted from the client.

## 2. Entities (Forge KVS custom entities)

Manifest definition — exactly as validated on Forge in spike M0-1 (deployed, indexes reported `ACTIVE`; spike app since deleted, code in git history @ `f716064`):

```yaml
app:
  storage:
    entities:
      - name: confirmation            # entity names must be lowercase
        attributes:
          pageId:      { type: string }
          accountId:   { type: string }
          pageVersion: { type: integer }
          confirmedAt: { type: string }   # ISO 8601 UTC
          spaceKey:    { type: string }
          # + assignmentType, appVersion, schemaVersion (non-indexed, §2.1)
        indexes:
          - name: by-page
            partition: [pageId]
            range: [confirmedAt]
          - name: by-user
            partition: [accountId]
            range: [confirmedAt]
          - name: by-page-user          # macro hot path
            partition: [pageId, accountId]
            range: [pageVersion]
      - name: page-config
        attributes:
          pageId:   { type: string }
          active:   { type: boolean }
          spaceKey: { type: string }
          # + assignedUsers, assignedGroups, dueDate, … (non-indexed, §2.2)
        indexes:
          - name: tracked
            partition: [active]
            range: [spaceKey]
      # + settings (no index), config-audit (index by-page, range = timestamp)
```

### 2.1 `confirmation` — the audit record (immutable)

Key: `confirm#{pageId}#{accountId}#{pageVersion}` (deterministic → idempotent writes, see tech design §6.1)

> **Why no spaceId in the key:** `pageId` is globally unique, so space adds no identity — and pages can be *moved* between spaces keeping their `pageId`. Keys hold only immutable identity; mutable context (`spaceKey`) is a denormalized attribute. A spaceId-bearing key would compute differently after a move, breaking idempotent writes and direct lookups. Custom-entity queries go through indexes, not key prefixes, so the key gains nothing from extra segments.

| Field | Type | Notes |
|---|---|---|
| `pageId` | string | Confluence page ID |
| `spaceKey` | string | denormalized at write time (page may move later; we record where it was) |
| `pageVersion` | number | version **read server-side at confirm time** |
| `accountId` | string | Atlassian account ID |
| `confirmedAt` | string | ISO 8601 UTC, server clock |
| `assignmentType` | `"assigned" \| "voluntary"` | evaluated at confirm time against then-current assignment |
| `appVersion` | string | app version that wrote the record (audit traceability) |
| `schemaVersion` | number | `1` — for future migrations without mutating old records |

Indexes (validated on Forge, spike M0-1 — partition/range split is normative; a range holds exactly **one** attribute, partitions may hold several):

| Index | Partition | Range | Serves |
|---|---|---|---|
| `by-page` | `pageId` | `confirmedAt` | dashboard drill-down, per-page export |
| `by-user` | `accountId` | `confirmedAt` | user history, per-user export |
| `by-page-user` | `pageId, accountId` | `pageVersion` | **macro hot path**: `Sort.DESC` + `limit(1)` = latest confirmed version in one read |

> `by-page-user` was added by the spike: neither original index serves "records for (user, page)" without fanning out over all of a page's confirmations. Note Forge also provides a default `by-key` index per entity (range = data key), but lexicographic key order can't replace `by-page-user` — version numbers in keys sort as strings (`v10` < `v2`).

### 2.2 `pageConfig` — requirement configuration (mutable)

Key: `config#{pageId}`

| Field | Type | Notes |
|---|---|---|
| `pageId` | string | |
| `assignedUsers` | string[] | accountIds; recommended path is groups — soft cap ~1k, UI nudges to groups beyond 50 |
| `assignedGroups` | string[] | group IDs, membership resolved at read time (PRD B1) |
| `dueDate` | string \| null | ISO 8601 date (v1.1 UI) |
| `reconfirmOnChange` | boolean | v1 default false; v1.1 default true for new configs (PRD D1) |
| `createdBy` / `createdAt` | string | provenance |
| `updatedBy` / `updatedAt` | string | last config change (config changes are logged, see §2.4) |
| `counters` | object | advisory denormalized counts for dashboard list (tech design §5) — **never used in exports** |
| `active` | boolean | soft-delete: removing the requirement flips this; records remain |

Index: `tracked` — partition `active`, range `spaceKey` (validated on Forge, spike M0-1). One index serves both dashboard shapes: site-wide list = partition `[true]`; space filter = `where equalTo(spaceKey)` on the range. Booleans are legal partition attributes.

> **Auto-tracking (bug fix, 2026-07-22):** the dashboard and every export scope discover pages exclusively through this `tracked` index, never by scanning `confirmation` records directly (tech design §5's "never fan out" rule) — so a page confirmed only voluntarily, with nobody ever having opened "Configure" and saved, previously had no `page-config` row at all and was permanently invisible to both, despite its confirmation records being real and permanent. `storage/confirmations.ts`'s `writeConfirmation` now creates one automatically (`active: true`, empty assignment — voluntary) on a page's first confirmation if none exists yet, same as if a manager had saved an empty assignment. No `config-audit` entry is written for this (nothing about assignment changed).

> **Starting to track a page without the macro (2026-07-22):** the dashboard's page search (`searchPages`, `resolvers/auth.ts`'s `searchPagesByTitle`) and `PageDetail`'s "Configure" button (docs/07 §4.3/§4.4) both create/edit this record the same way `saveConfig` always has — there is no separate code path or schema for a "dashboard-tracked" vs. "macro-tracked" page, only how the first `page-config` write for a given `pageId` came about.

> **Entity naming (platform constraint, spike M0-1):** entity names must match `^[a-z0-9:\-_.]*` — camelCase is rejected by `forge lint`. Manifest names are therefore `page-config` and `config-audit` (attribute names may stay camelCase); prose in these docs keeps the logical names.

> **Page-move caveat:** `spaceKey` here is written at config time and goes stale if the page moves to another space. Dashboard space filtering resolves the current space at render for rows whose page lookup succeeds; v1.1 refreshes the index on the page-moved event **[SPIKE: verify event id — expected `avi:confluence:moved:page`]**.

### 2.3 `settings` — global app settings (singleton)

Key: `settings#global` — compliance-manager group IDs **and** user IDs (multi, changed 2026-07-22 from a single group ID), default reconfirm behavior, reminder cadence defaults (v1.1).

### 2.4 `configAudit` — config change log (append-only, v1)

Key: `cfgaudit#{pageId}#{timestamp}#{nonce}`
Records who changed assignments/settings and the before/after diff. Auditors ask "who was required, and since when?" — without this, assignment changes silently rewrite history. Small, flat records; index `by-page`.

## 3. Status computation (normative)

For user *U* on page *P* with current published version *V*, config *C*:

```
page-deleted  if P does not resolve (404 — trashed or purged)   # page-level state,
              # see §3.1: excluded from % complete and reminders; records exportable

records := confirmations for (U, P)
latest  := record with max pageVersion

status :=
  cannot-view   if U lacks view permission on P            (flagged, PRD B1)
  outstanding   if no records
  confirmed     if latest.pageVersion == V
                or (latest exists and C.reconfirmOnChange == false)
  expired       otherwise   # page moved past confirmed version, reconfirm required
```

- "% complete" (dashboard) = assigned users with status `confirmed` ÷ assigned users not `cannot-view`.
- `cannot-view` users are surfaced separately, never silently counted as outstanding (PRD B1).
- Voluntary confirmations never enter % complete; they are listed and exported with `assignmentType = voluntary` (PRD A4).

### 3.1 Deleted pages & spaces (lazy detection — normative)

- Detection is **lazy**: wherever a page is rendered or exported, the resolver looks it up; a 404 (trashed or purged) yields `page-deleted` — the row renders as `[deleted page {id}]`, drops out of % complete, outstanding lists, and reminders, and stays available for drill-down and export. **Nothing stored changes**: Confluence trash is restorable, and a restored page resumes normal tracking automatically, with zero writes.
- Confirmation records and `configAudit` are never touched by deletion (§1.1) — auditors may still need proof that a since-retired policy was read.
- v1.1: the `avi:confluence:deleted:page` trigger appends a `configAudit` entry ("page deleted") so the History tab timestamps the deletion. Audit convenience only — never the source of truth (events can be missed; resolution cannot; same principle as version expiry, tech design §6.2).
- **Space deletion** removes all pages in it → every affected row degrades per the above; historical grouping still works via the denormalized `spaceKey`. **[SPIKE: does space deletion emit per-page deleted events or only a space-level event? Affects only the v1.1 audit-log entry.]**

## 4. CSV export format (normative — this is the auditor-facing artifact)

- **Format (revised 2026-07-22, third and final attempt that day):** UTF-16LE-encoded, BOM-prefixed, **tab**-delimited, one row per (page, user) pair in scope, **including outstanding assignees with empty confirmation fields** (PRD F1 — auditors need the negative space). This is the same byte format Excel's own "Save As → Unicode Text (*.txt)" produces, and has reliably auto-opened correctly on double-click for every Excel version and regional setting for decades.
  - Attempt 1 was plain comma-delimited UTF-8+BOM (nominally RFC 4180): failed live — Excel picks its CSV column separator from the OS region's number format, not the file's actual delimiter, so a Turkish-region Excel opened it as one unsplit column per row.
  - Attempt 2 added an Excel `sep=,` directive line: fixed the splitting, but reverted the same day — it routed Excel through an import path that doesn't reliably honor the file's UTF-8 BOM, corrupting Turkish letters (ı/İ/ğ/Ğ/ş/Ş) in the same file.
  - Attempt 3 guessed the delimiter from the Confluence UI locale (`;` for `tr`, sent via `ExportFilePayload.csvDelimiter`): also reverted the same day — the owner's actual Excel/Windows region turned out to expect `,` despite a Turkish Confluence locale, breaking column-splitting again in the opposite direction. Confluence locale is not a reliable proxy for Windows regional settings.
  - The final fix (this one) stops guessing regional settings entirely: `domain/csv.ts`'s `toCsv`/`toCsvRow` always tab-delimit (quoting a field only if it contains a tab, quote, or newline) and always BOM-prefix; `static/export-ui/src/main.ts`'s `downloadResponse` encodes the resulting string into real UTF-16LE bytes client-side (two little-endian bytes per UTF-16 code unit — a JS string already is UTF-16 internally, so this is a direct transcription, not a re-encoding) before handing it to the browser's download `Blob`. `ExportFilePayload` has no delimiter/locale field anymore.
- Header row, exact column order:

```
page_title, page_id, space_key, page_version_confirmed, user_display_name,
user_account_id, assignment_type, status, confirmed_at_utc, due_date,
exported_at_utc, app_version
```

| Column | Rules |
|---|---|
| `page_title` | resolved at export time; deleted page → `[deleted page {id}]` |
| `page_version_confirmed` | empty when status = outstanding / cannot-view |
| `user_display_name` | resolved at export time; deactivated → `[deactivated]`, erased account → `[deleted user]` |
| `assignment_type` | `assigned` \| `voluntary` |
| `status` | `confirmed` \| `expired` \| `outstanding` \| `cannot-view` (per §3, computed at export time) |
| `confirmed_at_utc` | ISO 8601 `YYYY-MM-DDTHH:mm:ssZ`; empty if none |
| `exported_at_utc`, `app_version` | identical on every row of one export — makes each file self-describing evidence |

Scope options and filters per PRD F1 (page / space / site; date range applies to `confirmed_at_utc`).

**Exports obey the viewer-visibility rule (tech design §4):** rows are emitted only for pages the exporting user can view, plus deleted pages (rendered `[deleted page {id}]`, no title). Pages that exist but are view-restricted for the exporter are omitted entirely — an export is evidence of what *this* auditor may see, never a permission bypass.

**PDF export (PRD F2, P0):** a client-side rendering of the *same* normative dataset — identical records, statuses, and timestamps as the CSV of the same scope. CSV remains the canonical machine-readable format; the PDF adds a report header (scope, `exported_at_utc`, app version) and human-readable layout, never additional or filtered data.

## 5. Privacy & data lifecycle (GDPR)

- **Personal data stored:** `accountId` (pseudonymous identifier) + timestamps. Display names are *not* persisted — resolved at render/export (§1.3).
- **Account erasure:** on Atlassian account-closure signals **[SPIKE: exact Forge mechanism — candidates: `avi:confluence:deleted:user` event and the personal-data-reporting API]**, records are retained (legitimate compliance interest) but name resolution returns `[deleted user]`. Document this stance in the privacy policy — retention of the *fact* of confirmation is the product's purpose.
- **Retention:** no automatic expiry in v1; "export everything" available from settings (PRD G2). App uninstall **soft-deletes** Forge-hosted data with a **28-day retention window**; reinstall starts empty unless a recovery/relink request (customer consent required) reaches Atlassian within 21 days — warned in settings UI and docs.
- **Data residency:** inherited from Forge storage (pinned to the site's realm). State in listing.

## 6. Migration & versioning

- Every entity carries `schemaVersion`. Migrations are **read-time upcasts** (old records interpreted, never rewritten) — consistent with append-only.
- Adding indexes to existing entities is a Forge deployment concern **[SPIKE: verify backfill behavior for new indexes on existing data]** — design indexes fully before first production write; changing them later is the costliest change in this app.

## 7. Invariants (enforced by tests — see [test plan](./05_read_confirm_test_plan.md))

1. No code path calls update/delete on `confirmation` or `configAudit` entities.
2. `confirm` with identical (page, user, version) is byte-identical idempotent.
3. Export row count = assigned×pages (in scope) + voluntary records; outstanding rows present.
4. Status computation is a pure function; same inputs → same output, no clock reads inside.
5. `confirmedAt` and `pageVersion` originate server-side only.
6. Page/space deletion mutates nothing: a page-resolution 404 degrades to `page-deleted` with zero writes, and a restored page resumes normal statuses with zero writes (§3.1).
