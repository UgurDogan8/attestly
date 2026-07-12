import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { diffConfigChange, type ConfigChangeEntry } from '../domain/history';
import {
  isComplianceManager,
  checkViewPermission,
  getGroupMemberAccountIds,
  resolveGroupNames,
  resolveUserDisplayName,
} from './auth';
import { resolvePageVisibility } from './dashboard';
import { mapWithConcurrency } from './concurrency';
import { getPageConfig, savePageConfig, type PageConfigRecord } from '../storage/configs';
import { drainByPage } from '../storage/confirmations';
import { queryAuditPage } from '../storage/audit';
import {
  ok,
  err,
  type Result,
  type GetPageDetailPayload,
  type GetPageDetailResponse,
  type DetailUserRow,
  type AssignmentSource,
  type GetPageHistoryPayload,
  type GetPageHistoryResponse,
  type HistoryChangeView,
} from '../shared';

const NAME_RESOLUTION_CONCURRENCY = 10;

/**
 * Drill-down row assembly (docs/06 T10, UX doc §3.3, tech design §4/§5).
 *
 * Unlike getDashboard (T9), this resolver is intentionally NOT fan-out-free
 * — it is the one place that recomputes exact per-user truth for a single,
 * bounded page (data model §2.2's soft assignee cap; dashboard.ts's
 * docstring explicitly defers this exact work to here). Two costs it pays
 * deliberately:
 *
 *  1. Group membership is resolved fresh via getGroupMemberAccountIds on
 *     every call (PRD B1: a grant/revoke must show up immediately, not from
 *     a cached snapshot).
 *  2. Every eligible (assigned) user gets an asApp() cannot-view permission
 *     check (tech design §4's tier-3 exception (a)) — batched at
 *     concurrency ~10 (concurrency.ts) so 100 users take seconds, not the
 *     ~20s sequential would cost (live-measured 150–250ms/check).
 *
 * Voluntary confirmers are derived differently: not from a permission check,
 * but from confirmation records for this page (drainByPage) whose accountId
 * falls OUTSIDE the current eligible set. This is deliberately based on
 * *current* assignment, not each record's own stored `assignmentType` field
 * (data model §2.1) — an assignment can change after a confirmation was
 * written, and a drill-down should never show the same user in both the
 * Confirmed and Voluntary tabs. The stored `assignmentType` remains the
 * export's source of truth (T11); this tab is a live view, not an export.
 *
 * Counter self-heal (tech design §5): once the exact confirmed-among-
 * eligible count is known here, page-config's advisory counter is corrected
 * if it drifted — the next dashboard load reads an accurate number "for
 * free" until confirms drift it again.
 */

const PERMISSION_CHECK_CONCURRENCY = 10;

interface EligibleUser {
  accountId: string;
  source: AssignmentSource;
}

function buildEligibleUsers(
  config: PageConfigRecord,
  groupNameById: Map<string, string>,
  groupMembers: Map<string, string[]>,
): EligibleUser[] {
  const bySource = new Map<string, AssignmentSource>();

  for (const accountId of config.assignedUsers) {
    bySource.set(accountId, { kind: 'direct' });
  }
  for (const groupId of config.assignedGroups) {
    for (const accountId of groupMembers.get(groupId) ?? []) {
      if (!bySource.has(accountId)) {
        bySource.set(accountId, { kind: 'group', groupId, groupName: groupNameById.get(groupId) ?? null });
      }
    }
  }

  return Array.from(bySource, ([accountId, source]) => ({ accountId, source }));
}

/** Latest-by-pageVersion record per accountId (data model §3: "latest := record with max pageVersion"). */
async function latestConfirmationByAccount(pageId: string): Promise<Map<string, ConfirmationRecord>> {
  const latest = new Map<string, ConfirmationRecord>();
  for await (const chunk of drainByPage(pageId)) {
    for (const record of chunk) {
      const existing = latest.get(record.accountId);
      if (!existing || record.pageVersion > existing.pageVersion) {
        latest.set(record.accountId, record);
      }
    }
  }
  return latest;
}

export async function getPageDetail(payload: GetPageDetailPayload, accountId: string): Promise<Result<GetPageDetailResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to view this page.');
  }

  const { pageId } = payload;
  const config = await getPageConfig(pageId);
  if (!config) {
    return err('NOT_FOUND', 'This page is not tracked.');
  }

  const visibility = (await resolvePageVisibility([pageId])).get(pageId) ?? { kind: 'restricted' as const };
  if (visibility.kind === 'restricted') {
    return err('FORBIDDEN', "You don't have permission to view this page.");
  }

  const deleted = visibility.kind === 'deleted';
  const title = visibility.kind === 'visible' ? visibility.title : null;
  const currentVersion = visibility.kind === 'visible' ? (visibility.version ?? null) : null;

  const [groupMemberEntries, groupOptions, latestByAccount] = await Promise.all([
    Promise.all(config.assignedGroups.map(async (groupId): Promise<[string, string[]]> => [groupId, await getGroupMemberAccountIds(groupId)])),
    resolveGroupNames(config.assignedGroups),
    latestConfirmationByAccount(pageId),
  ]);
  const groupMembers = new Map(groupMemberEntries);
  const groupNameById = new Map(groupOptions.map((g) => [g.id, g.name]));
  const staleAssignedGroupIds = config.assignedGroups.filter((id) => !groupNameById.has(id));

  const eligible = buildEligibleUsers(config, groupNameById, groupMembers);

  const assignedRows = await mapWithConcurrency(eligible, PERMISSION_CHECK_CONCURRENCY, async (user): Promise<DetailUserRow> => {
    const latest = latestByAccount.get(user.accountId);

    // A deleted page has no live permission to check against (data model
    // §3.1: "stays available for drill-down ... nothing stored changes").
    // Treat as viewable so status reduces to a simple has-a-record check,
    // never a meaningless network call against a page that's already gone.
    const permission = deleted ? 'can-view' : await checkViewPermission(pageId, user.accountId);
    const canView = permission !== 'cannot-view' && permission !== 'deleted-user';

    const status = computeStatus({
      confirmedVersions: latest ? [latest.pageVersion] : [],
      // Falling back to the latest confirmed version when the page is
      // deleted (currentVersion is null) makes any existing record compare
      // equal to "current" -> confirmed; no record -> outstanding. Never
      // reaches the expired branch for a deleted page, which matches "no
      // reminders, no chasing a page that no longer exists".
      currentVersion: currentVersion ?? latest?.pageVersion ?? 0,
      reconfirmOnChange: config.reconfirmOnChange,
      canView,
    });

    return {
      accountId: user.accountId,
      status,
      assignmentType: 'assigned',
      assignmentSource: user.source,
      pageVersion: latest?.pageVersion ?? null,
      confirmedAt: latest?.confirmedAt ?? null,
      deletedUser: permission === 'deleted-user',
    };
  });

  const eligibleIds = new Set(eligible.map((u) => u.accountId));
  const voluntaryRows: DetailUserRow[] = Array.from(latestByAccount.values())
    .filter((record) => !eligibleIds.has(record.accountId))
    .map((record) => ({
      accountId: record.accountId,
      status: 'confirmed',
      assignmentType: 'voluntary',
      assignmentSource: null,
      pageVersion: record.pageVersion,
      confirmedAt: record.confirmedAt,
      deletedUser: false,
    }));

  const outstanding = assignedRows.filter((r) => r.status === 'outstanding' || r.status === 'expired');
  const confirmed = assignedRows.filter((r) => r.status === 'confirmed');
  const cannotView = assignedRows.filter((r) => r.status === 'cannot-view');

  // Self-heal (tech design §5): correct the advisory counter to the exact
  // truth just computed, so the next dashboard read is accurate "for free".
  // A deleted page's counters are frozen deliberately (data model §3.1) —
  // never touched here.
  if (!deleted && confirmed.length !== config.counters.confirmedCurrentVersion) {
    await savePageConfig({ ...config, counters: { ...config.counters, confirmedCurrentVersion: confirmed.length } });
  }

  return ok({
    pageId,
    title,
    deleted,
    currentVersion,
    summary: {
      assigned: eligible.length,
      confirmed: confirmed.length,
      outstanding: outstanding.length,
      cannotView: cannotView.length,
    },
    outstanding,
    confirmed,
    voluntary: voluntaryRows,
    cannotView,
    staleAssignedGroupIds,
  });
}

/**
 * History tab (data model §2.4, UX doc §3.3): "who was required, since
 * when". Same access gate as the drill-down itself. Diffing (domain/history)
 * is pure and locale-agnostic; this resolver's job is resolving every
 * account/group id the diff references to a display name — the frontend
 * only formats already-resolved strings through its own locale-aware `t()`
 * (docs/07 §4: i18n stays client-side, never baked in server-side).
 */
export async function getPageHistory(payload: GetPageHistoryPayload, accountId: string): Promise<Result<GetPageHistoryResponse>> {
  if (!(await isComplianceManager(accountId))) {
    return err('FORBIDDEN', 'You need compliance-manager access to view this page.');
  }

  const page = await queryAuditPage(payload.pageId, payload.cursor);
  const changesByRecord = page.results.map((record) => diffConfigChange(record.entry as unknown as ConfigChangeEntry));

  const accountIds = new Set<string>(page.results.map((record) => record.actor));
  const groupIds = new Set<string>();
  for (const changes of changesByRecord) {
    for (const change of changes) {
      if (change.kind !== 'dueDate' && change.subjectType === 'user') {
        accountIds.add(change.subjectId);
      } else if (change.kind !== 'dueDate') {
        groupIds.add(change.subjectId);
      }
    }
  }

  const [userNamePairs, groupOptions] = await Promise.all([
    mapWithConcurrency(Array.from(accountIds), NAME_RESOLUTION_CONCURRENCY, async (id): Promise<[string, string]> => [
      id,
      await resolveUserDisplayName(id, 'user'),
    ]),
    resolveGroupNames(Array.from(groupIds)),
  ]);
  const userNameById = new Map(userNamePairs);
  const groupNameById = new Map(groupOptions.map((g) => [g.id, g.name]));

  const entries = page.results.map((record, i) => ({
    at: record.at,
    actorName: userNameById.get(record.actor) ?? '[deleted user]',
    changes: changesByRecord[i].map(
      (change): HistoryChangeView =>
        change.kind === 'dueDate'
          ? { kind: 'dueDate', dueDate: change.dueDate }
          : {
              kind: change.kind,
              subjectType: change.subjectType,
              subjectName:
                (change.subjectType === 'user' ? userNameById.get(change.subjectId) : groupNameById.get(change.subjectId)) ??
                (change.subjectType === 'user' ? '[deleted user]' : '[deleted group]'),
            },
    ),
  }));

  return ok({ entries, nextCursor: page.nextCursor ?? null });
}
