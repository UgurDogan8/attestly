import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Button, LoadingButton, Tabs, User } from '@forge/react';
import { PageDetail } from './PageDetail';
import type { GetPageDetailResponse, DetailUserRow } from '../../shared';

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

function detailRow(overrides: Partial<DetailUserRow> = {}): DetailUserRow {
  return {
    accountId: 'acc-1',
    status: 'outstanding',
    assignmentType: 'assigned',
    assignmentSource: { kind: 'direct' },
    pageVersion: null,
    confirmedAt: null,
    deletedUser: false,
    ...overrides,
  };
}

function detailResponse(overrides: Partial<GetPageDetailResponse> = {}): GetPageDetailResponse {
  return {
    pageId: 'page-1',
    title: 'Security Policy',
    deleted: false,
    currentVersion: 1,
    summary: { assigned: 0, confirmed: 0, outstanding: 0, cannotView: 0 },
    outstanding: [],
    confirmed: [],
    voluntary: [],
    cannotView: [],
    staleAssignedGroupIds: [],
    ...overrides,
  };
}

async function mount(pageId = 'page-1'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PageDetail pageId={pageId} onBack={jest.fn()} />);
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

describe('PageDetail — loading and error states', () => {
  it('shows an error message when getPageDetail fails', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'nope' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('nope');
  });
});

describe('PageDetail — header and summary', () => {
  it('shows the title, and the summary line with all four counts', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: detailResponse({ summary: { assigned: 10, confirmed: 6, outstanding: 3, cannotView: 1 } }),
    });
    const renderer = await mount();
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Security Policy');
    expect(text).toContain('6');
    expect(text).toContain('10');
    expect(text).toContain('3');
    expect(text).toContain('1');
  });

  it('renders "[deleted page {id}]" for a deleted page, never leaking a title', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: detailResponse({ pageId: 'page-9', title: null, deleted: true }) });
    const renderer = await mount('page-9');
    expect(extractText(renderer.toJSON())).toContain('[deleted page page-9]');
  });

  it('shows a stale-group warning only when staleAssignedGroupIds is non-empty', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse({ staleAssignedGroupIds: ['g1'] }) });
    const withWarning = await mount();
    expect(extractText(withWarning.toJSON())).toContain('no longer exist');

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse({ staleAssignedGroupIds: [] }) });
    const withoutWarning = await mount();
    expect(extractText(withoutWarning.toJSON())).not.toContain('no longer exist');
  });
});

describe('PageDetail — tab content', () => {
  it('the outstanding tab lists directly-assigned and group-assigned users with their source label', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: detailResponse({
        summary: { assigned: 2, confirmed: 0, outstanding: 2, cannotView: 0 },
        outstanding: [
          detailRow({ accountId: 'acc-direct', assignmentSource: { kind: 'direct' } }),
          detailRow({ accountId: 'acc-group', assignmentSource: { kind: 'group', groupId: 'g1', groupName: 'sec-all' } }),
        ],
      }),
    });
    const renderer = await mount();
    const text = extractText(renderer.toJSON());
    expect(text).toContain('assigned directly');
    expect(text).toContain('sec-all');
    const users = renderer.root.findAllByType(User).map((u) => u.props.accountId);
    expect(users).toEqual(expect.arrayContaining(['acc-direct', 'acc-group']));
  });

  it('a deleted-group member label falls back to "group deleted"', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: detailResponse({
        outstanding: [detailRow({ accountId: 'acc-1', assignmentSource: { kind: 'group', groupId: 'gone', groupName: null } })],
      }),
    });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('group deleted');
  });

  it('a deletedUser row shows the deleted-user label instead of the User component', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: detailResponse({ cannotView: [detailRow({ accountId: 'acc-gone', status: 'cannot-view', deletedUser: true })] }),
    });
    const renderer = await mount();
    // Switch to the Cannot view tab (index 3).
    await act(async () => {
      renderer.root.findByType(Tabs).props.onChange(3);
    });
    expect(extractText(renderer.toJSON())).toContain('deleted user');
    expect(renderer.root.findAllByType(User)).toHaveLength(0);
  });

  it('an empty tab shows the "no users" message instead of an empty table', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: detailResponse() });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('No users in this list.');
  });

  it('a confirmed row shows its version and confirmed-at time', async () => {
    bridge.invoke.mockResolvedValue({
      ok: true,
      data: detailResponse({
        summary: { assigned: 1, confirmed: 1, outstanding: 0, cannotView: 0 },
        confirmed: [detailRow({ accountId: 'acc-1', status: 'confirmed', pageVersion: 3, confirmedAt: '2026-07-09T12:00:00.000Z' })],
      }),
    });
    const renderer = await mount();
    await act(async () => {
      renderer.root.findByType(Tabs).props.onChange(1);
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('3');
  });
});

describe('PageDetail — export (T11, revised post-PR-review to the Custom UI export surface)', () => {
  it('clicking Export navigates to the export page, scoped to this one page', async () => {
    bridge.invoke.mockResolvedValue({ ok: true, data: detailResponse({ pageId: 'page-1', title: 'Security Policy' }) });
    const renderer = await mount();

    const exportButton = renderer.root.findAllByType(Button).find((b) => b.props.iconBefore === 'export');
    await act(async () => {
      exportButton!.props.onClick();
      await Promise.resolve();
    });
    expect(bridge.router.getUrl).toHaveBeenCalledWith({ target: 'module', moduleKey: 'acknowledge-export', spaceKey: undefined });
    expect(bridge.router.navigate).toHaveBeenCalledWith(`${EXPORT_PAGE_URL}?pageId=page-1`);
  });
});

describe('PageDetail — Configure (2026-07-22: assignment editable from the drill-down, docs/07 §4.3)', () => {
  const EMPTY_CONFIG = { pageId: 'page-1', assignedUsers: [], assignedGroups: [], assignedGroupOptions: [], dueDate: null, reconfirmOnChange: false };

  it('clicking Configure opens the assignment modal for this page', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse({ pageId: 'page-1' }) });
    const renderer = await mount();

    const configureButton = renderer.root.findAllByType(Button).find((b) => b.props.iconBefore === 'edit');
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: EMPTY_CONFIG });
    await act(async () => {
      configureButton!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getConfig', { pageId: 'page-1' });
  });

  it('saving the assignment modal closes it and refreshes the drill-down summary', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse({ pageId: 'page-1', summary: { assigned: 0, confirmed: 0, outstanding: 0, cannotView: 0 } }) });
    const renderer = await mount();

    const configureButton = renderer.root.findAllByType(Button).find((b) => b.props.iconBefore === 'edit');
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: EMPTY_CONFIG });
    await act(async () => {
      configureButton!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { ...EMPTY_CONFIG, assignedUsers: ['acc-9'] } });
    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: detailResponse({
        pageId: 'page-1',
        summary: { assigned: 1, confirmed: 0, outstanding: 1, cannotView: 0 },
        outstanding: [detailRow({ accountId: 'acc-9' })],
      }),
    });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getPageDetail', { pageId: 'page-1' });
    expect(renderer.root.findAllByType(Button).some((b) => b.props.iconBefore === 'edit')).toBe(true);
    expect(extractText(renderer.toJSON())).toContain('1');
  });
});

describe('PageDetail — History tab (lazy load)', () => {
  it('does not call getPageHistory until the History tab is opened', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse() });
    await mount();
    expect(bridge.invoke).not.toHaveBeenCalledWith('getPageHistory', expect.anything());
  });

  it('loads and shows history entries once the History tab is opened, as human-readable text (not raw JSON)', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse() });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            at: '2026-07-01T00:00:00.000Z',
            actorName: 'Jane Admin',
            changes: [
              { kind: 'assigned', subjectType: 'user', subjectName: 'Ayşe Yılmaz' },
              { kind: 'removed', subjectType: 'group', subjectName: 'sec-all' },
              { kind: 'dueDate', dueDate: '2026-08-01' },
            ],
          },
        ],
        nextCursor: null,
      },
    });
    await act(async () => {
      renderer.root.findByType(Tabs).props.onChange(4);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getPageHistory', { pageId: 'page-1' });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Jane Admin assigned Ayşe Yılmaz');
    expect(text).toContain('Jane Admin removed sec-all');
    expect(text).toContain('Jane Admin set due date to');
    expect(text).not.toContain('{"');
  });

  it('substitutes localized text for a null actorName/subjectName instead of rendering "null" (i18n fix — resolver returns null, not a baked-in English string, for a since-deleted user/group)', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse() });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        entries: [
          {
            at: '2026-07-01T00:00:00.000Z',
            actorName: null,
            changes: [
              { kind: 'assigned', subjectType: 'user', subjectName: null },
              { kind: 'removed', subjectType: 'group', subjectName: null },
            ],
          },
        ],
        nextCursor: null,
      },
    });
    await act(async () => {
      renderer.root.findByType(Tabs).props.onChange(4);
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = extractText(renderer.toJSON());
    expect(text).toContain('deleted user assigned deleted user');
    expect(text).toContain('deleted user removed group deleted');
    expect(text).not.toContain('null');
  });

  it('shows "no history yet" when the log is empty', async () => {
    bridge.invoke.mockResolvedValueOnce({ ok: true, data: detailResponse() });
    const renderer = await mount();

    bridge.invoke.mockResolvedValueOnce({ ok: true, data: { entries: [], nextCursor: null } });
    await act(async () => {
      renderer.root.findByType(Tabs).props.onChange(4);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(extractText(renderer.toJSON())).toContain('No history yet.');
  });
});
