import React from 'react';
import { LoadingButton, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { useI18n } from './useI18n';
import type { ReaderPhase } from './useReaderState';

export interface ReaderPhaseViewProps {
  phase: ReaderPhase;
  reloading: boolean;
  handleReload: () => Promise<void>;
  renderReady: (phase: Extract<ReaderPhase, { kind: 'ready' }>) => React.JSX.Element | null;
}

/**
 * The four phases Macro.tsx (T6) and Byline.tsx (T8) used to render with
 * identical JSX — loading / unsupportedContentType / error / pageChanged —
 * extracted here once both surfaces needed the exact same markup. Only the
 * 'ready' phase differs between them (the macro adds a Configure
 * button/modal on top of ConfirmBlock; the dialog renders ConfirmBlock
 * alone), so that one case is left to the caller via `renderReady`.
 */
export function ReaderPhaseView({ phase, reloading, handleReload, renderReady }: ReaderPhaseViewProps): React.JSX.Element | null {
  const { t } = useI18n();

  switch (phase.kind) {
    case 'loading':
      return <Spinner label={t('common.loading')} />;

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
      return renderReady(phase);

    default:
      return null;
  }
}
