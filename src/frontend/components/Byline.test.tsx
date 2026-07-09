import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LoadingButton } from '@forge/react';
import { Byline } from './Byline';

jest.mock('@forge/bridge', () => ({
  view: { getContext: jest.fn() },
  invoke: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require('@forge/bridge') as {
  view: { getContext: jest.Mock };
  invoke: jest.Mock;
};

function extractText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if (typeof node === 'object') {
    const { props, children } = node as { props?: { title?: unknown }; children?: unknown };
    const title = typeof props?.title === 'string' ? props.title : '';
    return title + extractText(children);
  }
  return '';
}

const PAGE_CONTEXT = { locale: 'en', extension: { content: { id: 'page-1', type: 'page' } } };

async function mountByline(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Byline />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view.getContext.mockResolvedValue(PAGE_CONTEXT);
});

describe('Byline dialog (UX doc §2.2 — reuses the macro status/confirm components)', () => {
  it('renders the required block for an outstanding, assigned viewer', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { status: 'outstanding', pageVersion: 3, dueDate: null, isAssigned: true, confirmedAt: null, canConfigure: false },
    });
    const renderer = await mountByline();
    expect(extractText(renderer.toJSON())).toContain('Read confirmation required');
  });

  it('never shows a Configure button (UX doc §2.2 -- configuring is not a dialog action)', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { status: 'outstanding', pageVersion: 1, dueDate: null, isAssigned: true, confirmedAt: null, canConfigure: true },
    });
    const renderer = await mountByline();
    expect(extractText(renderer.toJSON())).not.toContain('Configure read confirmation');
  });

  it('a confirm from the dialog calls the exact same confirm resolver the macro uses', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: 5, dueDate: null, isAssigned: true, confirmedAt: null, canConfigure: false },
        });
      }
      if (functionKey === 'confirm') {
        return Promise.resolve({
          ok: true,
          data: { outcome: 'confirmed', status: 'confirmed', pageVersion: 5, confirmedAt: '2026-07-12T11:03:00.000Z' },
        });
      }
      throw new Error(`unexpected functionKey ${functionKey}`);
    });

    const renderer = await mountByline();
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('confirm', { pageId: 'page-1', pageVersion: 5 });
    expect(extractText(renderer.toJSON())).toContain('Confirmed');
  });

  it('shows the pageChanged (R7) prompt when confirm detects a version mismatch', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: 3, dueDate: null, isAssigned: true, confirmedAt: null, canConfigure: false },
        });
      }
      if (functionKey === 'confirm') {
        return Promise.resolve({ ok: true, data: { outcome: 'pageChanged', currentVersion: 4 } });
      }
      throw new Error(`unexpected functionKey ${functionKey}`);
    });

    const renderer = await mountByline();
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(extractText(renderer.toJSON())).toContain('This page was just updated');
  });

  it('shows a typed error message when getPageStatus fails', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'PAGE_READ_FAILED', message: 'nope' });
    const renderer = await mountByline();
    expect(extractText(renderer.toJSON())).toContain('nope');
  });

  it('shows the unsupported-content-type message on non-page content', async () => {
    bridge.view.getContext.mockResolvedValue({ locale: 'en', extension: { content: { id: 'blog-1', type: 'blogpost' } } });
    const renderer = await mountByline();
    expect(extractText(renderer.toJSON())).toContain('Read confirmation only supports Confluence pages.');
  });
});
