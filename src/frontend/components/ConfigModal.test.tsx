import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LoadingButton, Button, Select, DatePicker } from '@forge/react';
import { ConfigModal } from './ConfigModal';

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

const EMPTY_CONFIG = {
  pageId: 'page-1',
  assignedUsers: [],
  assignedGroups: [],
  assignedGroupOptions: [],
  dueDate: null,
  reconfirmOnChange: false,
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(props: { onClose?: () => void; onSaved?: (c: unknown) => void } = {}): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ConfigModal pageId="page-1" onClose={props.onClose ?? jest.fn()} onSaved={props.onSaved} />);
    await flush();
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view.getContext.mockResolvedValue({ locale: 'en' });
});

describe('ConfigModal — load', () => {
  it('shows a typed error when getConfig fails', async () => {
    bridge.invoke.mockResolvedValue({ ok: false, code: 'FORBIDDEN', message: 'nope' });
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('nope');
  });

  it('shows the voluntary-mode notice when nobody is assigned', async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(functionKey === 'getConfig' ? { ok: true, data: EMPTY_CONFIG } : { ok: true, data: [] }),
    );
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('No required readers — confirmations will be voluntary.');
  });

  it('does not show the voluntary-mode notice when users are assigned', async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(
        functionKey === 'getConfig' ? { ok: true, data: { ...EMPTY_CONFIG, assignedUsers: ['acc-1'] } } : { ok: true, data: [] },
      ),
    );
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).not.toContain('confirmations will be voluntary');
  });
});

describe('ConfigModal — due date field', () => {
  it("passes '' (not undefined) to DatePicker when no due date is set, never a stray default", async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(functionKey === 'getConfig' ? { ok: true, data: EMPTY_CONFIG } : { ok: true, data: [] }),
    );
    const renderer = await mount();
    expect(renderer.root.findByType(DatePicker).props.defaultValue).toBe('');
  });

  it('passes the stored ISO date straight through when one is set', async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(
        functionKey === 'getConfig' ? { ok: true, data: { ...EMPTY_CONFIG, dueDate: '2026-07-31' } } : { ok: true, data: [] },
      ),
    );
    const renderer = await mount();
    expect(renderer.root.findByType(DatePicker).props.defaultValue).toBe('2026-07-31');
  });

  it("clearing an existing due date and saving sends null, not '' (DatePicker's onChange is never called with null itself, so a live save with '' hit the KVS \"cannot be empty\" error every time)", async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getConfig') {
        return Promise.resolve({ ok: true, data: { ...EMPTY_CONFIG, dueDate: '2026-07-31' } });
      }
      if (functionKey === 'saveConfig') {
        return Promise.resolve({ ok: true, data: { ...EMPTY_CONFIG, dueDate: null } });
      }
      return Promise.resolve({ ok: true, data: [] });
    });
    const renderer = await mount();

    await act(async () => {
      // DatePicker's own clear control calls onChange('') -- it never calls onChange(null).
      renderer.root.findByType(DatePicker).props.onChange('');
    });
    await act(async () => {
      renderer.root.findByType(LoadingButton).props.onClick();
      await flush();
    });

    expect(bridge.invoke).toHaveBeenCalledWith('saveConfig', expect.objectContaining({ dueDate: null }));
  });
});

describe('ConfigModal — group recommendation hint (data model §2.2, T7 accept criteria)', () => {
  it('shows the plain helper message under 50 direct users', async () => {
    const users = Array.from({ length: 10 }, (_, i) => `acc-${i}`);
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(
        functionKey === 'getConfig' ? { ok: true, data: { ...EMPTY_CONFIG, assignedUsers: users } } : { ok: true, data: [] },
      ),
    );
    const renderer = await mount();
    expect(extractText(renderer.toJSON())).toContain('For teams, prefer groups');
  });

  it('escalates to a warning SectionMessage past 50 direct users', async () => {
    const users = Array.from({ length: 51 }, (_, i) => `acc-${i}`);
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(
        functionKey === 'getConfig' ? { ok: true, data: { ...EMPTY_CONFIG, assignedUsers: users } } : { ok: true, data: [] },
      ),
    );
    const renderer = await mount();
    const warningMessages = renderer.root.findAllByProps({ appearance: 'warning' });
    expect(warningMessages.length).toBeGreaterThan(0);
  });
});

describe('ConfigModal — save', () => {
  it('cancel calls onClose without saving', async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(functionKey === 'getConfig' ? { ok: true, data: EMPTY_CONFIG } : { ok: true, data: [] }),
    );
    const onClose = jest.fn();
    const renderer = await mount({ onClose });
    const cancelButton = renderer.root.findByType(Button);

    await act(async () => {
      cancelButton.props.onClick();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridge.invoke).not.toHaveBeenCalledWith('saveConfig', expect.anything());
  });

  it('save preserves the existing reconfirmOnChange (the toggle is disabled, v1.1) rather than clearing it', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getConfig') {
        return Promise.resolve({ ok: true, data: { ...EMPTY_CONFIG, reconfirmOnChange: true } });
      }
      if (functionKey === 'saveConfig') {
        return Promise.resolve({ ok: true, data: { ...EMPTY_CONFIG, reconfirmOnChange: true } });
      }
      return Promise.resolve({ ok: true, data: [] });
    });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const renderer = await mount({ onSaved, onClose });
    const saveButton = renderer.root.findByType(LoadingButton);

    await act(async () => {
      saveButton.props.onClick();
      await flush();
    });

    expect(bridge.invoke).toHaveBeenCalledWith(
      'saveConfig',
      expect.objectContaining({ pageId: 'page-1', reconfirmOnChange: true }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a save failure shows the error and does not close the modal', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getConfig') return Promise.resolve({ ok: true, data: EMPTY_CONFIG });
      if (functionKey === 'saveConfig') return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'no longer allowed' });
      return Promise.resolve({ ok: true, data: [] });
    });
    const onClose = jest.fn();
    const renderer = await mount({ onClose });
    const saveButton = renderer.root.findByType(LoadingButton);

    await act(async () => {
      saveButton.props.onClick();
      await flush();
    });

    expect(extractText(renderer.toJSON())).toContain('no longer allowed');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfigModal — group search (debounced)', () => {
  it('calls searchGroups with the typed query after the debounce window', async () => {
    bridge.invoke.mockImplementation((functionKey: string) => {
      if (functionKey === 'getConfig') return Promise.resolve({ ok: true, data: EMPTY_CONFIG });
      if (functionKey === 'searchGroups') {
        return Promise.resolve({ ok: true, data: [{ id: 'g1', name: 'sec-all' }] });
      }
      return Promise.resolve({ ok: true, data: [] });
    });
    const renderer = await mount();
    const select = renderer.root.findByType(Select);

    await act(async () => {
      select.props.onInputChange('sec');
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(bridge.invoke).toHaveBeenCalledWith('searchGroups', { pageId: 'page-1', query: 'sec' });
  });

  it('clears the search options when the query is cleared, without calling searchGroups', async () => {
    bridge.invoke.mockImplementation((functionKey: string) =>
      Promise.resolve(functionKey === 'getConfig' ? { ok: true, data: EMPTY_CONFIG } : { ok: true, data: [] }),
    );
    const renderer = await mount();
    const select = renderer.root.findByType(Select);

    await act(async () => {
      select.props.onInputChange('');
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(bridge.invoke).not.toHaveBeenCalledWith('searchGroups', expect.anything());
  });
});
