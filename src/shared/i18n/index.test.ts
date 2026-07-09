import { resolveLocale, formatMessage, translate, createTranslator, catalogs } from './index';

describe('resolveLocale', () => {
  it('defaults to en when the Confluence locale is undefined', () => {
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('maps a supported language prefix regardless of region/case', () => {
    expect(resolveLocale('tr-TR')).toBe('tr');
    expect(resolveLocale('TR')).toBe('tr');
    expect(resolveLocale('tr')).toBe('tr');
  });

  it('falls back to en for an unsupported language', () => {
    expect(resolveLocale('de-DE')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
  });
});

describe('formatMessage', () => {
  it('returns the template unchanged when there are no vars', () => {
    expect(formatMessage('Save')).toBe('Save');
  });

  it('interpolates a single placeholder', () => {
    expect(formatMessage('Due: {date}', { date: '15 Aug 2026' })).toBe('Due: 15 Aug 2026');
  });

  it('interpolates multiple placeholders, including numbers', () => {
    expect(
      formatMessage('You confirmed version {version} on {datetime}.', { version: 7, datetime: '12 Jul 2026' }),
    ).toBe('You confirmed version 7 on 12 Jul 2026.');
  });

  it('leaves an unmatched placeholder as-is rather than silently dropping it', () => {
    expect(formatMessage('Due: {date}', {})).toBe('Due: {date}');
  });

  it('supports the same placeholder appearing more than once', () => {
    expect(formatMessage('{name} and {name} again', { name: 'X' })).toBe('X and X again');
  });
});

describe('translate / createTranslator', () => {
  it('translate resolves a key from the given locale', () => {
    expect(translate('en', 'common.save')).toBe('Save');
    expect(translate('tr', 'common.save')).toBe('Kaydet');
  });

  it('translate interpolates vars for the resolved locale', () => {
    expect(translate('en', 'macro.due', { date: '15 Aug 2026' })).toBe('Due: 15 Aug 2026');
    expect(translate('tr', 'macro.due', { date: '15 Ağu 2026' })).toBe('Son tarih: 15 Ağu 2026');
  });

  it('createTranslator binds a locale so callers omit it on every call', () => {
    const t = createTranslator('en');
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('macro.due', { date: '1 Jan' })).toBe('Due: 1 Jan');
  });

  it('the exact confirm-button copy is never shortened (UX §6 hard rule)', () => {
    expect(catalogs.en['macro.confirmButton']).toBe('I have read and understood this page');
    expect(catalogs.tr['macro.confirmButton']).toBe('Bu sayfayı okudum ve anladım');
  });
});

describe('catalog parity (both locales expose exactly the same keys)', () => {
  it('en and tr have identical key sets', () => {
    const enKeys = Object.keys(catalogs.en).sort();
    const trKeys = Object.keys(catalogs.tr).sort();
    expect(trKeys).toEqual(enKeys);
  });

  it('no catalog value is empty', () => {
    for (const catalog of Object.values(catalogs)) {
      for (const value of Object.values(catalog)) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
