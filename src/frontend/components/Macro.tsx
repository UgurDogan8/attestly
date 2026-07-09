import React, { useState } from 'react';
import { Button, LoadingButton, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { useI18n } from './useI18n';
import { useReaderState } from './useReaderState';
import { ConfirmBlock } from './ConfirmBlock';
import { ConfigModal } from './ConfigModal';

/**
 * Reader states R1–R7 (UX doc §2.1). R4 (expired-specific copy) is folded
 * into R1/R5 for v1 — see ConfirmBlock's docstring (docs/06 T6: "R4 ships
 * behind v1.1 flag"). State machine lives in useReaderState (shared with
 * the byline dialog, T8).
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
export function Macro(): React.JSX.Element | null {
  const { t } = useI18n();
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const { phase, pageId, confirmError, confirming, reloading, handleConfirm, handleReload, refreshStatus } =
    useReaderState();

  function handleConfigSaved(): void {
    setIsConfigModalOpen(false);
    if (pageId) {
      // Config changes can affect the current user's own isAssigned/dueDate
      // (e.g. an editor assigning themselves) -- refetch rather than assume
      // the modal's return value matches what getPageStatus would compute.
      void refreshStatus(pageId);
    }
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
          <LoadingButton isLoading={reloading} onClick={handleReload}>
            {t('macro.midread.reload')}
          </LoadingButton>
        </Stack>
      );

    case 'ready':
      return (
        <Stack space="space.100">
          <ConfirmBlock status={phase.status} onConfirm={handleConfirm} confirming={confirming} confirmError={confirmError} />
          {phase.status.canConfigure ? (
            <Button onClick={() => setIsConfigModalOpen(true)}>{t('config.openButton')}</Button>
          ) : null}
          {isConfigModalOpen && pageId ? (
            <ConfigModal pageId={pageId} onClose={() => setIsConfigModalOpen(false)} onSaved={handleConfigSaved} />
          ) : null}
        </Stack>
      );

    default:
      return null;
  }
}
