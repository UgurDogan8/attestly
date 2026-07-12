# 09 — Deploy procedure (staging → production)

T14 deliverable (docs/06 §T14, docs/07 §6). Companion to the CI release guards in
`src/release/manifest.test.ts` — read that file's docstring first; this doc is the human
procedure around what those tests automate.

## 0. One-time prerequisites (before the *first* deploy ever)

1. `forge register "Attestly"` under the **app owner's own** Atlassian account. `manifest.yml`'s
   `app.id` is currently inherited from the reference scaffold's spike registration
   (`kostebekteknoloji`) — `forge register` rewrites it. Do not deploy against someone else's
   registered app id.
2. `npm ci && npm run build` inside `static/export-ui/` — the one Custom UI surface (docs/07 §5,
   post-PR-review) needs its Vite build output present before `forge deploy`/`forge lint` can see
   the `export-ui` resource. (There used to be an `EXPORT_SECRET` env var to set here, for the
   export webtrigger's shared secret — the webtrigger was removed post-PR-review; there is no
   secret to configure for export anymore.)
3. CI secrets: `FORGE_EMAIL` / `FORGE_API_TOKEN` (an API token with deploy rights on the target
   environments), added to the GitHub repo's Actions secrets — needed only once automated
   staging/production deploy steps are added to `.github/workflows/ci.yml` (not yet wired up; see
   §4).

## 1. Before every deploy — what CI already gates

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

- `npm run lint`, `npm run typecheck`
- `npm run test:coverage` — includes the T14 release guards
  (`src/release/manifest.test.ts`): scope snapshot (TC-H1) and zero-webtrigger assertion
  (TC-H2), plus the domain 95% / global 80% coverage thresholds (`jest.config.js`)
- `npm ci`/`npm run build`/`npm run typecheck` inside `static/export-ui/`, then `forge lint`

A deploy should never be run from a branch where this pipeline is red. If `permissions.scopes`
changed and the scope-snapshot guard failed, that failure is doing its job — update the snapshot
(`npx jest -u src/release`) only after confirming the scope change is deliberate and re-reading
docs/07 §6, then commit the updated `.snap` file in the same PR. If `modules.webtrigger` ever
gains an entry, TC-H2 fails on purpose — this app has none by design (docs/07 §5).

## 2. Staging deploy

```
forge deploy -e staging
forge install --upgrade -e staging   # first time on a given site: forge install -e staging
```

Manual smoke check on the staging site before promoting further (docs/08 §H, manual-E2E items
not covered by Jest):

- **TC-H3** — fresh install prompts exactly the six scopes in docs/07 §6 (`storage:app`,
  `read:page:confluence`, `read:user:confluence`, `read:group:confluence`,
  `read:content.permission:confluence`, `read:content-details:confluence`) — no more, no fewer.
- **TC-H4** — uninstall → reinstall on the staging site: macro reopens to a fresh setup state, no
  crash, storage is empty (28-day soft-delete window noted in the uninstall copy,
  `settings.lifecycle.body`).
- Macro renders and confirms; dashboard loads; export (CSV and PDF) downloads and opens; settings
  page saves.

If `permissions.scopes` changed since the last production release, re-verify the Marketplace
security statement (docs/07 §6, docs/06 T15) still matches — site admins upgrading in production
will see Atlassian's own re-consent prompt for the diff.

## 3. Production deploy

Only after staging smoke checks pass:

```
forge deploy -e production
forge install --upgrade -e production
```

## 4. Rollback

Forge keeps prior deployed versions per environment:

```
forge deploy -e production --version <previous-version>
```

Use `forge deploy -e production --list` (or the Developer Console) to find the last-known-good
version number first.

## 5. What's deliberately not automated yet

- No CI step deploys to staging/production automatically on merge to `main` — deploys are run
  manually via the commands above until there's a real production install to protect. When that
  changes, wire `forge deploy -e staging` into a `main`-push job gated on `FORGE_EMAIL`/
  `FORGE_API_TOKEN` secrets (§0.3), and keep production deploys manual/approval-gated regardless.
- No `forge eligibility` / "Runs on Atlassian" CI gate — dropped on purpose (docs/07 §6). This app
  has zero webtriggers (docs/07 §5, post-PR-review) so the badge itself is no longer forfeited;
  TC-H2 is the guard that keeps it that way, failing CI the moment *any* webtrigger appears.
