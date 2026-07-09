# PRD: Confluence Read Confirmation / Policy Acknowledgement App

> **Name:** "Acknowledge" — **decided** (owner, Jul 2026). Marketplace collision check clean; formal trademark check before listing submission.
> **Status:** Draft v0.1 · July 2026
> **Source:** [00_read_confirm_product_brief.md](./00_read_confirm_product_brief.md)
> **Platform:** Atlassian Forge · Confluence Cloud
> **Owner:** Kostebek Teknoloji apps team (apps-team@kostebekteknoloji.com)

---

## 1. Overview

### 1.1 Problem
Companies facing ISO 27001, SOC 2, HIPAA, or internal audits must **prove** employees have read key policies published in Confluence. Today they track this manually (spreadsheets + email chasing) or buy heavyweight document-management suites. There is no simple, audit-grade, Forge-native tool that does *just this*.

### 1.2 Solution
A Confluence Cloud app that lets a page owner require acknowledgement of a page, shows readers an "I have read and understood" button, records an immutable confirmation (user + page + **page version** + timestamp), tracks who is outstanding, and exports an audit-ready report.

### 1.3 Goals (v1)
1. A compliance admin can require confirmation on any Confluence page in **under 2 minutes**, with zero training.
2. Every confirmation is recorded with page version and UTC timestamp and is **never silently lost or mutated**.
3. The admin can answer "who has/hasn't read policy X?" in one screen and export the proof as CSV.

### 1.4 Non-goals (explicitly out of v1 — guard against scope creep)
- Document approval/workflow engine (states, reviewers, sign-off chains)
- Jira integration, cross-space rollups
- Legally certified e-signatures (confirmation ≠ qualified signature)
- Anonymous/public (unlicensed) user confirmations
- Server/DC support (Cloud-only, Forge-only)
- Compensating for page-permission problems — the app *flags* assigned users who cannot view a page (B1); resolving access is the space admin's responsibility. No permission-repair flows, no special-casing beyond the flag (owner decision, Jul 2026).

### 1.5 Success metrics
| Metric | Target (6 months post-launch) |
|---|---|
| Installs | 100+ (leader today has ~322) |
| Marketplace reviews | 10+ (category currently has zero — first mover on social proof) |
| Trial → paid conversion | ≥ 15% of installs above free tier |
| Support tickets per install per month | < 0.1 |

---

## 2. Users & personas

| Persona | Role in app | Needs |
|---|---|---|
| **Compliance admin** (compliance officer, ISMS manager, HR, quality manager) | Configures requirements, assigns readers, monitors, exports | Audit-ready proof; chase non-confirmers with minimal effort |
| **Space admin / page owner** | Adds the confirmation requirement to pages | One-click setup, sensible defaults |
| **Reader** (employee) | Confirms pages | Zero-friction: see what's required, click once, done |
| **Auditor** (indirect) | Consumes the export | Trustworthy record: who, what version, when |

Target company size: 10–200 Confluence users (SMB/mid-market).

---

## 3. Functional requirements

Requirements are grouped into epics. Priority: **P0** = v1 launch blocker, **P1** = fast-follow (target v1.1 within 4–6 weeks of launch), **P2** = later.

### Epic A — Confirmation on a page (P0)

**A1. Add confirmation requirement to a page**
*As a page owner, I can add a confirmation block to a page so readers are asked to acknowledge it.*
- Implemented as a **macro** (insertable via `/read confirmation` in the editor — matches the macro title in the manifest; see tech design §2) rendering the confirmation UI.
- Additionally register a `contentBylineItem` that shows the current user's confirmation status under the page title ("✔ Confirmed on <date>" / "Confirmation required").
- Acceptance criteria:
  - Macro insertable on any page the user can edit; at most one active confirmation block per page (second insert shows a warning and renders as inert).
  - Macro renders for all viewers, including those not assigned (see A4 for behavior differences).
  - Page works normally if the app is uninstalled (macro degrades to Confluence's standard "app missing" placeholder; no page corruption).

**A2. Confirm a page**
*As a reader, I can click "I have read and understood this page" and my confirmation is recorded.*
- Acceptance criteria:
  - Button click stores a confirmation record (schema in §5) and immediately re-renders as confirmed state showing the user's own confirmation date. No page reload required.
  - Confirmation is recorded against the **page version the user is currently viewing**.
  - Double-clicks / repeat clicks are idempotent — exactly one record per (user, page, version).
  - If storage write fails, the user sees an error and the button remains clickable (never a false "confirmed" state).
  - Anonymous users and users without page view permission never see the button.

**A3. See my own status**
*As a reader, I can see whether I've confirmed the current page and when.*
- Acceptance criteria:
  - Confirmed state shows date + the version number the user confirmed.
  - If the page has changed since the user confirmed (and re-confirmation is enabled, Epic D), state shows "Page updated — please confirm again."

**A4. Assigned vs. voluntary confirmations**
- Anyone with page view access **may** confirm (voluntary record).
- Only **assigned** users/groups (Epic B) are counted in completion %, outstanding lists, and reminders.
- Acceptance criteria: dashboard and export clearly distinguish `assigned` vs `voluntary` records.

### Epic B — Assignment (P0)

**B1. Assign readers to a page**
*As a compliance admin, I can define who must confirm a page.*
- Assign by: individual users (user picker) and/or Confluence groups.
- Acceptance criteria:
  - Assignment editable from the macro config panel and from the admin dashboard.
  - Group membership is resolved **at read time** (dashboard/report generation), not snapshotted — new group members automatically become outstanding.
  - Assigned users who lack view permission on the page are flagged in the dashboard ("cannot view page") rather than silently counted as outstanding.
  - Removing a user from assignment removes them from outstanding counts but **never deletes** their existing confirmation records.

**B2. Due date (P1)**
*As a compliance admin, I can set a due date for confirmations on a page.*
- Acceptance criteria: due date shown to readers in the macro; dashboard shows overdue state; feeds reminders (Epic E).

### Epic C — Admin dashboard (P0)

**C1. Global admin page**
*As a compliance admin, I can see all pages with confirmation requirements across the site.*
- Forge `globalPage` (Confluence global module), access restricted to Confluence admins + an app-configurable "compliance managers" group.
- Columns: page title (link), space, assigned count, confirmed count, % complete, due date, last activity.
- Acceptance criteria: sortable, filterable by space and completion status; handles 500+ tracked pages without timing out (pagination).

**C2. Per-page drill-down**
*As a compliance admin, I can see per-user status for one page.*
- Lists every assigned user: name, status (confirmed / outstanding / cannot view), confirmed version, confirmation timestamp.
- Voluntary confirmations listed in a separate section.
- Acceptance criteria: reflects group membership changes at load time; a deactivated Atlassian account shows as "deactivated" with its historical record intact.

### Epic D — Re-confirmation on page change (P1 — highest-priority fast-follow; compliance correctness depends on it)

**D1. Version-aware expiry**
*As a compliance admin, I can require that when a page is materially updated, prior confirmations expire and readers must re-confirm.*
- Listens to Confluence page-updated events (Forge trigger on `avi:confluence:updated:page`).
- Per-page setting: **Off** (confirmations persist) / **On** (any new *published* version expires confirmations). Default: On.
- Acceptance criteria:
  - Old confirmation records are **never deleted or modified** — expiry is computed by comparing record's version against current page version.
  - Dashboard % complete counts only confirmations of the current version when the setting is On.
  - Readers see the "please confirm again" state (A3) after an update.
  - Draft edits and unpublished changes do not trigger expiry.

### Epic E — Reminders (P1)

**E1. Scheduled reminders**
*As a compliance admin, outstanding assignees get nudged automatically so I don't chase people by hand.*
- Forge `scheduledTrigger` (daily) evaluates pages with due dates; notifies outstanding assignees.
- Notification channel v1: Confluence in-product notification and/or email via Confluence notification APIs — **spike required** to confirm which channels Forge can use without external egress (see Open Questions).
- Acceptance criteria: a user receives at most one reminder per page per configured interval (default: 3 days before due, on due date, then weekly); reminders stop on confirmation; admin can trigger "remind all outstanding now" manually.

### Epic F — Audit export (P0)

**F1. CSV export**
*As a compliance admin, I can export the confirmation log so an auditor accepts it as evidence.*
- Scope options: single page, whole space, or entire site; filter by date range.
- Columns: `page_title, page_id, space_key, page_version_confirmed, user_display_name, user_account_id, assignment_type (assigned|voluntary), status (confirmed|outstanding|expired), confirmed_at_utc (ISO 8601), due_date, exported_at_utc, app_version`.
- Acceptance criteria: outstanding assignees appear as rows with empty timestamp (auditors need the negative space too); export of 10,000 records completes without invocation timeout (chunked/paginated generation); file downloads client-side.

**F2. PDF export (P0 — owner decision Jul 2026: launch requirement)**
- Formatted, letterhead-style report per page or campaign; rendered client-side from the same export dataset as F1 (same rows, statuses, and timestamps — CSV remains the canonical machine-readable format).
- Acceptance criteria: PDF and CSV of the same scope contain the same records; report header states scope, export timestamp (UTC), and app version.
- ⚠ Adds ~3–5 days to M2; M3 must still not slip past Q3 2026 (Connect-EOL window, §7).

### Epic G — App administration (P0)

- **G1.** App settings page (Confluence admin section): default re-confirmation behavior, compliance-managers group, reminder cadence defaults.
- **G2.** Data lifecycle: on uninstall, Forge-hosted storage is **soft-deleted and retained for 28 days**; a reinstall is treated as a new installation, but data can be relinked if a recovery request (with customer consent) is made to Atlassian within 21 days. Settings page documents this and offers "export everything" as the escape hatch.

---

## 4. Technical requirements

### 4.1 Stack (company standard — mandatory)
- **TypeScript**, strict mode; ESLint + Prettier.
- **Forge** app; frontend as **Custom UI with React + Atlaskit** (`@atlaskit/*`) — dashboard complexity (tables, filters, user pickers) exceeds UI Kit comfortably.
- **Tests required:** unit tests (Vitest or Jest) for all storage/domain logic — especially version-expiry computation and idempotent confirm; integration tests against Forge storage mocks; CI runs lint + typecheck + tests.

### 4.2 Forge modules (expected)
| Module | Use |
|---|---|
| `macro` (Custom UI) | Confirmation block on pages |
| `confluence:contentBylineItem` | Per-user status under page title |
| `confluence:globalPage` | Admin dashboard |
| `confluence:globalSettings` or admin page | App settings |
| `trigger` (`avi:confluence:updated:page`) | Re-confirmation expiry (Epic D) |
| `scheduledTrigger` | Reminders (Epic E) |

### 4.3 Scopes (principle of least privilege — verified against the Confluence scopes reference)
Granular scopes: `read:page:confluence`, `read:user:confluence` (display names; granular — not the classic `read:confluence-user`), `read:group:confluence` (assignment resolution), `read:content.permission:confluence` (cannot-view checks), plus `storage:app`. Add notification scope per Epic E spike outcome. Every added scope must be justified in the security statement.

### 4.4 Storage design (Forge KVS)
> Finalized: the [tech design](./02_read_confirm_tech_design.md) §5 selected **KVS custom entities** (not plain KV) for indexed queries, and the [data model spec](./03_read_confirm_data_model.md) is the authority on entities and keys. The sketch below is the original intent, kept for context (keys illustrative):
- `config:{pageId}` — requirement config: assignments (users, groups), due date, re-confirm setting, created-by, created-at.
- `confirm:{pageId}:{accountId}:{version}` — immutable confirmation record: `accountId, pageId, pageVersion, confirmedAt (UTC), assignmentType`.
- `index:pages` — index of tracked pages for the global dashboard (maintain on config create/delete).

Constraints to respect: Forge Storage value-size and query limits — page-level fan-out queries must paginate; never require a full scan per dashboard load. Confirmation records are **append-only**: no code path updates or deletes a confirmation record (uninstall aside).

### 4.5 Non-functional requirements
- **Performance:** macro interactive < 2s on a warm page; dashboard first paint < 4s at 500 tracked pages / 10k records.
- **Reliability:** confirm action is atomic — either recorded and shown, or errored and retryable. No optimistic UI that can show unrecorded confirmations.
- **Privacy/GDPR:** app stores account IDs, display names (resolved at render, not persisted where avoidable), and timestamps. Comply with Atlassian's user privacy guide (right-to-be-forgotten: handle Atlassian account deletion events by anonymizing display data while preserving the audit record's existence). Data residency: inherited from Forge — state this in the listing (it's a selling point for the compliance buyer).
- **Accessibility:** Atlaskit defaults + keyboard-operable confirm button, WCAG 2.1 AA for the macro.
- **i18n:** English UI at launch; string externalization from day one (Turkish as first added locale — company capability, differentiator in home market).

---

## 5. Pricing & packaging

**Research captured (T15, Jul 2026)** — live Marketplace pricing tabs, via each app's own
per-user-count estimator:

| App | Vendor | Scope | Free tier | @100 users |
|---|---|---|---|---|
| Comala Document Management | Appfire | Full document lifecycle/workflow suite — much broader than read-confirmation alone | Free ≤10 users | USD 237/mo (≈$2.37/user) |
| Read & Confirm for Confluence | MiddleCore | Same scope as Attestly (macro + dashboard + CSV export + assign users/groups); Forge-native, "Runs on Atlassian" | Free ≤10 users | USD 67/mo (≈$0.67/user) |
| QC Read and Understood | QC Analytics | Similar narrow scope; Connect-based, no visible free-≤10 tier (10 users already USD 1/mo) | *(none visible)* | USD 33/mo (≈$0.33/user) |

**Recommendation (pending owner sign-off — not yet a final decision):** Free ≤10 users (matches
both direct comps and the original GTM thesis, brief §6); paid tier priced **at or slightly below
MiddleCore's ≈$0.67/user/month** (the closest scope match) — e.g. **$0.50/user/month** — which
comfortably undercuts Comala's suite-level pricing (different product tier, not a fair
comparison) while still pricing above QC's rock-bottom, no-free-tier utility pricing. This
directly executes brief §7's "undercut the enterprise incumbent" strategy against the *actual*
closest competitor rather than the broader-scope one.

**Paywall mechanics — resolved, no code path needed** (was PRD open question #6, corrected here
per docs/07 §6): Atlassian Marketplace bills Cloud apps by the host product's own licensed
user-tier band, and vendors set a **price per tier in the Partner Portal**, including a genuine
$0 price point for the 1–10 tier (Atlassian's own "$0 price point for your 1–10 cloud app user
tier" feature). Enforcement is Atlassian's, tied to the Confluence site's license tier, not
Attestly's own user count — the app runs identically at every tier. **T15 does not add an
in-app user-count gate**; doing so would in fact be wrong, since Atlassian's tier-lock rule bills
a site at its full Confluence license tier regardless of how many of those users actually touch
Attestly. See docs/06 T15 and docs/08 TC-H5 for the corresponding correction.

**Cost input (still open):** Forge platform usage pricing (in effect since Jan 2026 — resource
usage beyond free quotas is billed, e.g. SQL at GB-hour, KVS/invocation quotas) should be
projected against expected per-install usage before the recommended $/user number above is
finalized, so the margin at the free ≤10-user tier is understood, not just the top-line price.
Not done in this pass — flag to the owner alongside the pricing recommendation itself.

---

## 6. Release plan

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Spike** (wk 1) | Forge setup, hello-world macro, storage write/read, scope validation, reminder-channel spike | Deployed to dev site; go/no-go on module + notification choices |
| **M1 — Core loop** (wk 2–4) | Epics A, B1, storage layer + tests | A user can be assigned, confirm, and the record is queryable |
| **M2 — Admin + export** (wk 4–6) | Epics C, F1+F2, G | Dashboard + CSV and PDF export pass acceptance criteria |
| **M3 — Listing** (wk 6–8) | Polish, listing assets, privacy policy, security statement, pricing | Marketplace submission |
| **v1.1** (wk 8–12) | Epics D, E, B2 | Re-confirmation + reminders live |

> Note: brief estimates 6–8 weeks for a junior dev to v1. D and E are deliberately post-launch: launch with the airtight core loop, ship the differentiators while reviews accumulate.

---

## 7. Dependencies & risks

| Risk | Mitigation |
|---|---|
| Reminder channel unavailable to Forge without external egress | M0 spike; fallback = in-app byline status + dashboard-driven manual nudge, email in v1.2 |
| Forge Storage query limits make site-wide dashboard slow | Maintain `index:pages`; paginate; load per-page detail lazily |
| Atlassian ships native read-confirmation | Ship fast; depth of audit export + compliance UX is the moat |
| Demand is genuinely niche (small category) | Validation interviews (brief §9.3) run in parallel with M0–M1; kill/pivot checkpoint at M1 — **confirmed, owner decision Jul 2026** |
| QC (Connect) users migrate before we launch | Time listing + migration messaging to Atlassian's Connect EOL banners (Q4 2026) — M3 must not slip past Q3 |

---

## 8. Open questions (owner: product / to resolve by M0 exit)

1. ~~**Name**~~ — **resolved (Jul 2026):** "Acknowledge" (owner decision; Marketplace collision check clean, trademark check before listing).
2. **Reminder channel** — what can Forge send natively (email via Confluence notifications? in-app only?) without external egress that would complicate the security story?
3. ~~**PDF export in v1?**~~ — **resolved (Jul 2026):** yes, launch requirement (owner decision) — see F2.
4. **QC importer** — is QC's data exportable at all? Decide whether "migration" messaging is data-import or just switch-over.
5. ~~**Voluntary confirmations**~~ — **resolved (Jul 2026):** keep as designed (owner decision) — anyone with view access may confirm; voluntary records shown/exported separately, never in completion % (A4/F1 defaults stand). Interviewees may still be asked as a signal, but nothing blocks on it.
6. ~~**Paywall mechanics**~~ — **resolved (T15, Jul 2026):** Marketplace user-tier billing, no in-app enforcement — see §5.

---

## 9. Related documents

- [Product brief](./00_read_confirm_product_brief.md) — market analysis, competition, thesis
- [Technical design](./02_read_confirm_tech_design.md) — architecture, Forge modules, storage, spike checklist
- [Data model & audit record spec](./03_read_confirm_data_model.md) — entities, status computation, CSV format
- [UX flows & wireframes](./04_read_confirm_ux_flows.md) — reader/admin flows, error states, copy
- [Test plan](./05_read_confirm_test_plan.md) — test strategy, CI pipeline, release checklist
- Pricing research report — *blocked, brief §9.1*
- Privacy policy & security statement — *required for M3*
