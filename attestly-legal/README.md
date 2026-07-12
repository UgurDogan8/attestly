# attestly-legal

Public privacy & security policy page for **Attestly** — a Confluence Cloud app (built on
Atlassian Forge) that tracks employee read-and-acknowledge confirmations for policies, SOPs,
and other important pages, for compliance audits (ISO 27001 / SOC 2 / HIPAA).

This folder exists (rather than the app's own `docs/`) so the policy has a stable, public,
login-free URL without exposing the rest of `docs/` (PRD, tech design, task list, pricing
research — internal, not meant to be public), since the Atlassian Marketplace listing requires
linking to a privacy policy hosted outside the app itself.

**Live page:** https://ugurdogan8.github.io/attestly/

Published via GitHub Pages from this folder by `.github/workflows/pages.yml`, triggered on
push to the `attestly` branch when anything under `attestly-legal/` changes. (Previously lived
in a separate `attestly-legal` repo — moved in here so an update to `docs/10`/`docs/11` and the
mirrored `index.html` land in the same PR instead of silently drifting apart, which is exactly
what happened to the old repo.)

## Updating the policy

The canonical source of the policy text lives in this same repo, as Markdown:

- `docs/10_security_statement.md` — the security claims and scope justifications (mirrored into
  the "Security" sections of `index.html` here)
- `docs/11_privacy_policy.md` — the full privacy policy (mirrored into the rest of `index.html`)

Both are checked against `manifest.yml` and the shipped code, not aspirational — when either
changes, update the Markdown there first, then mirror the change into `index.html` in this
folder in the same PR/commit. GitHub Pages redeploys automatically on push.

**Before treating this page as a binding policy:** `docs/11_privacy_policy.md` flags that the
listing's legal/business owner should review and countersign it first — this page is the factual
basis, not a substitute for that review.
