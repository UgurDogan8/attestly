import { invoke, view } from '@forge/bridge';
import { createTranslator, resolveLocale } from '../../../src/shared/i18n';
import type { Translator } from '../../../src/shared/i18n';
import type { ExportFilePayload, ExportFileResponse, ExportFormat, ExportScope, StatusFilter, Result } from '../../../src/shared/types';

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
 */

const params = new URLSearchParams(window.location.search);
const fixedPageId = params.get('pageId') ?? undefined;
const initialSpaceKey = params.get('spaceKey') ?? undefined;

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

function render(t: Translator): void {
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

  const status = el('p', { id: 'status' });
  const startButton = el('button', { id: 'start', textContent: t('export.start') });

  function scopeRow(): HTMLElement {
    if (fixedPageId) {
      return el('p', {}, [t('export.scope.page')]);
    }
    return el('div', {}, [
      el('label', { textContent: t('export.scope') }),
      scopeSelect,
      spaceKeyInput,
    ]);
  }

  function updateSpaceFieldVisibility(): void {
    spaceKeyInput.style.display = !fixedPageId && scopeSelect.value === 'space' ? '' : 'none';
  }
  scopeSelect.addEventListener('change', updateSpaceFieldVisibility);
  updateSpaceFieldVisibility();

  startButton.addEventListener('click', () => {
    void handleExport();
  });

  async function handleExport(): Promise<void> {
    startButton.setAttribute('disabled', 'true');
    status.textContent = t('export.progress');

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
      startButton.removeAttribute('disabled');
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      downloadResponse(result.data);
      status.textContent = t('export.ready');
    } catch (thrown) {
      startButton.removeAttribute('disabled');
      status.textContent = thrown instanceof Error ? thrown.message : t('export.progress');
    }
  }

  app.append(
    el('h1', { textContent: t('export.title') }),
    el('div', {}, [el('label', { textContent: t('export.format') }), formatSelect]),
    scopeRow(),
    el('div', {}, [el('label', { textContent: t('export.statusFilter') }), statusSelect]),
    el('div', {}, [el('label', { textContent: t('export.dateRange') }), dateFromInput, dateToInput]),
    startButton,
    status,
  );
}

view
  .getContext()
  .then((context) => render(createTranslator(resolveLocale(context?.locale))))
  .catch(() => render(createTranslator('en')));
