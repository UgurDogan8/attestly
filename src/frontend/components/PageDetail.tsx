import React, { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  DynamicTable,
  Icon,
  Inline,
  LinkButton,
  LoadingButton,
  Lozenge,
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
import type { IconProps } from '@forge/react';
import { useI18n } from './useI18n';
import type { I18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { SurfaceHeader } from './SurfaceHeader';
import { formatLocalDateTime, formatLocalDate } from './formatLocalDateTime';
import { openExportPage } from './exportNavigation';
import { ConfigModal } from './ConfigModal';
import type {
  GetPageDetailPayload,
  GetPageDetailResponse,
  DetailUserRow,
  GetPageHistoryPayload,
  GetPageHistoryResponse,
  HistoryEntryView,
  HistoryChangeView,
  Locale,
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
 *
 * "Configure" button (2026-07-22, owner-reported gap): editing who must
 * confirm this page used to require visiting the page itself and opening
 * the macro's config modal — docs/07 §4.3 always intended "the same
 * ConfigModal is reachable from a dashboard row", but T9/T10 never actually
 * wired a button for it. Opens the same ConfigModal component the macro
 * uses (same invoke('saveConfig'), same access gate re-checked server-side)
 * and refetches the drill-down on save so the tabs/summary reflect the new
 * assignment immediately.
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

function assignmentLozengeAppearance(row: DetailUserRow): 'default' | 'moved' {
  return row.assignmentType === 'voluntary' || row.assignmentSource === null ? 'default' : 'moved';
}

/**
 * History tab line (data model §2.4): one full localized sentence per diffed
 * change. actorName/subjectName come back null from the resolver for a
 * since-deleted user or group (auth.ts's resolveUserDisplayNameOrNull,
 * resolveGroupNames) rather than a baked-in English placeholder — i18n stays
 * client-side (docs/07 §4), so the null->localized-text substitution happens
 * here, not on the server.
 */
function historyChangeText(t: I18n['t'], locale: Locale, actorName: string | null, change: HistoryChangeView): string {
  const actor = actorName ?? t('detail.deletedUser');
  if (change.kind === 'dueDate') {
    return t('detail.history.dueDate', { actor, date: change.dueDate ? formatLocalDate(change.dueDate, locale) : '—' });
  }
  const key = change.kind === 'assigned' ? 'detail.history.assigned' : 'detail.history.removed';
  const subject = change.subjectName ?? (change.subjectType === 'group' ? t('detail.groupDeleted') : t('detail.deletedUser'));
  return t(key, { actor, subject });
}

/** One small icon per history change kind — a quick visual cue in an otherwise plain-text timeline. */
function historyChangeIcon(change: HistoryChangeView): IconProps['glyph'] {
  if (change.kind === 'dueDate') {
    return 'calendar';
  }
  return change.kind === 'assigned' ? 'person-add' : 'person-remove';
}

interface StatChipProps {
  icon: IconProps['glyph'];
  label: string;
  value: number;
}

function StatChip({ icon, label, value }: StatChipProps): React.JSX.Element {
  return (
    <Inline space="space.100" alignBlock="center">
      <Icon glyph={icon} label="" color="color.icon.subtle" size="small" />
      <Text color="color.text.subtle">{label}</Text>
      <Badge>{value}</Badge>
    </Inline>
  );
}

interface UserRowsTableProps {
  rows: DetailUserRow[];
  showConfirmedColumns: boolean;
  currentVersion: number | null;
}

function UserRowsTable({ rows, showConfirmedColumns, currentVersion }: UserRowsTableProps): React.JSX.Element {
  const { t, locale } = useI18n();

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
        // Review finding: a deleted account was plain text indistinguishable
        // from a genuine "grant them permission" cannot-view row -- a
        // distinct lozenge signals "this account no longer exists" instead.
        content: row.deletedUser ? <Lozenge appearance="default">{t('detail.deletedUser')}</Lozenge> : <User accountId={row.accountId} />,
      },
      {
        key: 'assignment',
        content: (
          <Stack space="space.050">
            <Lozenge appearance={assignmentLozengeAppearance(row)}>{assignmentLabel(t, row)}</Lozenge>
            {row.status === 'expired' && row.pageVersion !== null && currentVersion !== null ? (
              <Text color="color.text.subtle">{t('detail.expiredNote', { oldVersion: row.pageVersion, newVersion: currentVersion })}</Text>
            ) : null}
          </Stack>
        ),
      },
      ...(showConfirmedColumns
        ? [
            { key: 'version', content: row.pageVersion !== null ? String(row.pageVersion) : '—' },
            { key: 'confirmedAt', content: row.confirmedAt ? formatLocalDateTime(row.confirmedAt, locale) : '—' },
          ]
        : []),
    ],
  }));

  return <DynamicTable head={head} rows={tableRows} />;
}

export function PageDetail({ pageId, onBack }: PageDetailProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const detailInvoke = useInvoke<GetPageDetailPayload, GetPageDetailResponse>('getPageDetail');
  const historyInvoke = useInvoke<GetPageHistoryPayload, GetPageHistoryResponse>('getPageHistory');

  const [data, setData] = useState<GetPageDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState(TAB_OUTSTANDING);
  const [exportNavError, setExportNavError] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  async function handleExportClick(): Promise<void> {
    const opened = await openExportPage({ pageId });
    setExportNavError(!opened);
  }

  const [historyEntries, setHistoryEntries] = useState<HistoryEntryView[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

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

  function handleConfigSaved(): void {
    setConfigOpen(false);
    // The modal (and this whole component) stays mounted across the save --
    // unlike the mount effect above, there is no unmount race to guard here.
    void detailInvoke.run({ pageId }).then((result) => {
      if (result.ok) {
        setData(result.data);
      }
    });
  }

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
    return <Spinner label={t('common.loading')} />;
  }

  const title = data.deleted ? t('dashboard.deletedPage', { id: data.pageId }) : (data.title ?? data.pageId);

  return (
    <Stack space="space.200">
      <LinkButton appearance="link" onClick={onBack}>
        {t('detail.back')}
      </LinkButton>
      <SurfaceHeader
        icon="page"
        title={title}
        action={
          <Inline space="space.100" alignBlock="center">
            <Button iconBefore="edit" onClick={() => setConfigOpen(true)}>
              {t('detail.configure')}
            </Button>
            <Button iconBefore="export" onClick={() => void handleExportClick()}>
              {t('dashboard.export')}
            </Button>
          </Inline>
        }
      />
      {exportNavError ? (
        <SectionMessage appearance="error">
          <Text>{t('export.navError')}</Text>
        </SectionMessage>
      ) : null}
      {configOpen ? <ConfigModal pageId={pageId} onClose={() => setConfigOpen(false)} onSaved={handleConfigSaved} /> : null}
      <Inline space="space.300" alignBlock="center" shouldWrap>
        <StatChip icon="people-group" label={t('detail.stat.assigned')} value={data.summary.assigned} />
        <StatChip icon="check-mark" label={t('detail.tab.confirmed')} value={data.summary.confirmed} />
        <StatChip icon="clock" label={t('detail.tab.outstanding')} value={data.summary.outstanding} />
        <StatChip icon="lock-locked" label={t('detail.tab.cannotView')} value={data.summary.cannotView} />
      </Inline>
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
            <Spinner label={t('common.loading')} />
          ) : historyEntries.length === 0 ? (
            <Text>{t('detail.history.empty')}</Text>
          ) : (
            <Stack space="space.150">
              {historyEntries.map((entry, i) => (
                // History has no stable id from the resolver; (at, actorName) can repeat within the same request batch.
                <Stack key={`${entry.at}#${entry.actorName}#${i}`} space="space.050">
                  <Text color="color.text.subtle">{formatLocalDateTime(entry.at, locale)}</Text>
                  {entry.changes.map((change, j) => (
                    <Inline key={j} space="space.100" alignBlock="center">
                      <Icon glyph={historyChangeIcon(change)} label="" color="color.icon.subtle" size="small" />
                      <Text>{historyChangeText(t, locale, entry.actorName, change)}</Text>
                    </Inline>
                  ))}
                </Stack>
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
    </Stack>
  );
}
