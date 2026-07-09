import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LinkButton } from '@forge/react';
import { DashboardApp } from './DashboardApp';

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

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view.getContext.mockResolvedValue({ locale: 'en' });
});

describe('DashboardApp (T10: composes the list with the drill-down)', () => {
  it('starts on the dashboard list and switches to the drill-down on a row click', async () => {
    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        rows: [
          {
            pageId: 'page-1',
            title: 'Security Policy',
            deleted: false,
            spaceKey: 'SEC',
            assignedCount: 1,
            percent: { kind: 'value', percent: 0, confirmedCount: 0, eligibleCount: 1 },
            dueDate: null,
            overdue: false,
          },
        ],
        nextCursor: null,
      },
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<DashboardApp />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(extractText(renderer.toJSON())).toContain('Security Policy');

    bridge.invoke.mockResolvedValueOnce({
      ok: true,
      data: {
        pageId: 'page-1',
        title: 'Security Policy',
        deleted: false,
        currentVersion: 1,
        summary: { assigned: 1, confirmed: 0, outstanding: 1, cannotView: 0 },
        outstanding: [],
        confirmed: [],
        voluntary: [],
        cannotView: [],
        staleAssignedGroupIds: [],
      },
    });
    await act(async () => {
      renderer.root.findByType(LinkButton).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('getPageDetail', { pageId: 'page-1' });
  });
});
