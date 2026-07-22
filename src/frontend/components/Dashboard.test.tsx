import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Button, LinkButton, LoadingButton, Select, Textfield } from '@forge/react';
import { Dashboard } from './Dashboard';
import type { DashboardProps } from './Dashboard';
import type { DashboardRow } from '../../shared';

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

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    pageId: 'page-1',
    title: 'Security Policy',
    deleted: false,
    spaceKey: 'SEC',
    assignedCount: 4,
    percent: { kind: 'value', percent: 0.5, confirmedCount: 2, eligibleCount: 4 },
    dueDate: null,
    overdue: false,
    ...overrides,
  };
}

/** Disambiguates the status-filter Select from the page-search Select added 2026-07-22 (both render at once). */
function statusSelect(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(Select).find((s) => s.props.inputId !== 'trackPageSearch')!;
}

async function mount(props: DashboardProps = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Dashboard {...props} />);
    await Promise.resolve();
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

describe('Dashboard — access gates', () => {
  it('shows the no-access EmptyState when forbidden', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'nope' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('You need compliance-manager access');
  });

  it('shows a typed error for a non-FORBIDDEN failure', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'INTERNAL_ERROR', message: 'boom' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('boom');
  });
});

describe('Dashboard — empty states', () => {
  it('shows the onboarding EmptyState when unfiltered and there are zero tracked pages', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null } });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('Start tracking read confirmations');
  });
});

describe('Dashboard — row rendering', () => {
  it('renders a normal visible row with title, space, assigned count', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Security Policy');
    expect(text).toContain('SEC');
    expect(text).toContain('4');
  });

  it('shows a placeholder instead of a raw numeric spaceId when the space key never resolved', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row({ spaceKey: '327684' })], nextCursor: null } });
    const renderer = await mount();
    const text = extractText(renderer.toJSON());
    expect(text).not.toContain('327684');
    expect(text).toContain("Space key couldn't be resolved");
  });

  it('renders a deleted row as "[deleted page {id}]", never leaking a title', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { rows: [row({ pageId: 'page-9', title: null, deleted: true })], nextCursor: null },
    });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('[deleted page page-9]');
  });

  it('renders "—" with a tooltip for a voluntary-only page (percent: none)', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { rows: [row({ assignedCount: 0, percent: { kind: 'none' } })], nextCursor: null },
    });
    const renderer = await mount();
    const text = extractText(renderer.toJSON());
    expect(text).toContain('—');
    expect(text).toContain('Voluntary-only page');
  });

  it('marks an overdue row with a warning indicator', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { rows: [row({ dueDate: '2020-01-01', overdue: true })], nextCursor: null },
    });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('Overdue');
  });
});

describe('Dashboard — row click (T10: opens drill-down)', () => {
  it('renders the page title as plain text when onOpenPage is not provided', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();
    expect(renderer.root.findAllByType(LinkButton)).toHaveLength(0);
    expect(extractText(renderer.toJSON())).toContain('Security Policy');
  });

  it('renders the page title as a LinkButton and calls onOpenPage(pageId) on click', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row({ pageId: 'page-7' })], nextCursor: null } });
    const onOpenPage = jest.fn();
    const renderer = await mount({ onOpenPage });

    renderer.root.findByType(LinkButton).props.onClick();
    expect(onOpenPage).toHaveBeenCalledWith('page-7');
  });

  it('a deleted row still opens the drill-down via its "[deleted page {id}]" link', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: { rows: [row({ pageId: 'page-9', title: null, deleted: true })], nextCursor: null },
    });
    const onOpenPage = jest.fn();
    const renderer = await mount({ onOpenPage });

    renderer.root.findByType(LinkButton).props.onClick();
    expect(onOpenPage).toHaveBeenCalledWith('page-9');
  });
});

describe('Dashboard — export (T11, revised post-PR-review to the Custom UI export surface)', () => {
  it('clicking Export navigates to the export page, with the current space filter pre-filled', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();

    await act(async () => {
      renderer.root.findByType(Button).props.onClick();
      await Promise.resolve();
    });
    expect(bridge.router.getUrl).toHaveBeenCalledWith({ target: 'module', moduleKey: 'acknowledge-export', spaceKey: undefined });
    expect(bridge.router.navigate).toHaveBeenCalledWith(EXPORT_PAGE_URL);
  });
});

describe('Dashboard — pagination', () => {
  it('shows Load more when a cursor is returned, and fetches the next page on click', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ pageId: 'page-1' })], nextCursor: 'cursor-1' } });
    const renderer = await mount();
    expect(renderer.root.findAllByType(LoadingButton)).toHaveLength(1);

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ pageId: 'page-2' })], nextCursor: null } });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenLastCalledWith('getDashboard', expect.objectContaining({ cursor: 'cursor-1' }));
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Security Policy'); // first page's row is still present (appended, not replaced)
    expect(renderer.root.findAllByType(LoadingButton)).toHaveLength(0); // no more cursor -> button gone
  });

  it('does not show Load more when there is no cursor', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();
    expect(renderer.root.findAllByType(LoadingButton)).toHaveLength(0);
  });
});

describe('Dashboard — filters', () => {
  it('changing the status filter refetches and replaces rows', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ pageId: 'page-1' })], nextCursor: null } });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ pageId: 'page-2', title: 'Only complete' })], nextCursor: null } });
    await act(async () => {
      statusSelect(renderer).props.onChange({ label: 'Complete', value: 'complete' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenLastCalledWith('getDashboard', expect.objectContaining({ statusFilter: 'complete' }));
    expect(extractText(renderer.toJSON())).toContain('Only complete');
  });

  it('shows "no results" (not the onboarding empty state) when a filter matches nothing', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [], nextCursor: null } });
    await act(async () => {
      statusSelect(renderer).props.onChange({ label: 'Overdue', value: 'overdue' });
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = extractText(renderer.toJSON());
    expect(text).toContain('No pages match this filter.');
    expect(text).not.toContain('Start tracking read confirmations');
  });

  it('typing a space filter debounces before refetching', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();
    const callsBefore = bridge.invoke.mock.calls.length;

    const textfield = renderer.root.findByType(Textfield);
    await act(async () => {
      textfield.props.onChange('SEC');
    });
    // Not yet -- debounce window hasn't elapsed.
    expect(bridge.invoke.mock.calls.length).toBe(callsBefore);

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ spaceKey: 'SEC' })], nextCursor: null } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(bridge.invoke).toHaveBeenLastCalledWith('getDashboard', expect.objectContaining({ spaceKey: 'SEC' }));
  });
});

/** Disambiguates the page-search Select from the status-filter Select added earlier. */
function pageSearchSelect(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(Select).find((s) => s.props.inputId === 'trackPageSearch')!;
}

describe('Dashboard — track a page (2026-07-22: start tracking without adding the macro first)', () => {
  it('the page-search box is present even in the fully-empty onboarding state', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: { rows: [], nextCursor: null } });
    const renderer = await mount();
    expect(pageSearchSelect(renderer)).toBeDefined();
  });

  it('searches pages (debounced) as the manager types', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();
    const callsBefore = bridge.invoke.mock.calls.length;

    await act(async () => {
      pageSearchSelect(renderer).props.onInputChange('Secur');
    });
    expect(bridge.invoke.mock.calls.length).toBe(callsBefore);

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: [{ id: 'page-42', title: 'Security Policy' }] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(bridge.invoke).toHaveBeenCalledWith('searchPages', { query: 'Secur' });
  });

  it('selecting a search result opens the ConfigModal for that page', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row()], nextCursor: null } });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: { pageId: 'page-42', assignedUsers: [], assignedGroups: [], assignedGroupOptions: [], dueDate: null, reconfirmOnChange: false },
    });
    await act(async () => {
      pageSearchSelect(renderer).props.onChange({ label: 'Untracked Page', value: 'page-42' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getConfig', { pageId: 'page-42' });
  });

  it('saving a newly-tracked page closes the modal and refetches the dashboard list', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [], nextCursor: null } });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: { pageId: 'page-42', assignedUsers: [], assignedGroups: [], assignedGroupOptions: [], dueDate: null, reconfirmOnChange: false },
    });
    await act(async () => {
      pageSearchSelect(renderer).props.onChange({ label: 'Untracked Page', value: 'page-42' });
      await Promise.resolve();
      await Promise.resolve();
    });

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: { pageId: 'page-42', assignedUsers: ['acc-1'], assignedGroups: [], assignedGroupOptions: [], dueDate: null, reconfirmOnChange: false },
    });
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { rows: [row({ pageId: 'page-42', title: 'Untracked Page' })], nextCursor: null } });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getDashboard', expect.objectContaining({ statusFilter: 'all' }));
    expect(extractText(renderer.toJSON())).toContain('Untracked Page');
  });
});
