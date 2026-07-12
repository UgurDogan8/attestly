import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Button, LoadingButton, Select, Toggle } from '@forge/react';
import { SettingsPage } from './SettingsPage';

jest.mock('@forge/bridge', () => ({
  view: { getContext: jest.fn() },
  invoke: jest.fn(),
  router: { navigate: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require('@forge/bridge') as {
  view: { getContext: jest.Mock };
  invoke: jest.Mock;
  router: { navigate: jest.Mock };
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
    const { props, children } = node as {
      props?: { title?: unknown; content?: unknown; header?: unknown; description?: unknown };
      children?: unknown;
    };
    const title = typeof props?.title === 'string' ? props.title : '';
    const header = typeof props?.header === 'string' ? props.header : '';
    const content = props && 'content' in props ? extractText(props.content) : '';
    const description = props && 'description' in props ? extractText(props.description) : '';
    return title + header + content + description + extractText(children);
  }
  return '';
}

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SettingsPage />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view.getContext.mockResolvedValue({ locale: 'en' });
});

function settingsData(overrides: Record<string, unknown> = {}) {
  return { complianceManagersGroupId: null, complianceManagersGroupName: null, reconfirmDefault: false, ...overrides };
}

describe('SettingsPage — access gates', () => {
  it('shows the no-access EmptyState when forbidden', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'nope' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('You need Confluence admin access');
  });

  it('shows a typed error for a non-FORBIDDEN failure', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'INTERNAL_ERROR', message: 'boom' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('boom');
  });
});

describe('SettingsPage — loaded state', () => {
  it('renders the configured managers group and the reconfirm default, disabled', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: settingsData({ complianceManagersGroupId: 'g1', complianceManagersGroupName: 'compliance-team', reconfirmDefault: true }),
    });
    const renderer = await mount();

    const select = renderer.root.findByType(Select);
    expect(select.props.defaultValue).toEqual({ label: 'compliance-team', value: 'g1' });

    const toggle = renderer.root.findByType(Toggle);
    expect(toggle.props.isDisabled).toBe(true);
    expect(toggle.props.isChecked).toBe(true);
  });

  it('no defaultValue on the group Select when nothing is configured yet', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: settingsData() });
    const renderer = await mount();
    expect(renderer.root.findByType(Select).props.defaultValue).toBeUndefined();
  });
});

describe('SettingsPage — group search (debounced)', () => {
  it('searches groups without a pageId after the debounce window', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    const renderer = await mount();
    const callsBefore = bridge.invoke.mock.calls.length;

    await act(async () => {
      renderer.root.findByType(Select).props.onInputChange('comp');
    });
    expect(bridge.invoke.mock.calls.length).toBe(callsBefore);

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: [{ id: 'g1', name: 'compliance-team' }] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(bridge.invoke).toHaveBeenCalledWith('searchGroups', { query: 'comp' });
  });
});

describe('SettingsPage — save', () => {
  it('saves the selected group and shows a confirmation on success', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Select).props.onChange({ label: 'compliance-team', value: 'g1' });
    });

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: settingsData({ complianceManagersGroupId: 'g1', complianceManagersGroupName: 'compliance-team' }),
    });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('saveSettings', { complianceManagersGroupId: 'g1', reconfirmDefault: false });
    expect(extractText(renderer.toJSON())).toContain('Settings saved.');
  });

  it('clearing the group saves null', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData({ complianceManagersGroupId: 'g1', complianceManagersGroupName: 'compliance-team' }) });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Select).props.onChange(null);
    });

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('saveSettings', { complianceManagersGroupId: null, reconfirmDefault: false });
  });

  it('shows an error message when save fails', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN', message: 'no longer allowed' });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
    });

    expect(extractText(renderer.toJSON())).toContain('no longer allowed');
  });
});

describe('SettingsPage — export all data (revised post-PR-review to the Custom UI export surface)', () => {
  it('clicking Export all data navigates to the export page, site-scoped', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: settingsData() });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Button).props.onClick();
    });
    expect(bridge.router.navigate).toHaveBeenCalledWith('read-confirmations-export');
  });
});
