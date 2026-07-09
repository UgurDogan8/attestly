import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  DynamicTable,
  Heading,
  Inline,
  LinkButton,
  LoadingButton,
  SectionMessage,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  User,
} from '@forge/react';
import { useI18n } from './useI18n';
import type { I18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { formatLocalDateTime } from './formatLocalDateTime';
import { ExportDialog } from './ExportDialog';
import type {
  GetPageDetailPayload,
  GetPageDetailResponse,
  DetailUserRow,
  GetPageHistoryPayload,
  GetPageHistoryResponse,
  HistoryEntryView,
} from '../../shared';

/**
 * Drill-down (docs/06 T10, UX doc §3.3): five tabs (Outstanding / Confirmed
 * / Voluntary / Cannot view / History) over a single page's assignment.
 * All the exact-truth work (group resolution, batched cannot-view checks,
 * counter self-heal) happens server-side in src/resolvers/pageDetail.ts —
 * this component only renders what it's given.
 *
 * Tabs/TabList/Tab/TabPanel composition follows the standard Atlaskit Tabs
 * API (`selected` + `onChange` on `Tabs`, per @forge/react's generated prop
 * types) — flagged per this project's convention for pieces not yet
 * exercised on a live site (docs/02 §11): verify tab switching visually on
 * the next real deploy-and-test pass.
 *
 * History is loaded lazily, on first switching to that tab — the other four
 * tabs come from the same getPageDetail call that opens the drill-down, but
 * config-audit is a separate, potentially-unbounded log a manager may never
 * open (T9's "never fetch more than the view needs" principle, T10 style).
 */

export interface PageDetailProps {
  pageId: string;
  onBack: () => void;
}

/** Tabs/TabPanel order below: Outstanding, Confirmed, Voluntary, Cannot view, History. */
const TAB_OUTSTANDING = 0;
const TAB_HISTORY = 4;

function assignmentLabel(t: I18n['t'], row: DetailUserRow): string {
  if (row.assignmentType === 'voluntary' || row.assignmentSource === null) {
    return t('status.voluntary');
  }
  if (row.assignmentSource.kind === 'direct') {
    return t('detail.assignedDirectly');
  }
  return t('detail.assignedViaGroup', { group: row.assignmentSource.groupName ?? t('detail.groupDeleted') });
}

interface UserRowsTableProps {
  rows: DetailUserRow[];
  showConfirmedColumns: boolean;
  currentVersion: number | null;
}

function UserRowsTable({ rows, showConfirmedColumns, currentVersion }: UserRowsTableProps): React.JSX.Element {
  const { t } = useI18n();

  if (rows.length === 0) {
    return <Text>{t('detail.tab.empty')}</Text>;
  }

  const head = {
    cells: [
      { key: 'user', content: t('detail.col.user') },
      { key: 'assignment', content: t('detail.col.assignment') },
      ...(showConfirmedColumns
        ? [
            { key: 'version', content: t('detail.col.version') },
            { key: 'confirmedAt', content: t('detail.col.confirmedAt') },
          ]
        : []),
    ],
  };

  const tableRows = rows.map((row) => ({
    key: row.accountId,
    cells: [
      {
        key: 'user',
        content: row.deletedUser ? <Text>{t('detail.deletedUser')}</Text> : <User accountId={row.accountId} />,
      },
      {
        key: 'assignment',
        content: (
          <Stack space="space.025">
            <Text>{assignmentLabel(t, row)}</Text>
            {row.status === 'expired' && row.pageVersion !== null && currentVersion !== null ? (
              <Text>{t('detail.expiredNote', { oldVersion: row.pageVersion, newVersion: currentVersion })}</Text>
            ) : null}
          </Stack>
        ),
      },
      ...(showConfirmedColumns
        ? [
            { key: 'version', content: row.pageVersion !== null ? String(row.pageVersion) : '—' },
            { key: 'confirmedAt', content: row.confirmedAt ? formatLocalDateTime(row.confirmedAt) : '—' },
          ]
        : []),
    ],
  }));

  return <DynamicTable head={head} rows={tableRows} />;
}

export function PageDetail({ pageId, onBack }: PageDetailProps): React.JSX.Element {
  const { t } = useI18n();
  const detailInvoke = useInvoke<GetPageDetailPayload, GetPageDetailResponse>('getPageDetail');
  const historyInvoke = useInvoke<GetPageHistoryPayload, GetPageHistoryResponse>('getPageHistory');

  const [data, setData] = useState<GetPageDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState(TAB_OUTSTANDING);

  const [historyEntries, setHistoryEntries] = useState<HistoryEntryView[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    detailInvoke.run({ pageId }).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
    // Runs once per mount (one drill-down instance per pageId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  async function loadHistory(cursor?: string): Promise<void> {
    const result = await historyInvoke.run({ pageId, cursor });
    if (!result.ok) {
      return;
    }
    setHistoryEntries((prev) => (cursor ? [...prev, ...result.data.entries] : result.data.entries));
    setHistoryCursor(result.data.nextCursor);
    setHistoryLoaded(true);
  }

  function handleTabChange(index: number): void {
    setTabIndex(index);
    if (index === TAB_HISTORY && !historyLoaded) {
      void loadHistory();
    }
  }

  if (loadError) {
    return (
      <Stack space="space.200">
        <LinkButton appearance="link" onClick={onBack}>
          {t('detail.back')}
        </LinkButton>
        <SectionMessage appearance="error">
          <Text>{loadError}</Text>
        </SectionMessage>
      </Stack>
    );
  }

  if (!data) {
    return <Spinner label={t('common.loadMore')} />;
  }

  const title = data.deleted ? t('dashboard.deletedPage', { id: data.pageId }) : (data.title ?? data.pageId);

  return (
    <Stack space="space.200">
      <LinkButton appearance="link" onClick={onBack}>
        {t('detail.back')}
      </LinkButton>
      <Inline space="space.200" alignBlock="center" spread="space-between">
        <Heading size="medium">{title}</Heading>
        <Button onClick={() => setExportOpen(true)}>{t('dashboard.export')}</Button>
      </Inline>
      <Text>
        {t('detail.summary', {
          assigned: data.summary.assigned,
          confirmed: data.summary.confirmed,
          outstanding: data.summary.outstanding,
          cannotView: data.summary.cannotView,
        })}
      </Text>
      {data.staleAssignedGroupIds.length > 0 ? (
        <SectionMessage appearance="warning">
          <Text>{t('detail.staleGroups')}</Text>
        </SectionMessage>
      ) : null}
      {data.cannotView.length > 0 ? (
        <SectionMessage appearance="warning">
          <Text>{t('detail.cannotView.hint')}</Text>
        </SectionMessage>
      ) : null}

      <Tabs id="page-detail-tabs" selected={tabIndex} onChange={handleTabChange}>
        <TabList>
          <Tab>
            {t('detail.tab.outstanding')} ({data.summary.outstanding})
          </Tab>
          <Tab>
            {t('detail.tab.confirmed')} ({data.summary.confirmed})
          </Tab>
          <Tab>
            {t('detail.tab.voluntary')} ({data.voluntary.length})
          </Tab>
          <Tab>
            {t('detail.tab.cannotView')} ({data.summary.cannotView})
          </Tab>
          <Tab>{t('detail.tab.history')}</Tab>
        </TabList>

        <TabPanel>
          <UserRowsTable rows={data.outstanding} showConfirmedColumns={false} currentVersion={data.currentVersion} />
        </TabPanel>
        <TabPanel>
          <UserRowsTable rows={data.confirmed} showConfirmedColumns currentVersion={data.currentVersion} />
        </TabPanel>
        <TabPanel>
          <UserRowsTable rows={data.voluntary} showConfirmedColumns currentVersion={data.currentVersion} />
        </TabPanel>
        <TabPanel>
          <UserRowsTable rows={data.cannotView} showConfirmedColumns={false} currentVersion={data.currentVersion} />
        </TabPanel>
        <TabPanel>
          {!historyLoaded ? (
            <Spinner label={t('common.loadMore')} />
          ) : historyEntries.length === 0 ? (
            <Text>{t('detail.history.empty')}</Text>
          ) : (
            <Stack space="space.100">
              {historyEntries.map((entry, i) => (
                // History has no stable id from the resolver; (at, actor) can repeat within the same request batch.
                <Inline key={`${entry.at}#${entry.actor}#${i}`} space="space.100">
                  <User accountId={entry.actor} />
                  <Text>{formatLocalDateTime(entry.at)}</Text>
                  <Text>{JSON.stringify(entry.entry)}</Text>
                </Inline>
              ))}
              {historyCursor ? (
                <Box>
                  <LoadingButton isLoading={historyInvoke.loading} onClick={() => void loadHistory(historyCursor ?? undefined)}>
                    {t('common.loadMore')}
                  </LoadingButton>
                </Box>
              ) : null}
            </Stack>
          )}
        </TabPanel>
      </Tabs>

      {exportOpen ? (
        <ExportDialog onClose={() => setExportOpen(false)} fixedPageScope={{ pageId: data.pageId, pageTitle: data.title }} />
      ) : null}
    </Stack>
  );
}
