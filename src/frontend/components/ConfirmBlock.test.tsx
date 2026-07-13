import React from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { LoadingButton } from '@forge/react';
import { ConfirmBlock } from './ConfirmBlock';
import type { PageStatusResponse } from '../../shared';

jest.mock('@forge/bridge', () => ({
  view: { getContext: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { view } = require('@forge/bridge') as { view: { getContext: jest.Mock } };

// Walks a react-test-renderer .toJSON() tree collecting visible text. Under
// react-test-renderer (not the real Forge reconciler), a prop like
// SectionMessage's `title` stays an inert prop rather than becoming a
// child node -- so this also pulls in known text-bearing props, not just
// `children`, or title assertions would silently see nothing.
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

function status(overrides: Partial<PageStatusResponse> = {}): PageStatusResponse {
  return {
    status: 'outstanding',
    pageVersion: 1,
    dueDate: null,
    isAssigned: true,
    confirmedAt: null,
    confirmedVersion: null,
    canConfigure: false,
    ...overrides,
  };
}

async function renderBlock(props: Parameters<typeof ConfirmBlock>[0]): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ConfirmBlock {...props} />);
  });
  return renderer;
}

beforeEach(() => {
  view.getContext.mockResolvedValue({ locale: 'en' });
});

describe('ConfirmBlock — R1 required', () => {
  it('shows the required title/body and the confirm button', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Read confirmation required');
    expect(text).toContain('Your acknowledgement of this page is requested.');
    expect(text).toContain('I have read and understood this page');
  });

  it('shows the due date when set', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true, dueDate: '2026-08-15' }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    expect(extractText(renderer.toJSON())).toContain('Due:');
  });

  it('omits the due date line when not set', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true, dueDate: null }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    expect(extractText(renderer.toJSON())).not.toContain('Due:');
  });
});

describe('ConfirmBlock — R4 expired (page changed since the reader last confirmed)', () => {
  it('shows the changed banner with the old and new versions, still offers the confirm button', async () => {
    const renderer = await renderBlock({
      status: status({ status: 'expired', pageVersion: 7, confirmedVersion: 5, confirmedAt: '2026-07-01T00:00:00.000Z' }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('This page has changed since you confirmed it');
    expect(text).toContain('You confirmed version 5; the page is now version 7.');
    expect(text).toContain('I have read and understood this page');
    // Not the generic outstanding copy -- R4 replaces it, not layers on it.
    expect(text).not.toContain('Your acknowledgement of this page is requested.');
  });

  it('falls back to the generic required copy if confirmedVersion is unexpectedly absent', async () => {
    const renderer = await renderBlock({
      status: status({ status: 'expired', confirmedVersion: null }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    expect(extractText(renderer.toJSON())).toContain('Read confirmation required');
  });
});

describe('ConfirmBlock — R5 voluntary', () => {
  it('shows subtler wording, no "required" title', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: false }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('This page asks readers to acknowledge it.');
    expect(text).not.toContain('Read confirmation required');
    // The exact confirm button copy is still shown -- confirming is always available.
    expect(text).toContain('I have read and understood this page');
  });
});

describe('ConfirmBlock — R3 confirmed', () => {
  it('shows the confirmed title and includes the version', async () => {
    const renderer = await renderBlock({
      status: status({ status: 'confirmed', pageVersion: 7, confirmedAt: '2026-07-12T11:03:00.000Z' }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain('Confirmed');
    expect(text).toContain('7');
  });

  it('never shows the confirm button once confirmed', async () => {
    const renderer = await renderBlock({
      status: status({ status: 'confirmed', confirmedAt: '2026-07-12T11:03:00.000Z' }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: null,
    });
    expect(renderer.root.findAllByType(LoadingButton)).toHaveLength(0);
  });
});

describe('ConfirmBlock — R6 error (layered on R1/R5, never shows confirmed)', () => {
  it('shows the error message alongside the still-active required block', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: 'boom',
    });
    const text = extractText(renderer.toJSON());
    expect(text).toContain("We couldn’t record your confirmation");
    expect(text).toContain('Read confirmation required'); // still R1, not replaced
    expect(text).toContain('I have read and understood this page'); // button still present
  });

  it('the button is not loading once the request has settled (re-enabled)', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true }),
      onConfirm: jest.fn(),
      confirming: false,
      confirmError: 'boom',
    });
    const button = renderer.root.findByType(LoadingButton);
    expect(button.props.isLoading).toBe(false);
  });
});

describe('ConfirmBlock — R2 confirming (pessimistic, no optimistic confirmed state)', () => {
  it('the button shows isLoading while a confirm is in flight', async () => {
    const renderer = await renderBlock({
      status: status({ isAssigned: true }),
      onConfirm: jest.fn(),
      confirming: true,
      confirmError: null,
    });
    const button = renderer.root.findByType(LoadingButton);
    expect(button.props.isLoading).toBe(true);
    // Still R1, not R3 -- status hasn't changed yet, so it must not show confirmed.
    expect(extractText(renderer.toJSON())).not.toContain('Confirmed');
  });

  it('calls onConfirm when the button is clicked', async () => {
    const onConfirm = jest.fn();
    const renderer = await renderBlock({
      status: status({ isAssigned: true }),
      onConfirm,
      confirming: false,
      confirmError: null,
    });
    const button = renderer.root.findByType(LoadingButton);
    await act(async () => {
      button.props.onClick();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
