# 12 — Marketplace listing copy, EN (T15, docs/06 §T15)

Draft copy for the Atlassian Marketplace listing's Overview tab. Written from the shipped
feature set (`src/`, `docs/03` §4 CSV format, `docs/07`) and the product brief's positioning
(`docs/00` §2, §6) — not aspirational; every claim below maps to a real, tested feature.

**Not included here — genuinely blocked on a live deployment:** screenshots and the short
product video. Both require an actual installed app on a real Confluence site captured through a
browser; drafting placeholder images would misrepresent the product to reviewers. Capture these
during the docs/09 staging smoke-check pass, once `forge register` + a real `forge deploy` exist.

---

## Tagline (one line, under the app name on the listing card)

> Prove your team read the policy — with an audit trail your compliance officer can export.

## Short description (search results / card summary, ~150 chars)

> Compliance-grade read confirmations for Confluence. Assign pages, track who's confirmed, export
> an audit-ready CSV or PDF. Forge-native — no external egress, no write scopes.

## Key highlights (3, matching the Marketplace "highlights" format — icon + heading + one line)

1. **Confirmation macro, one click**
   Drop the macro on any page. Readers see exactly what they're confirming and click once — the
   confirmation is recorded against the page version they were actually looking at.

2. **See who's outstanding, not just who's done**
   The dashboard and per-page drill-down show confirmed, outstanding, and cannot-view readers
   separately — including readers who were assigned but don't actually have page access, a gap
   most trackers miss.

3. **Export what your auditor accepts**
   One-click CSV or PDF, filtered by page, space, or the whole site, with page version and UTC
   timestamp on every row — the artifact an ISO 27001 / SOC 2 / internal-policy audit expects.

## More details (long-form Overview body)

Attestly answers one question cleanly: **who has actually read this page, and can you prove it?**

Add the confirmation macro to any Confluence page — a policy, an SOP, a security guideline — and
assign it to specific users or groups. Each reader sees a clear "I have read and understood this
page" button; clicking it records their confirmation against the exact page version they viewed,
timestamped to the second.

The admin dashboard shows completion at a glance across every tracked page, with drill-down into
who's confirmed, who's outstanding, and — uniquely — who was assigned but can't actually view the
page, so gaps in permissions don't quietly become gaps in your audit trail. When a tracked page
changes, re-confirmation can be required automatically, so acknowledgements never silently go
stale.

When it's time to prove compliance, export the full record — CSV or PDF, scoped to one page, a
space, or the entire site — with page version, UTC timestamp, and confirmation status on every
row, including outstanding readers (auditors need to see who *hasn't* confirmed too).

**Built for the compliance buyer, not the workflow suite:**
- **Runs entirely on Atlassian Forge** — no external servers, no data leaving your Atlassian
  environment, no third party ever sees your content or confirmation records.
- **Zero write scopes** — Attestly cannot edit, delete, or comment on your Confluence content. It
  only reads what it needs to track confirmations and writes to its own app storage.
- **Free for teams up to 10 users.**

## Feature list (bulleted, for the listing's feature grid)

- Read-confirmation macro for any Confluence page
- Assign to individual users or groups (group membership resolved automatically)
- Per-page and per-space admin dashboard with live completion %
- Drill-down: confirmed / outstanding / voluntary / cannot-view, per user
- Configuration history (who assigned whom, when, and why it changed)
- Due dates per page
- Automatic re-confirmation when a tracked page changes to a new version
- CSV export (RFC 4180, UTF-8 BOM, Excel-ready) and PDF export, both scoped by page/space/site
  and optional date range
- English and Turkish UI
- Confluence-admin-gated settings: compliance-managers group, org-wide export

## Categories / tags (for Marketplace search placement)

Compliance, Governance & Administration, Reporting, Documentation.

## Use cases (short list, for the "why teams use this" section)

- ISO 27001 / SOC 2 policy-read evidence
- Security-guideline and onboarding acknowledgements
- SOP sign-off tracking for regulated teams
- Internal policy rollouts where "did everyone see this?" needs a real answer, not an assumption
