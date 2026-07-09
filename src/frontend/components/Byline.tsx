import React from 'react';
import { LoadingButton, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { useI18n } from './useI18n';
import { useReaderState } from './useReaderState';
import { ConfirmBlock } from './ConfirmBlock';

/**
 * The byline dialog (docs/06 T8, UX doc §2.2): "Dialog shows the user's
 * status detail and, when outstanding, the same confirm action as the
 * macro." Reuses useReaderState + ConfirmBlock verbatim — the only
 * difference from Macro.tsx is that there is no Configure button/modal
 * here (UX doc §2.2 never mentions one for the dialog; configuring stays a
 * macro/dashboard action).
 *
 * A confirm from this dialog writes through the exact same `confirm`
 * resolver as the macro (T8 accept criteria) — true by construction, since
 * both surfaces share useReaderState's handleConfirm, not by any dialog-
 * specific code here.
 *
 * The byline *chip* (title/tooltip shown in the byline list before the
 * dialog opens) is a completely separate mechanism —
 * src/resolvers/bylineProps.ts, a manifest `dynamicProperties` function,
 * not this UI Kit resource. See that file's docstring for the chip's own
 * states and platform-behavior notes (including "chip refreshes after
 * dialog close").
 */
export function Byline(): React.JSX.Element | null {
  const { t } = useI18n();
  const { phase, confirmError, confirming, reloading, handleConfirm, handleReload } = useReaderState();

  switch (phase.kind) {
    case 'loading':
      return <Spinner label={t('common.loadMore')} />;

    case 'unsupportedContentType':
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
      return <ConfirmBlock status={phase.status} onConfirm={handleConfirm} confirming={confirming} confirmError={confirmError} />;

    default:
      return null;
  }
}
