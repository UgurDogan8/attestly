import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LinkButton, LoadingButton, Select, Textfield } from '@forge/react';
import { Dashboard } from './Dashboard';
import type { DashboardProps } from './Dashboard';
import type { DashboardRow } from '../../shared';

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
    expect(extractText(renderer.toJSON())).toContain('⚠');
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
      renderer.root.findByType(Select).props.onChange({ label: 'Complete', value: 'complete' });
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
      renderer.root.findByType(Select).props.onChange({ label: 'Overdue', value: 'overdue' });
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
