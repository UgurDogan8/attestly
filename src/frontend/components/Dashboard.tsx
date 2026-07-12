import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Icon,
  Inline,
  LinkButton,
  LoadingButton,
  Lozenge,
  ProgressBar,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  Tooltip,
  xcss,
} from '@forge/react';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { SurfaceHeader } from './SurfaceHeader';
import { formatLocalDate } from './formatLocalDateTime';
import { openExportPage } from './exportNavigation';
import type { GetDashboardPayload, GetDashboardResponse, DashboardRow, StatusFilter } from '../../shared';

/**
 * The dashboard global page (docs/06 T9, UX doc §3.2). List-only for this
 * task: row click -> drill-down (T10) and the export dialog (T11) are not
 * wired here yet, only the columns/filters/pagination T9 itself owns.
 *
 * Space filter is a free-text Textfield (space key), not a populated
 * dropdown (UX doc mockup shows "[Space ▾]") — a disclosed v1
 * simplification: listing every distinct space among tracked pages without
 * fanning out over them is its own feature, not built ahead of need here.
 *
 * See src/resolvers/dashboard.ts's docstring for the visibility rule,
 * advisory-counter, and role-gate reasoning behind what this renders.
 */

const STATUS_FILTER_DEBOUNCE_MS = 400;

const toolbarStyles = xcss({ borderRadius: 'radius.medium' });
const filterIconStyles = xcss({ paddingInlineStart: 'space.050' });

/**
 * `resolveSpaceKey()` (auth.ts) falls back to the raw numeric `spaceId` when
 * it can't resolve a real key (no space-read scope is requested — a
 * deliberate scope-minimization tradeoff, docs/07 §6). Real Confluence space
 * keys always start with a letter, so an all-digits value is always that
 * fallback, never a genuine key — shown as an unresolved placeholder instead
 * of a number that looks like a real (but wrong) key.
 */
function isUnresolvedSpaceKey(spaceKey: string): boolean {
  return /^\d+$/.test(spaceKey);
}

interface StatusOption {
  label: string;
  value: StatusFilter;
}

export interface DashboardProps {
  /** Opens the T10 drill-down for a row (docs/04 §3.2: "Row click -> drill-down"). Omitted -> the page cell renders as plain text, not a link. */
  onOpenPage?: (pageId: string) => void;
}

export function Dashboard({ onOpenPage }: DashboardProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const dashboardInvoke = useInvoke<GetDashboardPayload, GetDashboardResponse>('getDashboard');

  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [spaceKeyInput, setSpaceKeyInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const spaceFilterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Takes filters as explicit arguments rather than reading spaceKeyInput/
   * statusFilter state directly -- the debounced space-filter path fires
   * from a setTimeout callback whose closure would otherwise see whatever
   * spaceKeyInput was at the *keystroke* render, not the latest value
   * (a stale-closure bug caught while testing this component: the first
   * version read component state inside the timeout callback and silently
   * sent the previous filter).
   */
  async function runFilteredFetch(filters: { spaceKey?: string; statusFilter: StatusFilter; cursor?: string }): Promise<void> {
    const result = await dashboardInvoke.run(filters);

    if (!result.ok) {
      if (result.code === 'FORBIDDEN') {
        setForbidden(true);
      } else {
        setLoadError(result.message);
      }
      setInitialLoadDone(true);
      return;
    }

    setForbidden(false);
    setLoadError(null);
    setRows((prev) => (filters.cursor ? [...prev, ...result.data.rows] : result.data.rows));
    setCursor(result.data.nextCursor);
    setInitialLoadDone(true);
  }

  useEffect(() => {
    void runFilteredFetch({ statusFilter: 'all' });
    return () => {
      if (spaceFilterTimer.current) {
        clearTimeout(spaceFilterTimer.current);
      }
    };
    // Deliberately empty deps: this effect only handles the very first
    // load, always unfiltered by construction (the filter state doesn't
    // exist yet at mount time). Filter changes and "Load more" are handled
    // explicitly below, each passing its own current values directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoadMore(): void {
    void runFilteredFetch({
      spaceKey: spaceKeyInput.trim() || undefined,
      statusFilter,
      cursor: cursor ?? undefined,
    });
  }

  function handleSpaceInputChange(value: string): void {
    setSpaceKeyInput(value);
    if (spaceFilterTimer.current) {
      clearTimeout(spaceFilterTimer.current);
    }
    spaceFilterTimer.current = setTimeout(() => {
      void runFilteredFetch({ spaceKey: value.trim() || undefined, statusFilter });
    }, STATUS_FILTER_DEBOUNCE_MS);
  }

  function handleStatusFilterChange(next: StatusFilter): void {
    setStatusFilter(next);
    void runFilteredFetch({ spaceKey: spaceKeyInput.trim() || undefined, statusFilter: next });
  }

  const statusOptions: StatusOption[] = [
    { label: t('dashboard.filter.status.all'), value: 'all' },
    { label: t('dashboard.filter.status.incomplete'), value: 'incomplete' },
    { label: t('dashboard.filter.status.complete'), value: 'complete' },
    { label: t('dashboard.filter.status.overdue'), value: 'overdue' },
  ];

  if (forbidden) {
    return <EmptyState header={t('dashboard.noAccess.header')} description={t('dashboard.noAccess.description')} />;
  }

  if (!initialLoadDone) {
    return <Spinner label={t('common.loadMore')} />;
  }

  if (loadError) {
    return <Text>{loadError}</Text>;
  }

  const isUnfiltered = statusFilter === 'all' && spaceKeyInput.trim() === '';
  if (rows.length === 0 && cursor === null && isUnfiltered) {
    return <EmptyState header={t('dashboard.empty.header')} description={t('dashboard.empty.description')} />;
  }

  const head = {
    cells: [
      { key: 'page', content: t('dashboard.col.page') },
      { key: 'space', content: t('dashboard.col.space') },
      { key: 'assigned', content: t('dashboard.col.assigned') },
      { key: 'percent', content: t('dashboard.col.percent') },
      { key: 'due', content: t('dashboard.col.due') },
    ],
  };

  const tableRows = rows.map((row) => ({
    key: row.pageId,
    cells: [
      {
        key: 'page',
        content: (() => {
          const label = row.deleted ? t('dashboard.deletedPage', { id: row.pageId }) : row.title;
          const titleNode = onOpenPage ? <LinkButton onClick={() => onOpenPage(row.pageId)}>{label}</LinkButton> : label;
          if (!row.deleted) {
            return titleNode;
          }
          return (
            <Inline space="space.100" alignBlock="center">
              <Icon glyph="delete" label="" color="color.icon.subtle" size="small" />
              {titleNode}
            </Inline>
          );
        })(),
      },
      {
        key: 'space',
        content: isUnresolvedSpaceKey(row.spaceKey) ? (
          <Tooltip content={t('dashboard.spaceUnresolvedTooltip')}>
            <Text color="color.text.subtle">—</Text>
          </Tooltip>
        ) : (
          <Lozenge appearance="default">{row.spaceKey}</Lozenge>
        ),
      },
      { key: 'assigned', content: <Text>{String(row.assignedCount)}</Text> },
      {
        key: 'percent',
        content:
          row.percent.kind === 'none' ? (
            <Tooltip content={t('dashboard.voluntaryTooltip')}>
              <Text color="color.text.subtle">—</Text>
            </Tooltip>
          ) : (
            <Stack space="space.025">
              <Text>{`${Math.round(row.percent.percent * 100)}%`}</Text>
              <ProgressBar value={row.percent.percent} ariaLabel={`${Math.round(row.percent.percent * 100)}%`} />
            </Stack>
          ),
      },
      {
        key: 'due',
        content: row.dueDate ? (
          <Inline space="space.100" alignBlock="center">
            <Text color={row.overdue ? 'color.text.danger' : undefined}>{formatLocalDate(row.dueDate)}</Text>
            {row.overdue ? <Lozenge appearance="danger">{t('dashboard.overdueBadge')}</Lozenge> : null}
          </Inline>
        ) : (
          <Text color="color.text.subtle">—</Text>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <SurfaceHeader
        icon="shield"
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        action={
          <Button iconBefore="export" onClick={() => openExportPage({ spaceKey: spaceKeyInput || undefined })}>
            {t('dashboard.export')}
          </Button>
        }
      />

      <Box backgroundColor="color.background.neutral.subtle" padding="space.150" xcss={toolbarStyles}>
        <Inline space="space.200" alignBlock="center">
          <Box xcss={filterIconStyles}>
            <Icon glyph="filter" label="" color="color.icon.subtle" size="small" />
          </Box>
          <Textfield
            placeholder={t('dashboard.filter.space.placeholder')}
            value={spaceKeyInput}
            onChange={(e: unknown) => {
              const value = typeof e === 'string' ? e : ((e as { target?: { value?: string } })?.target?.value ?? '');
              handleSpaceInputChange(value);
            }}
          />
          <Select
            value={statusOptions.find((o) => o.value === statusFilter)}
            options={statusOptions}
            onChange={(option: unknown) => {
              const next = (option as StatusOption | null)?.value;
              if (next) {
                handleStatusFilterChange(next);
              }
            }}
          />
        </Inline>
      </Box>

      {rows.length === 0 ? (
        <EmptyState header={t('dashboard.filter.noResults')} />
      ) : (
        <DynamicTable head={head} rows={tableRows} isLoading={dashboardInvoke.loading && rows.length === 0} />
      )}

      {cursor ? (
        <Box>
          <LoadingButton isLoading={dashboardInvoke.loading} onClick={handleLoadMore}>
            {t('common.loadMore')}
          </LoadingButton>
        </Box>
      ) : null}
    </Stack>
  );
}
