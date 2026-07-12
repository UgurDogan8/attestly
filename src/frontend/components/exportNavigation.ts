import { router } from '@forge/bridge';

export interface ExportNavigationParams {
  /** Fixes the export scope to one page (opened from the T10 drill-down). */
  pageId?: string;
  /** Pre-fills the space-scope field from the dashboard's current space filter. */
  spaceKey?: string;
}

/**
 * Opens the Custom UI export surface (`static/export-ui/`, docs/07 §5,
 * post-PR-review revision) — the one place in this app that can trigger a
 * real browser download. UI Kit has no Blob/DOM download API, so "Export"
 * always leaves the UI Kit surface entirely rather than opening an in-page
 * dialog; the export scope is handed over as a query param on the route
 * declared for the `acknowledge-export` module in manifest.yml (a Forge
 * `route:` value must match `^[a-z0-9-]+$` — no `/` — confirmed against the
 * installed `@forge/manifest` JSON schema this session, hence the flat
 * `read-confirmations-export` slug rather than a nested path).
 *
 * UNVERIFIED AGAINST A LIVE SITE (this project's standing convention, tech
 * design §11): passing the route as a bare string (with query params
 * appended) to `@forge/bridge`'s `router.navigate(location: string |
 * NavigationLocation)` is believed correct per the installed type
 * definitions but hasn't been exercised against a real Confluence site in
 * this session — verify on the next real deploy-and-test pass. If it
 * doesn't resolve, the typed `{ target: NavigationTarget.Module, moduleKey,
 * spaceKey }` form is the documented fallback for the space/site cases (it
 * has no slot for `pageId`, which is why the bare-string form was chosen
 * here — one code path for all three scopes).
 */
export function openExportPage(params: ExportNavigationParams = {}): void {
  const query = new URLSearchParams();
  if (params.pageId) {
    query.set('pageId', params.pageId);
  }
  if (params.spaceKey) {
    query.set('spaceKey', params.spaceKey);
  }
  const qs = query.toString();
  void router.navigate(`read-confirmations-export${qs ? `?${qs}` : ''}`);
}
