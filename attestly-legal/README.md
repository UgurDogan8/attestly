# attestly-legal

Public privacy & security policy page for **Attestly** — a Confluence Cloud app (built on
Atlassian Forge) that tracks employee read-and-acknowledge confirmations for policies, SOPs,
and other important pages, for compliance audits (ISO 27001 / SOC 2 / HIPAA).

This repo exists so the policy has a stable, public, login-free URL, since the Atlassian
Marketplace listing requires linking to a privacy policy hosted outside the app itself.

**Live page:** https://ugurdogan8.github.io/attestly-legal/

Published via GitHub Pages from `index.html` on the `master` branch.

## Updating the policy

The canonical source of the policy text lives in the main Attestly app repo, as Markdown:

- `docs/privacy-security-policy.md` — the full policy (mirrored into `index.html` here)
- `docs/marketplace-security-summary.md` — short text for the Marketplace listing's
  "Security" field

When the policy changes, update the Markdown there first, then mirror the change into
`index.html` in this repo and push — GitHub Pages redeploys automatically.
