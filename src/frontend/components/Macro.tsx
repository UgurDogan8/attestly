import React, { useEffect, useState } from 'react';
import { LoadingButton, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { view } from '@forge/bridge';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { ConfirmBlock } from './ConfirmBlock';
import type { PageStatusPayload, PageStatusResponse, ConfirmPayload, ConfirmResponse } from '../../shared';

/**
 * Reader states R1–R7 (UX doc §2.1). R4 (expired-specific copy) is folded
 * into R1/R5 for v1 — see ConfirmBlock's docstring (docs/06 T6: "R4 ships
 * behind v1.1 flag").
 *
 * Known platform limitation, not a gap in this implementation: UI Kit's
 * component props (SectionMessage/Text/Box/…) don't expose an `aria-live`
 * pass-through — Custom UI could set it directly on real DOM, UI Kit's
 * reconciled native components can't. This is a direct, disclosed
 * consequence of the Custom UI -> UI Kit switch (docs/07 §1); not attempted
 * here rather than faked.
 *
 * Known residual, not attempted: "multiple macros on one page: first
 * active, others inert" (UX doc §5, PRD A1). Each macro instance is an
 * isolated render with no reliable client-side signal for "am I first" that
 * would work without live-platform verification (a `window`-global flag
 * cannot be assumed to work, since UI Kit macro instances are commonly
 * sandboxed per-instance) — left for live verification rather than shipping
 * an unverified heuristic.
 *
 * A separate, exported component (rather than inlined in macro.tsx) so it's
 * testable directly with react-test-renderer, same as ConfirmBlock — the
 * entry point (macro.tsx) is just `ForgeReconciler.render(<Macro />)`.
 */

type MacroPhase =
  | { kind: 'loading' }
  | { kind: 'unsupportedContentType' }
  | { kind: 'error'; message: string }
  | { kind: 'pageChanged'; currentVersion: number }
  | { kind: 'ready'; status: PageStatusResponse };

export function Macro(): React.JSX.Element | null {
  const { t } = useI18n();
  const [pageId, setPageId] = useState<string | null>(null);
  const [phase, setPhase] = useState<MacroPhase>({ kind: 'loading' });
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
      // types; a macro's shape (verified against Atlassian's Forge docs,
      // not live-tested this session) is
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

  async function handleConfirm(): Promise<void> {
    if (!pageId || phase.kind !== 'ready') {
      return;
    }
    setConfirmError(null);
    // Pessimistic UI (UX doc §1.3/R2): no optimistic switch to confirmed —
    // the button's isLoading state (confirmInvoke.loading) is the only
    // visible change until the server acknowledges the write.
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
      },
    });
  }

  async function handleReload(): Promise<void> {
    if (!pageId) {
      return;
    }
    // R7's "reload" re-fetches this macro's own status against the new page
    // version rather than a literal browser navigation (window.location /
    // top-level navigation from inside a UI Kit resource is unverified and
    // out of scope for what this action actually needs to accomplish: give
    // the reader a confirm button for the current version again).
    const result = await statusInvoke.run({ pageId });
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.message });
      return;
    }
    setConfirmError(null);
    setPhase({ kind: 'ready', status: result.data });
  }

  switch (phase.kind) {
    case 'loading':
      return <Spinner label={t('common.loadMore')} />;

    case 'unsupportedContentType':
      // Confluence wouldn't normally place a page macro on non-page content;
      // a short message beats silently rendering nothing if it happens anyway.
      return <Text>{t('macro.unsupportedContentType')}</Text>;

    case 'error':
      return (
        <SectionMessage appearance="error" title={t('macro.error.title')}>
          <Text>{phase.message}</Text>
        </SectionMessage>
      );

    case 'pageChanged':
      return (
        <Stack space="space.100">
          <SectionMessage appearance="information" title={t('macro.midread.title')}>
            <Text>{t('macro.midread.body')}</Text>
          </SectionMessage>
          <LoadingButton isLoading={statusInvoke.loading} onClick={handleReload}>
            {t('macro.midread.reload')}
          </LoadingButton>
        </Stack>
      );

    case 'ready':
      return (
        <ConfirmBlock
          status={phase.status}
          onConfirm={handleConfirm}
          confirming={confirmInvoke.loading}
          confirmError={confirmError}
        />
      );

    default:
      return null;
  }
}
