# UX Flows & Wireframes: Read Confirmation App

> **Status:** Draft v0.1 · July 2026
> **Source:** [PRD](./01_read_confirm_prd.md) §3 · [Tech design](./02_read_confirm_tech_design.md) §3
> Low-fidelity, Atlaskit-based. Wireframes are ASCII sketches — layout intent, not pixel specs. All components from `@atlaskit/*`; no custom-styled controls.

---

## 1. Design principles

1. **Reader effort ≈ zero.** One glance to know what's expected, one click to comply. No modals, no forms for readers.
2. **Admin answers one question fast:** "who hasn't read what?" Everything on the dashboard serves that.
3. **Never lie about state.** Confirmed state renders only after the server acknowledges the write (pessimistic UI, PRD A2).
4. **Compliance tone, not gamification.** Neutral language, no confetti. The button text is legal-ish on purpose.

## 2. Reader flows

### 2.1 Macro states (on-page confirmation block)

**State R1 — required, not yet confirmed** (assigned user)

```
┌──────────────────────────────────────────────────────────┐
│ 🛈 Read confirmation required                             │
│ Your acknowledgement of this page is requested.           │
│ Due: 15 Aug 2026                       (omit if no due)   │
│                                                           │
│        [ I have read and understood this page ]           │  ← Button (primary)
└──────────────────────────────────────────────────────────┘
```

**State R2 — confirming** (after click): button → disabled with spinner (`isLoading`). No optimistic switch.

**State R3 — confirmed (current version)**

```
┌──────────────────────────────────────────────────────────┐
│ ✅ Confirmed                                              │
│ You confirmed version 7 on 12 Jul 2026, 14:03 (UTC+3).    │
└──────────────────────────────────────────────────────────┘
```
SectionMessage `appearance="success"`. Local timezone display; UTC stored.

**State R4 — page updated, re-confirmation required** (v1.1, reconfirmOnChange=on)

```
┌──────────────────────────────────────────────────────────┐
│ ⚠ This page has changed since you confirmed it            │
│ You confirmed version 5; the page is now version 7.       │
│        [ I have read and understood this page ]           │
└──────────────────────────────────────────────────────────┘
```

**State R5 — voluntary** (viewer not assigned): same as R1 but subtle — no "required" wording:
`This page asks readers to acknowledge it. [ I have read and understood this page ]`

**State R6 — error on confirm**: SectionMessage `appearance="error"`, "We couldn't record your confirmation. Try again." Button re-enabled. Never shows confirmed.

**State R7 — page changed mid-read** (tech design §6.3): info message "This page was just updated — please review the latest version," page reload link, button re-enabled after reload.

### 2.2 Byline item (under page title)

- Not confirmed & assigned: `● Confirmation required` (badge, warning color)
- Confirmed current: `✔ Confirmed 12 Jul 2026`
- Expired: `⚠ Re-confirmation required`
- Not assigned, no voluntary record: byline hidden (zero noise for uninvolved readers).
- Click opens the byline **dialog** (platform behavior — a `contentBylineItem` renders the app's resource in a dialog on click; custom in-page scrolling is not supported). Dialog shows the user's status detail and, when outstanding, the same confirm action as the macro. Badge text/icon are set via the module's `dynamicProperties` and refresh after the dialog closes.

### 2.3 Reader accessibility (PRD §4.5)

Confirm button reachable by keyboard, visible focus ring (Atlaskit default), `aria-live="polite"` on state transitions R2→R3/R6, WCAG 2.1 AA contrast (Atlaskit tokens only).

## 3. Admin flows

### 3.1 Assignment (Custom UI macro config modal — tech design §11.6)

> Save writes to app storage via resolver (`saveConfig`), **never into page content** — page version restores can't roll back assignments and the dashboard can edit the same config. Fallback if the in-config invoke probe fails: the same UI as a modal launched from the macro body in view mode.

Editor inserts macro via `/read confirmation` → config panel:

```
┌─ Read confirmation settings ────────────┐
│ Who must confirm?                       │
│  Users:  [ user picker (multi)      ]   │
│  Groups: [ group picker (multi)     ]   │
│  ⓘ For teams, prefer groups — new       │
│    members are included automatically.  │
│ Due date:            [ date picker ]    │  (v1.1)
│ Require re-confirmation on change: [x]  │  (v1.1)
└─────────────────────────────────────────┘
```

No assignment set = voluntary-only mode (R5 for everyone). Panel shows "No required readers — confirmations will be voluntary."

### 3.2 Dashboard — global page (Apps → Read confirmations)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Read confirmations                                    [Export CSV ▾] │
│ Filter: [Space ▾] [Status ▾: All | Incomplete | Complete | Overdue]  │
├──────────────────────────────────────────────────────────────────────┤
│ Page                    Space   Assigned  Confirmed   %      Due     │
│ Security Policy v3      SEC       142       89      63% ▓▓▓░  15 Aug │
│ Code of Conduct         HR         12       12     100% ▓▓▓▓   —     │
│ Incident Response SOP   SEC        38        9      24% ▓░░░  01 Aug⚠│
│                                            ...        [Load more]    │
└──────────────────────────────────────────────────────────────────────┘
```

DynamicTable, ProgressBar in % cell, overdue = warning icon + red date. Row click → drill-down. Empty state: onboarding illustration + "Add the Read confirmation macro to any page to start tracking" + docs link (first-run experience matters for trial conversion).

### 3.3 Drill-down (per page)

```
┌─ Security Policy v3 (v7) ────────────────── [Export CSV] [Remind]* ──┐
│ 89 of 142 confirmed · 51 outstanding · 2 cannot view    *v1.1        │
│ Tabs: [Outstanding] [Confirmed] [Voluntary] [Cannot view] [History]  │
├──────────────────────────────────────────────────────────────────────┤
│ OUTSTANDING (51)                                                     │
│  Ayşe Yılmaz        assigned via group: sec-all                      │
│  John Carter        assigned directly                                │
│ CONFIRMED (89)                        version   confirmed at (UTC)   │
│  Mehmet Demir       ✔                    7      2026-07-12 11:03     │
│  …                                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

- "Cannot view" tab surfaces PRD B1's flag with fix hint ("grant page permission or remove from assignment").
- History tab = configAudit log (who changed assignments, when) — the auditor's "who was required since when."
- Expired confirmations (v1.1) appear in Outstanding with note "confirmed v5 — page now v7."

### 3.4 Export dialog

ModalDialog: format (CSV / PDF), scope (This page / Space / Entire site), date range (optional), status filter → progress bar during chunked fetch → browser download. Filename: `read-confirmations_{scope}_{YYYY-MM-DD}.csv|.pdf`. Both formats contain the same records (data model §4); PDF adds the report header for hand-to-auditor use.

### 3.5 Settings (Confluence admin)

Compliance-managers group picker (grants dashboard access to non-admins), defaults (reconfirm behavior, reminder cadence v1.1), "Export all data" button, data-lifecycle notice (uninstall deletes data — PRD G2).

## 4. Flow diagrams

**Reader happy path:** open page → macro shows R1 → click → R2 → server writes record → R3 (+ byline flips to ✔).

**Admin campaign path:** edit policy page → insert macro → assign `sec-all` group + due date → publish → dashboard shows page at 0% → (v1.1: reminders fire) → drill-down to chase stragglers → export CSV → hand to auditor.

**Version-change path (v1.1):** page edited & published → confirmations to old version compute as expired → byline/macro show R4 → % drops on dashboard → readers re-confirm.

## 5. Error & edge states (must be designed, not improvised)

| Case | Surface | Behavior |
|---|---|---|
| Storage write fails | macro | R6, retryable |
| User lacks dashboard permission | global page | Atlaskit EmptyState: "You need compliance-manager access", no data leak |
| Macro on page with app uninstalled→reinstalled | macro | reinstall starts with empty storage (Forge soft-deletes data, 28-day retention; relink only via Atlassian recovery request ≤21 days) → macro renders "Set up confirmation" fresh state; prior data recoverable via support, not automatically |
| >1 macro on page | macro | first active, others render inert warning (PRD A1) |
| Assigned group deleted | drill-down | badge "group deleted", members no longer counted; configAudit row recorded |
| Tracked page deleted (trash or purge) | dashboard | row renders `[deleted page {id}]`, excluded from % and reminders; drill-down + export still available; restoring from trash returns the row to normal (no data loss) |
| Space deleted | dashboard | all its pages follow the deleted-page behavior; rows still group under the recorded space key |
| 0 assigned, voluntary only | dashboard | % column shows "—" with tooltip, not 0% (don't punish voluntary-mode pages) |

## 6. Copy guidelines

- Button (exact, legal-leaning): **"I have read and understood this page"** — never shorten to "Confirm/OK".
- "Acknowledgement" in admin surfaces, "confirmation" acceptable in reader surfaces; pick one per surface, never "sign" (avoids e-signature implication — PRD non-goal).
- English v1; all strings in `packages/shared/i18n/en.ts` from day one (PRD §4.5, tech design §3 layout); Turkish (`tr.ts`) first follow-on locale.
