import { router, NavigationTarget } from '@forge/bridge';

export interface ExportNavigationParams {
  /** Fixes the export scope to one page (opened from the T10 drill-down). */
  pageId?: string;
  /** Pre-fills the space-scope field from the dashboard's current space filter. */
  spaceKey?: string;
}

/** manifest.yml's `confluence:globalPage` key for the export Custom UI surface. */
const EXPORT_MODULE_KEY = 'acknowledge-export';

/**
 * Opens the Custom UI export surface (`static/export-ui/`, docs/07 §5,
 * post-PR-review revision) — the one place in this app that can trigger a
 * real browser download. UI Kit has no Blob/DOM download API, so "Export"
 * always leaves the UI Kit surface entirely rather than opening an in-page
 * dialog; the export scope is handed over as a query param on the resolved
 * URL.
 *
 * Verified live (2026-07-12): passing the bare route slug as a *string* to
 * `router.navigate()` does NOT work — `@forge/bridge`'s implementation sends
 * a string location straight through as `{ url: location }` with no
 * same-origin/relative handling, so Confluence's host bridge treats a
 * schemeless, slash-less string as a hostname and the browser ends up
 * trying to load `https://read-confirmations-export/` (a real, broken
 * navigation, confirmed against a live site — not a hypothetical). The
 * typed `NavigationLocation` form has no slot for `pageId`, so instead of
 * passing it directly to `navigate()`, `router.getUrl()` resolves the
 * *real* app URL (including the environment-specific app/env ids neither
 * this code nor the manifest can predict) as a `URL` object first, and the
 * scope params are appended to that resolved URL's own query string before
 * navigating — one resolution call handles the module lookup, `URL`'s own
 * `searchParams` handles the pageId/spaceKey scope that the typed location
 * shape can't carry.
 */
export async function openExportPage(params: ExportNavigationParams = {}): Promise<void> {
  const url = await router.getUrl({ target: NavigationTarget.Module, moduleKey: EXPORT_MODULE_KEY, spaceKey: params.spaceKey });
  if (!url) {
    return;
  }
  if (params.pageId) {
    url.searchParams.set('pageId', params.pageId);
  }
  if (params.spaceKey) {
    url.searchParams.set('spaceKey', params.spaceKey);
  }
  await router.navigate(url.toString());
}
