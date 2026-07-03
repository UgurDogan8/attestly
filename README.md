# Acknowledge for Confluence (Read Confirmation)

Forge app for Confluence Cloud: assign pages to users/groups, collect "I have read and
understood this page" confirmations, and export the audit trail. No external egress,
no content write scopes in v1.

## Documentation

Everything is under [`docs/`](docs/): product brief, PRD, [tech design](docs/02_read_confirm_tech_design.md)
(§11 = validated spike findings — read before coding), [data model](docs/03_read_confirm_data_model.md)
(the audit record is the product), UX flows, test plan, and the
[developer task list](docs/06_developer_task_list.md) (T1–T15, Jira import CSV alongside).
Visual + copy reference: open [`mockups/index.html`](mockups/index.html) in a browser.

## Layout (tech design §3)

```
manifest.yml          4 Confluence modules on ONE multi-entry resource; KVS entities
src/                  Forge backend: resolvers/ (thin) · domain/ (pure) · storage/ · events/ (v1.1)
static/app/           Custom UI — one Vite multi-page build → build/ (the manifest resource path)
packages/shared/      types (invoke contract) + i18n catalogs (en/tr) — the only import bridge
```

## Development

Requires **Node 22** (`nvm use`) and **Forge CLI ≥ 13** (`npm i -g @forge/cli`).

```bash
npm install                 # all workspaces
npm run typecheck           # backend + shared + app
npm run build               # static/app → static/app/build (required before deploy)
forge lint
```

First-time setup (once, owner account apps-product@kostebekteknoloji.com):

```bash
forge register "Acknowledge for Confluence" -s 8eca4ef7-8bd7-4215-808d-499c319fde7c  # Köstebek Teknoloji space; rewrites app.id
forge deploy -e development
forge install --site kostebekteknoloji.atlassian.net --product confluence -e development
```

## Hard rules (spike-validated — see tech design §11)

- **Never add a webtrigger module** — it alone revokes Runs on Atlassian eligibility (§7).
- **Assignment data never goes into page ADF** — config modal saves via `invoke('saveConfig')` to KVS (§11.6).
- **`confirmation` / `config-audit` are append-only**; status is computed, never stored (data model §1, §7).
- **Scope changes are major versions** — don't touch `permissions.scopes` casually (§11.5; snapshot-tested from T14).
- All UI strings via `packages/shared/i18n` (en + tr); Atlaskit + design tokens only.
