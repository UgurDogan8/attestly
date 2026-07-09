import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LinkButton, LoadingButton, Select, Textfield } from '@forge/react';
import { ExportDialog } from './ExportDialog';

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

async function mount(props: Parameters<typeof ExportDialog>[0]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ExportDialog {...props} />);
    await Promise.resolve();
  });
  return renderer;
}

/** Footer order is always Close, then Export-or-download -- the second LoadingButton is always "Export". */
function exportButton(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(LoadingButton)[1];
}

/** Select order is always Format, then (when shown) Scope, then Status. */
function scopeSelect(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(Select)[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view.getContext.mockResolvedValue({ locale: 'en' });
});

describe('ExportDialog — scope selection', () => {
  it('site scope by default: starting the export sends scope "site" with no scopeValue', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export?job=t&k=s' } });
    const renderer = await mount({ onClose: jest.fn() });

    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith(
      'startExport',
      expect.objectContaining({ format: 'csv', scope: 'site', scopeValue: undefined }),
    );
  });

  it('switching to space scope and typing a key sends that scopeValue', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export' } });
    const renderer = await mount({ onClose: jest.fn() });

    await act(async () => {
      scopeSelect(renderer).props.onChange({ label: 'Space', value: 'space' });
    });
    await act(async () => {
      renderer.root.findByType(Textfield).props.onChange('SEC');
    });
    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('startExport', expect.objectContaining({ scope: 'space', scopeValue: 'SEC' }));
  });

  it('fixedPageScope: no scope Select rendered, and export always uses scope "page" with that pageId', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export' } });
    const renderer = await mount({ onClose: jest.fn(), fixedPageScope: { pageId: 'page-1', pageTitle: 'Security Policy' } });

    expect(renderer.root.findAllByType(Select)).toHaveLength(2); // format + status Select, no scope Select
    expect(extractText(renderer.toJSON())).toContain('Security Policy');

    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('startExport', expect.objectContaining({ scope: 'page', scopeValue: 'page-1' }));
  });

  it('defaultSpaceKey pre-fills the space field once the user switches to space scope', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export' } });
    const renderer = await mount({ onClose: jest.fn(), defaultSpaceKey: 'HR' });

    await act(async () => {
      scopeSelect(renderer).props.onChange({ label: 'Space', value: 'space' });
    });
    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('startExport', expect.objectContaining({ scopeValue: 'HR' }));
  });
});

describe('ExportDialog — format selection (T12)', () => {
  it('switching to PDF sends format "pdf" and labels the download button "Download PDF"', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export?job=t&k=s' } });
    const renderer = await mount({ onClose: jest.fn() });

    await act(async () => {
      renderer.root.findAllByType(Select)[0].props.onChange({ label: 'PDF', value: 'pdf' });
    });
    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('startExport', expect.objectContaining({ format: 'pdf' }));
    const downloadLink = renderer.root.findAllByType(LinkButton).find((b) => b.props.href);
    expect(downloadLink?.props.href).toBe('https://example.test/export?job=t&k=s');
    expect(extractText(renderer.toJSON())).toContain('Download PDF');
  });
});

describe('ExportDialog — result states', () => {
  it('shows a download LinkButton once startExport succeeds', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { url: 'https://example.test/export?job=t&k=s' } });
    const renderer = await mount({ onClose: jest.fn() });

    expect(renderer.root.findAllByType(LinkButton).filter((b) => b.props.href)).toHaveLength(0);
    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    const downloadLink = renderer.root.findAllByType(LinkButton).find((b) => b.props.href);
    expect(downloadLink?.props.href).toBe('https://example.test/export?job=t&k=s');
  });

  it('shows the error message and no download link when startExport fails', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'nope' });
    const renderer = await mount({ onClose: jest.fn() });

    await act(async () => {
      exportButton(renderer).props.onClick();
      await Promise.resolve();
    });

    expect(extractText(renderer.toJSON())).toContain('nope');
    expect(renderer.root.findAllByType(LinkButton).filter((b) => b.props.href)).toHaveLength(0);
  });
});

describe('ExportDialog — close', () => {
  it('calls onClose when the close button is clicked', async () => {
    const onClose = jest.fn();
    const renderer = await mount({ onClose });

    renderer.root.findAllByType(LoadingButton)[0].props.onClick();
    expect(onClose).toHaveBeenCalled();
  });
});
