import { invoke, view } from '@forge/bridge';
import { createTranslator, resolveLocale } from '../../../src/shared/i18n';
import type { Translator } from '../../../src/shared/i18n';
import type { ExportFilePayload, ExportFileResponse, ExportFormat, ExportScope, StatusFilter, Result } from '../../../src/shared/types';
import './style.css';

/**
 * The Custom UI export surface (docs/07 §5, post-PR-review revision) — the
 * one place in this app that isn't UI Kit. Deliberately framework-free
 * (no React: `@forge/react` is UI-Kit-only, and this page is one form plus
 * one async action, not worth a bundler-sized dependency). Its only two
 * jobs: call the `exportFile` resolver (the exact same resolver every other
 * surface in this app already uses via `invoke()` — no separate auth path,
 * no token, no webtrigger) and turn the bytes it returns into a real
 * browser download, which is the one thing UI Kit categorically cannot do.
 *
 * Scope is handed over via query params by `exportNavigation.ts`
 * (`src/frontend/components/`) — `pageId` fixes scope to "page" (opened
 * from the T10 drill-down), `spaceKey` pre-fills scope "space" (opened from
 * the dashboard's own space filter). Neither present -> defaults to "site"
 * (opened from Settings' "Export all data").
 *
 * Verified live (2026-07-12): those query params can't be read from this
 * document's own `window.location` — this Custom UI resource is rendered
 * in a cross-origin iframe whose `src` is Forge's own opaque, pre-built
 * `_ctx_...` CDN URL, which never carries the query string our own
 * `router.navigate()` call appended to the *top-level* Confluence page URL.
 * `window.location.search` inside this iframe only ever contains Forge's
 * own `platformFeatureFlags` param, confirmed empty of `pageId`/`spaceKey`
 * on a live site. The one place those params actually survive is
 * `view.getContext()`'s `extension.location` field, which Forge populates
 * with the *outer* page's full URL (confirmed live) — parsed below instead.
 *
 * `view.theme.enable()` (docs/07 §5 addendum, 2026-07-12 UI pass): this
 * iframe is cross-origin from the rest of Confluence, so it never inherits
 * Confluence's theme automatically the way UI Kit resources do. This makes
 * the host inject `@atlaskit/tokens`' `--ds-*` CSS custom properties to
 * match the viewer's actual Confluence theme (light/dark/auto, which can
 * differ from the OS theme) — `style.css` reads those tokens with plain
 * fallback values for the brief window before/if that stylesheet loads.
 */

void view.theme.enable();

/** `context.extension.location` (docs above) is the outer page's full URL, not this iframe's own. */
function readScopeParams(context: { extension?: { location?: unknown } } | undefined): { fixedPageId?: string; initialSpaceKey?: string } {
  const outerLocation = context?.extension?.location;
  if (typeof outerLocation !== 'string') {
    return {};
  }
  try {
    const search = new URL(outerLocation).searchParams;
    return { fixedPageId: search.get('pageId') ?? undefined, initialSpaceKey: search.get('spaceKey') ?? undefined };
  } catch {
    return {};
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function option(value: string, label: string): HTMLOptionElement {
  return el('option', { value, textContent: label });
}

/** Inline SVGs kept tiny and dependency-free, matching the "no build-heavy addition" rule above. */
const icons = {
  download: '<path d="M8 1v8.5M8 9.5 4.5 6M8 9.5 11.5 6M2 12h12" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M3 8.5 6.2 12 13 3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  alert:
    '<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 5v3.5M8 10.8v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
} as const;

function icon(name: keyof typeof icons): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.innerHTML = icons[name];
  return svg;
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadResponse(data: ExportFileResponse): void {
  if (data.format === 'csv') {
    triggerDownload(data.filename, new Blob([data.csv], { type: 'text/csv;charset=utf-8' }));
    return;
  }
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
  triggerDownload(data.filename, new Blob([bytes], { type: 'application/pdf' }));
}

function field(label: string, control: HTMLElement, opts: { full?: boolean } = {}): HTMLElement {
  return el('div', { className: opts.full ? 'field field--full' : 'field' }, [el('label', { textContent: label }), control]);
}

function render(t: Translator, fixedPageId: string | undefined, initialSpaceKey: string | undefined): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.replaceChildren();

  const formatSelect = el('select', { id: 'format' }, [option('csv', t('export.format.csv')), option('pdf', t('export.format.pdf'))]);

  const scopeSelect = el('select', { id: 'scope' }, [option('space', t('export.scope.space')), option('site', t('export.scope.site'))]);
  scopeSelect.value = initialSpaceKey ? 'space' : 'site';

  const spaceKeyInput = el('input', { id: 'spaceKey', type: 'text', value: initialSpaceKey ?? '', placeholder: t('export.spaceKey') });

  const statusSelect = el('select', { id: 'statusFilter' }, [
    option('all', t('dashboard.filter.status.all')),
    option('incomplete', t('dashboard.filter.status.incomplete')),
    option('complete', t('dashboard.filter.status.complete')),
    option('overdue', t('dashboard.filter.status.overdue')),
  ]);

  const dateFromInput = el('input', { id: 'dateFrom', type: 'date' });
  const dateToInput = el('input', { id: 'dateTo', type: 'date' });

  const statusText = el('span', {});
  const status = el('div', { id: 'status', className: 'export-status', role: 'status' }, [statusText]);
  const buttonIconSlot = el('span', { className: 'btn-icon' }, [icon('download')]);
  const startButton = el('button', { id: 'start', className: 'btn-primary' }, [buttonIconSlot, t('export.start')]);

  function setStatus(kind: 'idle' | 'progress' | 'success' | 'error', text: string): void {
    status.className = kind === 'success' ? 'export-status export-status--success' : kind === 'error' ? 'export-status export-status--error' : 'export-status';
    statusText.textContent = text;
    const existingIcon = status.querySelector('svg');
    existingIcon?.remove();
    if (kind === 'success') {
      status.prepend(icon('check'));
    } else if (kind === 'error') {
      status.prepend(icon('alert'));
    }
  }

  function setButtonBusy(busy: boolean): void {
    startButton.disabled = busy;
    buttonIconSlot.replaceChildren(busy ? el('span', { className: 'spinner' }) : icon('download'));
  }

  function scopeField(): HTMLElement {
    if (fixedPageId) {
      return field(t('export.scope'), el('div', { className: 'field-static', textContent: t('export.scope.page') }));
    }
    return field(t('export.scope'), el('div', {}, [scopeSelect, spaceKeyInput]));
  }

  function updateSpaceFieldVisibility(): void {
    spaceKeyInput.style.display = !fixedPageId && scopeSelect.value === 'space' ? '' : 'none';
    spaceKeyInput.style.marginTop = spaceKeyInput.style.display === 'none' ? '0' : '8px';
  }
  scopeSelect.addEventListener('change', updateSpaceFieldVisibility);
  updateSpaceFieldVisibility();

  startButton.addEventListener('click', () => {
    void handleExport();
  });

  async function handleExport(): Promise<void> {
    setButtonBusy(true);
    setStatus('progress', t('export.progress'));

    const scope: ExportScope = fixedPageId ? 'page' : (scopeSelect.value as ExportScope);
    const payload: ExportFilePayload = {
      format: formatSelect.value as ExportFormat,
      scope,
      scopeValue: fixedPageId ?? (scope === 'space' ? spaceKeyInput.value.trim() || undefined : undefined),
      statusFilter: statusSelect.value as StatusFilter,
      dateFrom: dateFromInput.value || undefined,
      dateTo: dateToInput.value || undefined,
    };

    try {
      // Legacy single-generic invoke() form (the type arg is the return
      // type) — same pattern and same "technically a {body,metadata} union"
      // caveat as src/frontend/components/useInvoke.ts.
      const result = (await invoke<Result<ExportFileResponse>>('exportFile', payload)) as Result<ExportFileResponse>;
      setButtonBusy(false);
      if (!result.ok) {
        setStatus('error', result.message);
        return;
      }
      downloadResponse(result.data);
      setStatus('success', t('export.ready'));
    } catch (thrown) {
      setButtonBusy(false);
      setStatus('error', thrown instanceof Error ? thrown.message : t('export.progress'));
    }
  }

  const header = el('div', { className: 'export-header' }, [
    el('div', { className: 'export-icon' }, [icon('download')]),
    el('div', { className: 'export-heading' }, [el('h1', { textContent: t('export.title') }), el('p', { textContent: t('export.subtitle') })]),
  ]);

  const grid = el('div', { className: 'field-grid' }, [
    field(t('export.format'), formatSelect),
    scopeField(),
    field(t('export.statusFilter'), statusSelect),
    field(
      t('export.dateRange'),
      el('div', { className: 'date-range' }, [dateFromInput, el('span', { className: 'date-sep', textContent: '–' }), dateToInput]),
      { full: true },
    ),
  ]);

  const card = el('div', { className: 'export-card' }, [grid, el('div', { className: 'export-actions' }, [startButton, status])]);

  app.append(el('div', { className: 'export-page' }, [header, card]));
}

/**
 * Bug found in review: `view.getContext()` rejecting used to fall through to
 * `render(t, undefined, undefined)` — the exact same form as opening Export
 * with no scope at all (Settings' "Export all data"). A manager who opened
 * this page from a *page* drill-down or a *space*-filtered dashboard would
 * see a normal-looking, fully working form with no indication that its
 * scope silently widened to "entire site" — they could export (and hand to
 * an auditor) far more data than intended without ever knowing why. Failing
 * the page instead of guessing is the safe default for a compliance export.
 */
function renderContextError(t: Translator): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  app.replaceChildren();

  const header = el('div', { className: 'export-header' }, [
    el('div', { className: 'export-icon' }, [icon('download')]),
    el('div', { className: 'export-heading' }, [el('h1', { textContent: t('export.title') })]),
  ]);
  const errorBox = el('div', { className: 'export-status export-status--error' }, [
    icon('alert'),
    el('span', { textContent: t('export.contextError') }),
  ]);
  const card = el('div', { className: 'export-card' }, [errorBox]);

  app.append(el('div', { className: 'export-page' }, [header, card]));
}

view
  .getContext()
  .then((context) => {
    const { fixedPageId, initialSpaceKey } = readScopeParams(context);
    render(createTranslator(resolveLocale(context?.locale)), fixedPageId, initialSpaceKey);
  })
  .catch(() => renderContextError(createTranslator('en')));
