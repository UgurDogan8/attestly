import { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import { useInvoke } from './useInvoke';
import type { PageStatusPayload, PageStatusResponse, ConfirmPayload, ConfirmResponse } from '../../shared';

/**
 * The reader state machine shared by the macro (T6) and the byline dialog
 * (T8, UX doc §2.2: "dialog reuses macro status/confirm components") —
 * extracted once a second real caller existed, not built ahead of need.
 * Each surface renders its own UI around this; only the macro adds a
 * Configure button/modal on top.
 */

export type ReaderPhase =
  | { kind: 'loading' }
  | { kind: 'unsupportedContentType' }
  | { kind: 'error'; message: string }
  | { kind: 'pageChanged'; currentVersion: number }
  | { kind: 'ready'; status: PageStatusResponse };

export interface ReaderState {
  phase: ReaderPhase;
  pageId: string | null;
  confirmError: string | null;
  /** R2: drives the confirm button's isLoading (pessimistic UI, UX doc §1.3). */
  confirming: boolean;
  /** Drives the R7 reload button's isLoading. */
  reloading: boolean;
  handleConfirm: () => Promise<void>;
  handleReload: () => Promise<void>;
  /** Exposed so a caller (Macro's config modal) can refresh status after an
   * action this hook doesn't know about. */
  refreshStatus: (pageId: string) => Promise<void>;
}

export function useReaderState(): ReaderState {
  const [pageId, setPageId] = useState<string | null>(null);
  const [phase, setPhase] = useState<ReaderPhase>({ kind: 'loading' });
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const statusInvoke = useInvoke<PageStatusPayload, PageStatusResponse>('getPageStatus');
  const confirmInvoke = useInvoke<ConfirmPayload, ConfirmResponse>('confirm');

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      const context = await view.getContext();
      if (cancelled) {
        return;
      }
      // FullContext.extension is a generic {[k:string]: any} in the SDK
      // types; a macro/byline's shape (verified against Atlassian's Forge
      // docs, not live-tested this session) is
      // { content: { id, type, subtype }, space: { id, key }, isEditing, config }.
      const extension = context.extension as { content?: { id?: string; type?: string } } | undefined;
      const contentId = extension?.content?.id;
      const contentType = extension?.content?.type;

      if (!contentId || contentType !== 'page') {
        setPhase({ kind: 'unsupportedContentType' });
        return;
      }

      setPageId(contentId);
      const result = await statusInvoke.run({ pageId: contentId });
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setPhase({ kind: 'error', message: result.message });
        return;
      }
      setPhase({ kind: 'ready', status: result.data });
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Deliberately statusInvoke.run, not the whole statusInvoke object.
    // useInvoke returns a fresh {run, loading, error} object every render;
    // `run` itself is useCallback-memoized on functionKey (a literal here,
    // so `run` never changes). eslint-plugin-react-hooks v7's
    // exhaustive-deps still asks for the whole `statusInvoke` object here --
    // doing that would be a real bug, not a lint nitpick: the effect would
    // re-fire every time `loading`/`error` change (i.e. immediately after
    // calling run()), re-triggering the fetch on every loading-state flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusInvoke.run]);

  async function refreshStatus(id: string): Promise<void> {
    const result = await statusInvoke.run({ pageId: id });
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.message });
      return;
    }
    setConfirmError(null);
    setPhase({ kind: 'ready', status: result.data });
  }

  async function handleConfirm(): Promise<void> {
    if (!pageId || phase.kind !== 'ready') {
      return;
    }
    setConfirmError(null);
    const result = await confirmInvoke.run({ pageId, pageVersion: phase.status.pageVersion });

    if (!result.ok) {
      setConfirmError(result.message);
      return;
    }
    if (result.data.outcome === 'pageChanged') {
      setPhase({ kind: 'pageChanged', currentVersion: result.data.currentVersion });
      return;
    }
    setPhase({
      kind: 'ready',
      status: {
        ...phase.status,
        status: result.data.status,
        pageVersion: result.data.pageVersion,
        confirmedAt: result.data.confirmedAt,
        // A fresh confirm always records against the version just rendered
        // (tech design §6.3 -- pageChanged is a separate, non-confirming
        // outcome branched above), so the newly confirmed version and the
        // page version rendered are the same number here.
        confirmedVersion: result.data.pageVersion,
      },
    });
  }

  async function handleReload(): Promise<void> {
    if (!pageId) {
      return;
    }
    // R7's "reload" re-fetches this surface's own status against the new
    // page version rather than a literal browser navigation
    // (window.location / top-level navigation from inside a UI Kit
    // resource is unverified and out of scope for what this action
    // actually needs to accomplish: give the reader a confirm button for
    // the current version again).
    await refreshStatus(pageId);
  }

  return {
    phase,
    pageId,
    confirmError,
    confirming: confirmInvoke.loading,
    reloading: statusInvoke.loading,
    handleConfirm,
    handleReload,
    refreshStatus,
  };
}
