# 11 — Privacy policy (T15, docs/06 §T15)

Source of truth for the Marketplace listing's privacy policy link and the security
questionnaire's privacy answers. Written from data model §5 (`docs/03_read_confirm_data_model.md`)
and the storage layer actually shipped (`src/storage/`) — not aspirational.

*(Publish this as a hosted page — e.g. a GitHub Pages page or a Confluence page shared
publicly — before submission; the Marketplace listing requires a URL, not this file directly.
The user/legal-owner of the listing should review and countersign before it's published as a
binding policy — this draft is the factual basis, not a substitute for that review.)*

## What data Attestly stores

| Data | Where | Purpose |
|---|---|---|
| Atlassian `accountId` (pseudonymous identifier — **not** email or name) | `confirmation`, `config-audit` entities | Records *who* confirmed *what page version*, *when* — this is the product's entire purpose: an auditable trail. |
| Confirmation timestamp (UTC) | `confirmation` entity | When the confirmation happened. |
| Page id, space key, page version | `confirmation`, `page-config` entities | What was confirmed. |
| Assignment configuration (assigned users/groups, due date, re-confirm setting) | `page-config` entity | Who is required to confirm, and by when. |
| Configuration change history (who changed an assignment, when) | `config-audit` entity | Accountability for who set up a requirement — itself an append-only audit log. |
| App-wide settings (compliance-managers group, defaults) | `settings` entity | Admin configuration, not personal data about end users beyond the group id. |

**What Attestly does *not* store:** display names, email addresses, or any other profile
attribute. Names are resolved **on demand**, at render/export time, directly from Confluence's
own user API (`read:user:confluence`) — never persisted. This means a name change in Confluence
is reflected immediately everywhere in Attestly, and means Attestly's own storage contains
nothing an attacker could use to build a name↔identity mapping beyond what Confluence itself
already exposes to the same viewer.

## Legal basis and retention rationale

Attestly's core function — proving *who* acknowledged *what*, *when* — is a compliance record.
Its value is retention, not deletion-on-request: an organization using Attestly for policy
sign-off, SOP acknowledgement, or security-guideline confirmation needs that record to remain
intact even after the confirming employee leaves or their account is closed. This is a
legitimate-interest basis (GDPR Art. 6(1)(f)): the data subject's own action (clicking confirm)
created the record, and its retention serves the same compliance purpose the confirmation itself
was requested for.

## Account closure / erasure

When an Atlassian account is closed or a user is deactivated:

- **The confirmation record is retained** — deleting it would destroy the compliance evidence
  the record exists to provide, defeating the product's purpose for every other stakeholder who
  relied on that confirmation being on file.
- **The name is no longer shown.** Since Attestly never stored the name in the first place
  (resolved live, see above), a closed account simply fails to resolve: the UI renders
  `[deleted user]` (unresolvable account) or `[deactivated]` (suspended but not erased) instead
  of a name, everywhere a name would otherwise appear (dashboard, drill-down, CSV/PDF export).
  The `accountId` itself — a pseudonymous platform identifier, not directly identifying on its
  own — remains in the record.
- If a data subject wants their `accountId` itself removed from historical records (beyond what
  the above already anonymizes), route that request through Atlassian's account-level personal
  data tooling; Attestly's stance is that the confirmation *event* is retained as compliance
  evidence, consistent with the legitimate-interest basis above.

## Retention and uninstall

- **No automatic expiry while installed.** Confirmation records persist indefinitely — this is
  by design; a compliance app that silently expired its own audit trail would be a liability, not
  a feature. Admins can export the full history at any time (Settings → Export all data).
- **Uninstalling the app soft-deletes all Forge-hosted data**, subject to Atlassian's standard
  **28-day retention window**. Reinstalling within that window starts with empty storage —
  Attestly does not itself hold a separate backup. Recovery of the pre-uninstall data requires a
  support request to Atlassian within **21 days**, with the customer's consent, per Atlassian's
  own data-retention policy for Forge apps. This is surfaced in-app (Settings page,
  `settings.lifecycle.body`) before a customer uninstalls.
- **Export before you uninstall** if you need to keep the record outside Forge storage — the CSV
  and PDF exports (Settings → Export all data, or the dashboard's per-scope export) are the
  supported way to retain evidence beyond the app's own lifecycle.

## Data residency

Attestly's storage is Forge KVS, which inherits its residency from the Confluence site's own
Forge storage realm — Attestly does not choose or configure a region independently, and does not
replicate data to any region or provider outside what Forge itself uses for that site. Customers
enrolled in Atlassian's Data Residency program get whatever residency guarantee that program
provides for Forge apps on their site; this app does not opt out of or override that.

## What Attestly never does

- Never sends data to a third party — see docs/10 (security statement): zero external egress.
- Never writes to, edits, or deletes Confluence page content, comments, or permissions — zero
  write scopes.
- Never persists an email address, display name, or any profile field beyond the pseudonymous
  `accountId`.

## Open items before publishing this as a binding policy

- Confirm the exact Forge account-closure signal this app should listen for (data model §7 spike:
  `avi:confluence:deleted:user` event vs. the personal-data-reporting API) — doesn't change the
  behavior documented above, but affects how promptly `[deleted user]` rendering kicks in after a
  real-world closure.
- Have the listing's legal/business owner review this draft (contact details, effective date,
  and any additional boilerplate the org's standard privacy-policy template requires) before
  publishing it as the linked policy.
