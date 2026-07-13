import React from 'react';
import { LoadingButton, SectionMessage, Stack, Text } from '@forge/react';
import { useI18n } from './useI18n';
import { formatLocalDate, formatLocalDateTime } from './formatLocalDateTime';
import type { PageStatusResponse } from '../../shared';

export interface ConfirmBlockProps {
  status: PageStatusResponse;
  onConfirm: () => void;
  confirming: boolean;
  confirmError: string | null;
}

/**
 * Renders reader states R1 (required), R3 (confirmed), R4 (expired), R5
 * (voluntary), and R6 (error, layered above the button) — UX doc §2.1.
 * Shared between the macro and, from T8, the byline dialog, which "reuses
 * macro status/confirm components" (UX doc §2.2).
 *
 * R4 found in review: this used to fold 'expired' into the generic R1/R5
 * required/voluntary prompt with no mention of the reader's prior
 * confirmation at all — a reader who'd confirmed v5 of a now-v7 page saw
 * the exact same "please confirm" ask as someone who had never confirmed
 * anything, with no indication the page had changed since they last read
 * it. UX doc §2.1's R4 mockup ("This page has changed since you confirmed
 * it" / "You confirmed version {old}; the page is now version {new}.") was
 * scaffolded in i18n (macro.changed.*) but never wired up here — wired up
 * now using `status.confirmedVersion` (shared/types.ts), the version that
 * scaffolded string needs and the only piece 'expired' was missing.
 */
export function ConfirmBlock({ status, onConfirm, confirming, confirmError }: ConfirmBlockProps): React.JSX.Element {
  const { t } = useI18n();

  if (status.status === 'cannot-view') {
    // Not reachable via getPageStatus today (tech design §4: the viewer of
    // their own macro can, by definition, view the page) — kept as a safe
    // fallback rather than letting an unreachable-in-practice state crash
    // the render.
    return <Text>{t('status.cannot-view')}</Text>;
  }

  if (status.status === 'confirmed') {
    return (
      <SectionMessage appearance="success" title={t('macro.confirmed.title')}>
        <Text>
          {status.confirmedAt
            ? t('macro.confirmed.body', {
                version: status.pageVersion,
                datetime: formatLocalDateTime(status.confirmedAt),
              })
            : ''}
        </Text>
      </SectionMessage>
    );
  }

  // 'outstanding' (never confirmed) and 'expired' (R4: confirmed once, but
  // the page has since moved past that version) both end in the same
  // confirm prompt, but 'expired' gets its own banner first — falling back
  // to the generic required/voluntary copy if confirmedVersion is somehow
  // absent (defensive: 'expired' should always carry one, see shared/types.ts).
  const required = status.isAssigned;
  const changed = status.status === 'expired' && status.confirmedVersion !== null;

  return (
    <Stack space="space.100">
      <SectionMessage
        appearance={changed ? 'warning' : 'information'}
        title={changed ? t('macro.changed.title') : required ? t('macro.required.title') : undefined}
      >
        <Text>
          {changed
            ? t('macro.changed.body', { oldVersion: status.confirmedVersion as number, newVersion: status.pageVersion })
            : required
              ? t('macro.required.body')
              : t('macro.voluntary.body')}
        </Text>
        {required && status.dueDate ? <Text>{t('macro.due', { date: formatLocalDate(status.dueDate) })}</Text> : null}
      </SectionMessage>
      {confirmError ? (
        <SectionMessage appearance="error" title={t('macro.error.title')}>
          <Text>{t('macro.error.body')}</Text>
        </SectionMessage>
      ) : null}
      <LoadingButton appearance="primary" isLoading={confirming} onClick={onConfirm}>
        {t('macro.confirmButton')}
      </LoadingButton>
    </Stack>
  );
}
