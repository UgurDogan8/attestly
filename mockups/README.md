# Read Confirmation — HTML mockups

**`index.html` — one self-contained file, no build, no dependencies. Double-click to open.**

Interactive mockups of every surface in the [UX flows doc](../docs/04_read_confirm_ux_flows.md),
styled with the Atlassian Design System's design tokens (colors, lozenges, section messages,
tables, tabs, modals hand-inlined as CSS variables). All data is fake; there is no backend.

> The real app's UI will be built with actual `@atlaskit/*` React components (company standard);
> this file mirrors their look for design review purposes only. The i18n catalogs inside it are
> the template for `packages/shared/i18n/{en,tr}.ts` in M1 (UX doc §6).

## Coverage

| Screen | UX doc | Interactions |
|---|---|---|
| Macro (reader) | §2.1 | R1→R2→R3 confirm flow (pessimistic UI), state selector R1–R7, storage-failure toggle |
| Byline item | §2.2 | Three chip states; click opens the dialog with the confirm action |
| Assignment config | §3.1 | Modal (auto-opens like `openOnInsert`): user/group chip pickers, due date + reconfirm (v1.1-tagged), voluntary-mode notice when empty |
| Dashboard | §3.2, §3.4 | Working space/status filters, progress bars, overdue marker, voluntary "—" tooltip, deleted-page row, empty-state toggle, export dialog with fake progress |
| Page drill-down | §3.3 | Tabs with counts, expired tooltip, deleted-group badge, cannot-view hint, history log |
| Settings | §3.5 | Managers group, defaults, export-all, data-lifecycle warning |

## Theme & language

Sidebar switchers: **Theme** = Light / Dark / Match system (ADS token values for both modes,
`prefers-color-scheme` listener in auto). **Language** = English / Türkçe — every string is in
the `MESSAGES` catalogs; dates localize via `Intl.DateTimeFormat`.

## Deep links (reviews & screenshots)

```
index.html?theme=dark&locale=tr#dashboard
```
`theme` = light|dark|auto · `locale` = en|tr · hash = macro|byline|config|dashboard|detail|settings

Headless screenshots:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --window-size=1280,900 --virtual-time-budget=4000 --screenshot=shot.png \
  "file:///…/mockups/index.html?theme=dark&locale=tr#dashboard"
```
