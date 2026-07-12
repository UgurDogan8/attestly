# Attestly (Read Confirmation for Confluence)

Forge app for Confluence Cloud: assign pages to users/groups, collect "I have read and
understood this page" confirmations, and export the audit trail. No external egress to any
third party, no content write scopes in v1.

## Documentation

Everything is under [`docs/`](docs/). `docs/00`–`06` are the original product/tech design
(product brief, PRD, [tech design](docs/02_read_confirm_tech_design.md) §11 = validated spike
findings, [data model](docs/03_read_confirm_data_model.md) — the audit record is the product,
UX flows, test plan, [developer task list](docs/06_developer_task_list.md) T1–T15).
[`docs/07`](docs/07_uikit_architecture_plan.md) is the **normative delta for this codebase**:
Custom UI → **UI Kit**, Vitest → **Jest**, and (§5, revised post-PR-review) export's design —
one small Custom UI download surface calling the same resolver as everything else, no webtrigger.
Read it first, it overrides `docs/02`/`docs/06` wherever they disagree.
[`docs/08`](docs/08_test_cases.md) holds Given/When/Then acceptance test cases.
[`docs/09`](docs/09_deploy_procedure.md)–[`12`](docs/12_marketplace_listing_copy.md) are the T14/T15
release docs: deploy procedure, security statement, privacy policy, Marketplace listing copy.
Visual + copy reference: open [`mockups/index.html`](mockups/index.html) in a browser.

## Layout (docs/07 §2)

```
manifest.yml          4 UI Kit modules (render: native) + 1 Custom UI module (export); KVS entities
src/
  index.ts            Resolver() + registerResolvers → export handler
  resolvers/           thin request handlers (three-tier auth, docs/02 §4)
  domain/               PURE — no @forge/* imports; status, csv, pdf, export row logic
  storage/               typed KVS custom-entity accessors, cursor pagination
  events/                 v1.1 only (page-updated trigger, reminders)
  frontend/              UI Kit surfaces: macro / byline / dashboard / settings (.tsx)
  shared/                 types (invoke contract) + i18n catalogs (en/tr)
static/export-ui/      the one Custom UI surface — export's download UI (docs/07 §5)
```

No `packages/`, no build step for the UI Kit surfaces — `.tsx` resources are bundled directly by
the Forge CLI at deploy time. `static/export-ui/` is the one deliberate exception (docs/07 §5): a
small Vite project, because triggering a real browser download is the one thing UI Kit can't do.

## Development

Requires **Node 22** (`nvm use`) and **Forge CLI ≥ 13** (`npm i -g @forge/cli`).

```bash
npm install
npm run lint            # eslint
npm run typecheck       # tsc --noEmit
npm test                # jest
npm run test:coverage   # jest --coverage (gate: domain 95% branches, overall 80% lines)

# static/export-ui/ is a separate Vite project (docs/07 §5) — forge lint and
# forge deploy both need its build output present.
npm ci --prefix static/export-ui
npm run build --prefix static/export-ui

forge lint
```

First-time setup (once, under **your own** Atlassian developer account — the `app.id` in
`manifest.yml` was inherited from the reference scaffold and must be re-registered before the
first deploy, see the TODO comment in `manifest.yml`):

```bash
forge register "Attestly"     # rewrites app.id in manifest.yml
forge deploy -e development
forge install --site <your-site>.atlassian.net --product confluence -e development
```

## Hard rules

- **Assignment data never goes into page ADF** — the macro has no `config:` block; assignment
  is a UI Kit `Modal` that saves via `invoke('saveConfig')` to KVS (docs/07 §4.3).
- **`confirmation` / `config-audit` are append-only**; status is computed, never stored
  (data model §1, §7).
- **Scope changes are major versions** — don't touch `permissions.scopes` casually
  (snapshot-tested from T14).
- **No webtriggers** — every feature, including export, goes through the normal `asUser`
  resolver + `invoke()` path (docs/07 §5, §9 #6). There is no separate token, secret, or
  standalone URL anywhere in this app. Do not add one without updating docs/07 §1/§5/§9 and
  the CI guard (T14, `src/release/manifest.test.ts`'s TC-H2 — it currently asserts zero).
- All UI strings via `src/shared/i18n` (en + tr); Atlaskit + design tokens only.
