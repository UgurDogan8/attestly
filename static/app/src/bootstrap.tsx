import React from 'react';
import ReactDOM from 'react-dom/client';
import { catalogs } from '@acknowledge/shared';

/**
 * Placeholder bootstrap proving the static/app ↔ packages/shared boundary.
 * TODO(T5): IntlProvider (locale from view.getContext), setGlobalTheme,
 * shared useInvoke hook with the Result<T> envelope.
 */
export function mount(surface: string): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
        <strong>{catalogs.en['dashboard.title']}</strong> — {surface} surface placeholder
      </div>
    </React.StrictMode>
  );
}
