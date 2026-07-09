import { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import { createTranslator, resolveLocale, type Locale, type Translator } from '../../shared';

export interface I18n {
  t: Translator;
  locale: Locale;
}

const DEFAULT_LOCALE: Locale = 'en';

/**
 * Resolves the viewer's Confluence locale via `view.getContext()` and
 * returns a bound translator (docs/07 §4: no react-intl needed — a tiny
 * `t(key, vars)` over the catalog). Theming needs no equivalent hook here:
 * UI Kit components are native Confluence controls and already render in
 * the correct light/dark theme with zero app-side wiring — `@forge/react`'s
 * own `useTheme()` exists only for app logic that needs to *know* the
 * current theme, not for making components look right.
 *
 * Starts at the English catalog (a safe, always-valid default) and switches
 * once the real locale resolves — there is no synchronous way to know the
 * viewer's locale before the first render.
 */
export function useI18n(): I18n {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let cancelled = false;
    view.getContext().then((context) => {
      if (!cancelled) {
        setLocale(resolveLocale(context?.locale));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { t: createTranslator(locale), locale };
}
