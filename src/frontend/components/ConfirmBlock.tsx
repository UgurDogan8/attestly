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
 * Renders reader states R1 (required), R3 (confirmed), R5 (voluntary), and
 * R6 (error, layered above the button) — UX doc §2.1. Shared between the
 * macro and, from T8, the byline dialog, which "reuses macro status/confirm
 * components" (UX doc §2.2).
 *
 * R4 (expired, v1.1) intentionally has no distinct rendering yet: it's
 * folded into R1/R5 here — a fresh confirm at the current version is
 * exactly what an expired reader needs to do, the same action as R1/R5 —
 * rather than building v1.1's richer "you confirmed v{old}, page is now
 * v{new}" copy this task doesn't need (docs/06 T6: "R4 ships behind v1.1 flag").
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

  // 'outstanding' and 'expired' (R4 fallback, see docstring) both show the
  // confirm prompt — required vs. voluntary wording only depends on assignment.
  const required = status.isAssigned;

  return (
    <Stack space="space.100">
      <SectionMessage appearance="information" title={required ? t('macro.required.title') : undefined}>
        <Text>{required ? t('macro.required.body') : t('macro.voluntary.body')}</Text>
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
