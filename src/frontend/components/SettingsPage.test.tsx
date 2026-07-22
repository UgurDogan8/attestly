import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Button, LoadingButton, Select, UserPicker } from '@forge/react';
import { SettingsPage } from './SettingsPage';

jest.mock('@forge/bridge', () => ({
  view: { getContext: jest.fn() },
  invoke: jest.fn(),
  router: { navigate: jest.fn(), getUrl: jest.fn() },
  NavigationTarget: { Module: 'module' },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bridge = require('@forge/bridge') as {
  view: { getContext: jest.Mock };
  invoke: jest.Mock;
  router: { navigate: jest.Mock; getUrl: jest.Mock };
};

const EXPORT_PAGE_URL = 'https://example.atlassian.net/wiki/apps/app-id/env-id/read-confirmations-export';

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
  bridge.router.getUrl.mockResolvedValue(new URL(EXPORT_PAGE_URL));
});

function settingsData(overrides: Record<string, unknown> = {}) {
  return {
    complianceManagersGroupIds: [],
    complianceManagersGroupOptions: [],
    complianceManagersUserIds: [],
    reconfirmDefault: false,
    ...overrides,
  };
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
  it('renders the configured manager groups and users', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: settingsData({
        complianceManagersGroupIds: ['g1'],
        complianceManagersGroupOptions: [{ id: 'g1', name: 'compliance-team' }],
        complianceManagersUserIds: ['acc-1'],
      }),
    });
    const renderer = await mount();

    const select = renderer.root.findByType(Select);
    expect(select.props.defaultValue).toEqual([{ label: 'compliance-team', value: 'g1' }]);

    const userPicker = renderer.root.findByType(UserPicker);
    expect(userPicker.props.defaultValue).toEqual(['acc-1']);
  });

  it('no defaultValue selections when nothing is configured yet', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: settingsData() });
    const renderer = await mount();
    expect(renderer.root.findByType(Select).props.defaultValue).toEqual([]);
    expect(renderer.root.findByType(UserPicker).props.defaultValue).toEqual([]);
  });

  it('no "Defaults for new configurations" section is rendered (removed 2026-07-22 — no v1 code path reads it)', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: settingsData() });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).not.toContain('Defaults for new configurations');
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
  it('saves the selected users and groups and shows a confirmation on success', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Select).props.onChange([{ label: 'compliance-team', value: 'g1' }]);
    });
    await act(async () => {
      renderer.root.findByType(UserPicker).props.onChange([{ id: 'acc-1', name: 'Ayşe' }]);
    });

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: settingsData({
        complianceManagersGroupIds: ['g1'],
        complianceManagersGroupOptions: [{ id: 'g1', name: 'compliance-team' }],
        complianceManagersUserIds: ['acc-1'],
      }),
    });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('saveSettings', {
      complianceManagersGroupIds: ['g1'],
      complianceManagersUserIds: ['acc-1'],
      reconfirmDefault: false,
    });
    expect(extractText(renderer.toJSON())).toContain('Settings saved.');
  });

  it('clearing all managers saves empty arrays', async () => {
    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: settingsData({
        complianceManagersGroupIds: ['g1'],
        complianceManagersGroupOptions: [{ id: 'g1', name: 'compliance-team' }],
      }),
    });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Select).props.onChange(null);
    });

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: settingsData() });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('saveSettings', {
      complianceManagersGroupIds: [],
      complianceManagersUserIds: [],
      reconfirmDefault: false,
    });
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
      await Promise.resolve();
    });
    expect(bridge.router.getUrl).toHaveBeenCalledWith({ target: 'module', moduleKey: 'acknowledge-export', spaceKey: undefined });
    expect(bridge.router.navigate).toHaveBeenCalledWith(EXPORT_PAGE_URL);
  });
});
