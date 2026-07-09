import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LoadingButton } from '@forge/react';
import { Macro } from './Macro';

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

async function mountMacro(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Macro />);
    // Flush the getContext().then(...) microtask chain queued by mount.
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

describe('Macro — unsupported content type', () => {
  it('shows a short message when placed on non-page content, without calling getPageStatus', async () => {
    bridge.view.getContext.mockResolvedValue({
      locale: 'en',
      extension: { content: { id: 'blog-1', type: 'blogpost' } },
    });
    const renderer = await mountMacro();
    expect(extractText(renderer.toJSON())).toContain('Read confirmation only supports Confluence pages.');
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it('shows the same message when extension.content is missing entirely', async () => {
    bridge.view.getContext.mockResolvedValue({ locale: 'en', extension: {} });
    const renderer = await mountMacro();
    expect(extractText(renderer.toJSON())).toContain('Read confirmation only supports Confluence pages.');
  });
});

describe('Macro — getPageStatus failure', () => {
  it('shows a typed error message', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'PAGE_READ_FAILED', message: 'nope' });
    const renderer = await mountMacro();
    expect(extractText(renderer.toJSON())).toContain('nope');
  });
});

describe('Macro — R1 required, happy path load', () => {
  it('fetches status for the current page and renders the required block', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { status: 'outstanding', pageVersion: 3, dueDate: null, isAssigned: true, confirmedAt: null },
    });
    const renderer = await mountMacro();
    expect(bridge.invoke).toHaveBeenCalledWith('getPageStatus', { pageId: 'page-1' });
    expect(extractText(renderer.toJSON())).toContain('Read confirmation required');
  });
});

describe('Macro — confirm flow (R2 -> R3, pessimistic)', () => {
  it('clicking confirm calls the confirm resolver with the server-read version and shows R3 on success', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: 5, dueDate: null, isAssigned: true, confirmedAt: null },
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

    const renderer = await mountMacro();
    const button = renderer.root.findByType(LoadingButton);

    await act(async () => {
      button.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('confirm', { pageId: 'page-1', pageVersion: 5 });
    expect(extractText(renderer.toJSON())).toContain('Confirmed');
  });

  it('a confirm failure shows R6 with the button re-enabled, never confirmed', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: 1, dueDate: null, isAssigned: true, confirmedAt: null },
        });
      }
      return Promise.resolve({
        ok: false,
        code: 'CONFIRM_FAILED',
        message: "We couldn't record your confirmation. Please try again.",
      });
    });

    const renderer = await mountMacro();
    const button = renderer.root.findByType(LoadingButton);

    await act(async () => {
      button.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = extractText(renderer.toJSON());
    expect(text).not.toContain('Confirmed');
    expect(renderer.root.findByType(LoadingButton).props.isLoading).toBe(false);
  });

  it('a version mismatch (pageChanged) writes nothing and shows the reload prompt', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: 3, dueDate: null, isAssigned: true, confirmedAt: null },
        });
      }
      if (functionKey === 'confirm') {
        return Promise.resolve({ ok: true, data: { outcome: 'pageChanged', currentVersion: 4 } });
      }
      throw new Error(`unexpected functionKey ${functionKey}`);
    });

    const renderer = await mountMacro();
    const button = renderer.root.findByType(LoadingButton);

    await act(async () => {
      button.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(extractText(renderer.toJSON())).toContain('This page was just updated');
  });

  it('reload after pageChanged re-fetches status and returns to R1', async () => {
    let confirmCalls = 0;
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getPageStatus') {
        return Promise.resolve({
          ok: true,
          data: { status: 'outstanding', pageVersion: confirmCalls > 0 ? 4 : 3, dueDate: null, isAssigned: true, confirmedAt: null },
        });
      }
      if (functionKey === 'confirm') {
        confirmCalls += 1;
        return Promise.resolve({ ok: true, data: { outcome: 'pageChanged', currentVersion: 4 } });
      }
      throw new Error(`unexpected functionKey ${functionKey}`);
    });

    const renderer = await mountMacro();
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(extractText(renderer.toJSON())).toContain('This page was just updated');

    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick(); // the reload button
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = extractText(renderer.toJSON());
    expect(text).toContain('Read confirmation required');
    expect(text).not.toContain('This page was just updated');
  });
});
