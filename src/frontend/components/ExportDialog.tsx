import React, { useState } from 'react';
import {
  Box,
  DatePicker,
  Inline,
  Label,
  LinkButton,
  LoadingButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalTransition,
  SectionMessage,
  Select,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import type { StartExportPayload, StartExportResponse, ExportScope, StatusFilter } from '../../shared';

/**
 * The export dialog (docs/06 T11, UX doc §3.4): format (CSV only in v1 —
 * PDF is T12) / scope / date range / status filter -> progress -> download.
 * `startExport` (asUser, visibility-safe) returns a one-time webtrigger URL;
 * this component never builds or downloads a file itself (UI Kit has no
 * Blob/DOM download API, docs/07 §5) — it renders the URL as
 * `LinkButton href={url}`, the prior Attestly build's own finding that
 * `router.open()` is unreliable for downloads.
 *
 * Uncontrolled-field pattern (DatePicker, Select) follows ConfigModal.tsx's
 * established rule: `defaultValue` is never fed by the same state its own
 * `onChange` writes to (a known UI Kit crash, validated in the prior build).
 * The scope/status Selects below seed `defaultValue` from a fixed initial
 * constant, not from the `scope`/`statusFilter` state `onChange` updates.
 */

export interface ExportDialogProps {
  onClose: () => void;
  /** Opened from the T10 drill-down: scope is fixed to this one page, not user-changeable. */
  fixedPageScope?: { pageId: string; pageTitle: string | null };
  /** Pre-fills the space-scope field from whatever the dashboard's own space filter currently holds. */
  defaultSpaceKey?: string;
}

interface StatusOption {
  label: string;
  value: StatusFilter;
}

interface ScopeOption {
  label: string;
  value: ExportScope;
}

const INITIAL_SCOPE_OPTION_VALUE: ExportScope = 'site';
const INITIAL_STATUS_OPTION_VALUE: StatusFilter = 'all';

export function ExportDialog({ onClose, fixedPageScope, defaultSpaceKey }: ExportDialogProps): React.JSX.Element {
  const { t } = useI18n();
  const startExportInvoke = useInvoke<StartExportPayload, StartExportResponse>('startExport');

  const [scope, setScope] = useState<ExportScope>(fixedPageScope ? 'page' : 'site');
  const [spaceKey, setSpaceKey] = useState(defaultSpaceKey ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const scopeOptions: ScopeOption[] = [
    { label: t('export.scope.space'), value: 'space' },
    { label: t('export.scope.site'), value: 'site' },
  ];
  const statusOptions: StatusOption[] = [
    { label: t('dashboard.filter.status.all'), value: 'all' },
    { label: t('dashboard.filter.status.incomplete'), value: 'incomplete' },
    { label: t('dashboard.filter.status.complete'), value: 'complete' },
    { label: t('dashboard.filter.status.overdue'), value: 'overdue' },
  ];

  async function handleStart(): Promise<void> {
    setStartError(null);
    setDownloadUrl(null);
    const result = await startExportInvoke.run({
      format: 'csv',
      scope,
      scopeValue: scope === 'page' ? fixedPageScope?.pageId : scope === 'space' ? spaceKey.trim() || undefined : undefined,
      statusFilter,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
    });
    if (!result.ok) {
      setStartError(result.message);
      return;
    }
    setDownloadUrl(result.data.url);
  }

  return (
    <ModalTransition>
      <Modal onClose={onClose} title={t('export.title')}>
        <ModalBody>
          <Stack space="space.200">
            {fixedPageScope ? (
              <Text>{fixedPageScope.pageTitle ?? fixedPageScope.pageId}</Text>
            ) : (
              <Box>
                <Label labelFor="exportScope">{t('export.scope')}</Label>
                <Select
                  inputId="exportScope"
                  options={scopeOptions}
                  defaultValue={scopeOptions.find((o) => o.value === INITIAL_SCOPE_OPTION_VALUE)}
                  onChange={(option: unknown) => {
                    const next = (option as ScopeOption | null)?.value;
                    if (next) {
                      setScope(next);
                    }
                  }}
                />
              </Box>
            )}

            {!fixedPageScope && scope === 'space' ? (
              <Box>
                <Label labelFor="exportSpaceKey">{t('export.spaceKey')}</Label>
                <Textfield id="exportSpaceKey" value={spaceKey} onChange={(e: unknown) => setSpaceKey(typeof e === 'string' ? e : ((e as { target?: { value?: string } })?.target?.value ?? ''))} />
              </Box>
            ) : null}

            <Box>
              <Label labelFor="exportStatusFilter">{t('export.statusFilter')}</Label>
              <Select
                inputId="exportStatusFilter"
                options={statusOptions}
                defaultValue={statusOptions.find((o) => o.value === INITIAL_STATUS_OPTION_VALUE)}
                onChange={(option: unknown) => {
                  const next = (option as StatusOption | null)?.value;
                  if (next) {
                    setStatusFilter(next);
                  }
                }}
              />
            </Box>

            <Box>
              <Label labelFor="exportDateFrom">{t('export.dateRange')}</Label>
              <Inline space="space.100">
                <DatePicker id="exportDateFrom" placeholder={t('export.from')} onChange={setDateFrom} />
                <DatePicker id="exportDateTo" placeholder={t('export.to')} onChange={setDateTo} />
              </Inline>
            </Box>

            {startError ? (
              <SectionMessage appearance="error">
                <Text>{startError}</Text>
              </SectionMessage>
            ) : null}

            {downloadUrl ? (
              <SectionMessage appearance="success">
                <Text>{t('export.ready')}</Text>
              </SectionMessage>
            ) : null}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <LoadingButton appearance="subtle" onClick={onClose}>
            {t('common.close')}
          </LoadingButton>
          {downloadUrl ? (
            <LinkButton appearance="primary" href={downloadUrl}>
              {t('export.download')}
            </LinkButton>
          ) : (
            <LoadingButton appearance="primary" isLoading={startExportInvoke.loading} onClick={handleStart}>
              {t('export.start')}
            </LoadingButton>
          )}
        </ModalFooter>
      </Modal>
    </ModalTransition>
  );
}
