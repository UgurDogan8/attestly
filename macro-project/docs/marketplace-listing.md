# Marketplace listing copy — Attestly

Draft copy for the Atlassian Marketplace listing fields. English, ready to paste into
Developer Console (trim to fit each field's character limit — Marketplace limits change
occasionally, so double-check against the current form before pasting).

---

## App name

Attestly

## Tagline (short summary, ~100 characters)

Prove your team read it. One-click read confirmations for Confluence, with an audit-ready
export.

Alternate (shorter):

Read confirmations for Confluence — audit-ready in one click.

---

## Full description

**Attestly turns "please read this policy" into evidence your auditor will accept.**

Add a confirmation macro to any Confluence page — a policy, an SOP, a security guideline —
and Attestly records exactly who read it, which version they read, and when. When the page
changes, prior confirmations are automatically invalidated and readers are notified to
re-confirm. No spreadsheets, no email chains, no chasing people down before an audit.

**Built for compliance, security, HR, and quality teams** who currently track "read and
understood" acknowledgements manually — or pay for a document-workflow suite far bigger than
what they actually need.

### What it does

- **One-click acknowledgement** — a simple macro on any page. Readers click "I have read and
  understood this"; that's the whole interaction.
- **Tamper-evident records** — every acknowledgement stores the page's version number and a
  timestamp, so you always know exactly what someone agreed to and when.
- **Automatic re-confirmation** — edit the page, and everyone who acknowledged the old
  version is notified their confirmation is stale and asked to read it again.
- **Assign readers and due dates** — target specific people or groups, set a deadline, and
  track completion percentage per page.
- **Campaigns** — group several pages under one name, reader list, and due date (e.g. "Q3
  Security Policy Review") and track them together.
- **Automatic reminders** — as a due date approaches (and after it passes, until resolved),
  Attestly reminds pending readers via a native Confluence notification. No external email
  service, no extra permissions to send mail on your behalf.
- **One-click audit export** — download a CSV of every acknowledgement (page, version,
  reader, timestamp) whenever your auditor asks for evidence.

### Why teams choose Attestly

- **Free for small teams.** Teams of 10 or fewer read confirmations use Attestly at no cost.
- **Nothing to learn.** One macro, one admin dashboard. No workflow engine, no approval
  chains, no features you'll never touch.
- **Runs entirely inside Atlassian.** No external servers, no third-party email/SMS
  providers, no data leaving your Confluence site's Atlassian data residency region.
- **Built for the audit, not just the click.** The export is designed to be the thing you
  hand an ISO 27001 / SOC 2 / HIPAA auditor, not a raw data dump you have to reformat first.

---

## Feature highlights (for the listing's icon+text feature strip, ~3-5 items)

1. **One-click read confirmation** — a lightweight macro on any page.
2. **Automatic re-confirmation on page edits** — stale acknowledgements are caught, not
   assumed.
3. **Admin dashboard** — completion %, due dates, and who's still pending, at a glance.
4. **Audit-ready CSV export** — page version + timestamp on every record, one click away.
5. **Native reminders** — no external email service required.

---

## FAQ

**Does this require Jira?**
No. Attestly is Confluence-only and doesn't request any Jira permissions.

**Is there a free tier?**
Yes — teams of 10 or fewer readers can use Attestly for free. (Pricing for larger teams: see
the listing's pricing tab.)

**Where is our data stored?**
Inside Forge's built-in storage, hosted by Atlassian in your site's own data residency
region. Attestly runs no servers of its own and sends data to no third party. See our
[privacy policy](https://ugurdogan8.github.io/attestly-legal/) for details.

**How do reminders get sent — do you need our email server?**
No. Attestly posts a Confluence comment that @mentions pending readers, which triggers
Confluence's own native notification. We never touch an external email or SMS provider.

**What happens when a page is updated?**
Everyone who acknowledged the previous version is automatically notified that their
confirmation is out of date and asked to re-confirm the new version.

**Can I export evidence for an audit?**
Yes — the admin dashboard has a one-click CSV export with every page, version, reader, and
timestamp.

---

## Categories / tags (suggested)

Compliance, Security, Documentation, Human Resources, Governance & Administration

## Support

- Support email: ugur.do808@gmail.com
- Privacy policy: https://ugurdogan8.github.io/attestly-legal/
- Security summary: see `docs/marketplace-security-summary.md` (paste into the listing's
  Security free-text field)

---

## Not included in this draft (needs your input before publishing)

- **Pricing tiers above the free plan** — the product brief flags pricing research as still
  open (competitor pricing wasn't fully visible). Don't publish a per-user number until
  that's settled; the FAQ above deliberately punts to "see the pricing tab" rather than
  inventing a figure.
- **Screenshots** — referenced implicitly by "see screenshots" conventions on the listing
  page; not embedded here since they still need to be captured (see the screenshot checklist
  discussed earlier: byline before/after, admin dashboard table, acknowledger modal, CSV
  export, assign/campaign forms).
- I did not claim a "QC Read and Understood importer" as a feature — the product brief lists
  this as a differentiation *idea*, but it was never built, and claiming it in a public
  listing would be inaccurate. If you build it later, add a bullet then.
