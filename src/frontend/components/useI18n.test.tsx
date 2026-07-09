import React from 'react';
import { act, create } from 'react-test-renderer';
import { useI18n, type I18n } from './useI18n';

jest.mock('@forge/bridge', () => ({
  view: { getContext: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { view } = require('@forge/bridge') as { view: { getContext: jest.Mock } };

function TestComponent({ onResult }: { onResult: (i18n: I18n) => void }): null {
  const i18n = useI18n();
  onResult(i18n);
  return null;
}

async function renderAndCapture(): Promise<I18n | undefined> {
  let captured: I18n | undefined;
  await act(async () => {
    create(
      <TestComponent
        onResult={(i18n) => {
          captured = i18n;
        }}
      />,
    );
  });
  return captured;
}

describe('useI18n', () => {
  it('starts with the English catalog before context resolves', async () => {
    view.getContext.mockReturnValue(new Promise(() => {})); // never resolves within this test
    const i18n = await renderAndCapture();
    expect(i18n?.locale).toBe('en');
    expect(i18n?.t('common.save')).toBe('Save');
  });

  it('switches to the resolved locale once view.getContext() resolves', async () => {
    view.getContext.mockResolvedValue({ locale: 'tr-TR' });
    const i18n = await renderAndCapture();
    expect(i18n?.locale).toBe('tr');
    expect(i18n?.t('common.save')).toBe('Kaydet');
  });

  it('falls back to en for a locale not in the catalogs', async () => {
    view.getContext.mockResolvedValue({ locale: 'de-DE' });
    const i18n = await renderAndCapture();
    expect(i18n?.locale).toBe('en');
  });

  it('t() interpolates vars through the resolved locale', async () => {
    view.getContext.mockResolvedValue({ locale: 'en' });
    const i18n = await renderAndCapture();
    expect(i18n?.t('macro.due', { date: '15 Aug 2026' })).toBe('Due: 15 Aug 2026');
  });
});
