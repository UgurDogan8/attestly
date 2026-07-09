# 10 — Security statement (T15, docs/06 §T15)

Source of truth for the Marketplace listing's "Privacy & Security" tab and the security
questionnaire. Every claim below is checked against `manifest.yml` and this codebase, not
aspirational — if a claim here stops being true, fix the claim or fix the code in the same PR.

## Summary

Attestly runs entirely on Atlassian Forge: all compute is Forge FaaS, all data lives in Forge
storage (KVS), and the app makes **zero requests to any host outside Atlassian's own APIs**.
There is nothing to configure, no external account to create, and no third party ever sees
Confluence content or confirmation records.

## Claims and their basis

| Claim | Basis |
|---|---|
| **No external egress** | `manifest.yml`'s `permissions.external` is absent (never populated). Every network call in the codebase goes through `@forge/api`'s `asUser()`/`asApp()` (Atlassian's own REST APIs) or `@forge/kvs` (Atlassian's own storage) — grep `src/` for `fetch(` or `http` finds nothing; there is no raw network client in this codebase. |
| **No write scopes** | `permissions.scopes` in `manifest.yml` is five read/storage scopes (below) and zero `write:*` scopes. The app cannot create, edit, or delete any Confluence content, comment, or permission. |
| **Data stays in Forge storage** | `storage:app` (KVS custom entities) is the only persistence layer. No database, cache, queue, or file store outside Forge is used or configured. |
| **Single inbound endpoint, token-guarded** | Exactly one webtrigger (`export-trigger`, `src/webtriggers/export.ts`) — used only to stream a file download, since UI Kit cannot trigger a browser download itself. It is inbound-only (it doesn't call out anywhere), requires a per-request one-time token plus a per-environment shared secret (`EXPORT_SECRET`, `forge variables set --encrypt`), and only ever serves pages a prior `asUser()` call already confirmed are visible to the requesting user — see `src/resolvers/export.ts` and docs/07 §5. Enforced by `src/release/manifest.test.ts` (T14): CI fails if a second webtrigger is ever added. |
| **Least-privilege scopes** | See table below — every scope maps to a specific, named read path. None is broader than the granular alternative (e.g. `read:user:confluence`, not the deprecated broad `read:confluence-user`). |
| **"Runs on Atlassian" badge: not claimed** | The single webtrigger above is a deliberate, disclosed trade-off (UI Kit has no other way to drive a file download) — it forfeits Atlassian's "Runs on Atlassian" Marketplace badge but **not** the no-external-egress claim, since the trigger is inbound-only. See docs/07 §1, §6. |

## Scopes requested (five, all read/storage)

| Scope | Why |
|---|---|
| `storage:app` | KVS custom entities — the app's entire datastore |
| `read:page:confluence` | Server-authoritative page version + title (v2 pages API); the "what version did this user actually view" proof |
| `read:user:confluence` | Display-name resolution at render/export time; also covers the Confluence-admin check (`GET /wiki/rest/api/user/current?expand=operations`) used to gate the settings page |
| `read:group:confluence` | Resolves group membership for page assignments and the compliance-managers group |
| `read:content.permission:confluence` | "Can this other user view this page" checks (the dashboard's cannot-view tab) and deleted-vs-restricted-page disambiguation |

No `read:space`, no `permissions.external`, no `write:*` of any kind. A PR that adds or changes
any of the above fails CI (`src/release/manifest.test.ts`, T14) until the scope snapshot is
consciously updated — see docs/09 §1.

## What's out of scope for v1 (disclosed, not hidden)

- **Reminders** (`write:comment:confluence` in the prior `macro-project` build) are deferred to
  v1.1, gated behind a rolling release + Permissions SDK re-consent flow when they ship — v1
  never requests this scope.
- **Page-updated trigger** (would need a broader content-summary scope) is also v1.1; status is
  computed from page versions already visible under `read:page:confluence`, so v1 never needs it.

## Open items before submission (not blocking this document, but blocking the actual listing)

- Marketplace's own **security questionnaire** and (optionally) the **Bug Bounty program** /
  **Cloud Fortified** enrollment are separate Partner Portal steps with their own forms — this
  document is the factual source to fill them from, not a replacement for them.
- Confluence's account-closure signal mechanism (`avi:confluence:deleted:user` vs. the
  personal-data-reporting API) is still a spike per docs/03 §7 — resolve before claiming a
  specific erasure *mechanism* to Atlassian's reviewers; the *behavior* (records retained,
  `[deleted user]` rendering) is already implemented and can be claimed today.
