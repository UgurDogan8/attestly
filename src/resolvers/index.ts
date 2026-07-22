import type Resolver from '@forge/resolver';
import type { Request } from '@forge/resolver';
import {
  ok,
  err,
  type Result,
  type PageStatusPayload,
  type PageStatusResponse,
  type ConfirmPayload,
  type ConfirmResponse,
  type GetConfigPayload,
  type SaveConfigPayload,
  type ConfigResponse,
  type SearchGroupsPayload,
  type GroupOption,
  type SearchPagesPayload,
  type PageOption,
  type GetDashboardPayload,
  type GetDashboardResponse,
  type GetPageDetailPayload,
  type GetPageDetailResponse,
  type GetPageHistoryPayload,
  type GetPageHistoryResponse,
  type ExportRowsPayload,
  type ExportRowsResponse,
  type BuildPdfExportPayload,
  type BuildPdfExportResponse,
  type GetSettingsPayload,
  type GetSettingsResponse,
  type SaveSettingsPayload,
} from '../shared';
import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { getLatestConfirmation, writeConfirmation } from '../storage/confirmations';
import { getPageConfig, saveConfigWithAudit, type PageConfigRecord } from '../storage/configs';
import {
  readPageAsUser,
  resolveSpaceKey,
  isMemberOfAnyGroup,
  canConfigure,
  isConfluenceAdmin,
  isComplianceManager,
  searchGroupsByQuery,
  searchPagesByTitle,
  resolveGroupNames,
  getCurrentUserGroupIds,
  type GroupMembershipLookup,
} from './auth';
import { getDashboardRows } from './dashboard';
import { getPageDetail, getPageHistory } from './pageDetail';
import { exportRows, buildPdfExport } from './export';
import { getSettingsForAdmin, saveSettingsForAdmin } from './settings';
import { APP_VERSION } from '../version';

/**
 * Thin request handlers only — business logic lives in src/domain (tech
 * design §1 layering rule). Every resolver re-checks permissions
 * server-side per the three-tier model in tech design §4; nothing here
 * trusts a client-supplied version, role flag, or assignment claim.
 */

function requireAccountId(request: Request<unknown>): string {
  const accountId = (request.context as { accountId?: string }).accountId;
  if (!accountId) {
    throw new Error('Resolver invoked without an accountId in context.');
  }
  return accountId;
}

async function resolveIsAssigned(
  config: PageConfigRecord | undefined,
  accountId: string,
  memberOfLookup?: GroupMembershipLookup,
): Promise<boolean> {
  if (!config) {
    return false;
  }
  if (config.assignedUsers.includes(accountId)) {
    return true;
  }
  return isMemberOfAnyGroup(accountId, config.assignedGroups, memberOfLookup);
}

/** Memoizes getCurrentUserGroupIds for the lifetime of one resolver call — shared by canConfigure and resolveIsAssigned in getPageStatus so a request needing both never fetches the same account's group memberships twice. */
function createGroupMembershipLookup(accountId: string): GroupMembershipLookup {
  let cached: Promise<Set<string>> | undefined;
  return () => (cached ??= getCurrentUserGroupIds(accountId));
}

/**
 * Every resolver below except `confirm` (which deliberately reports a fixed,
 * non-detail message on any failure — tech design §8) shares the exact same
 * "require an accountId, run the handler, map any thrown error to a generic
 * INTERNAL_ERROR" wrapper. Factored out once nine call sites had it
 * character-for-character identical.
 */
/**
 * Review finding: the raw `error.message` used to travel straight into the
 * client-facing Result envelope -- an unhandled storage/REST error could
 * leak internal detail (stack-adjacent text, upstream error bodies) to the
 * browser. Forge captures function logs, so the real error is still fully
 * diagnosable server-side via console.error; only a fixed, generic message
 * crosses the resolver boundary.
 */
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

function withErrorHandling<Payload, Data>(
  fn: (payload: Payload, accountId: string) => Promise<Result<Data>>,
): (request: Request<Payload>) => Promise<Result<Data>> {
  return async (request) => {
    try {
      const accountId = requireAccountId(request);
      return await fn(request.payload, accountId);
    } catch (error) {
      console.error('[resolver] unhandled error', error);
      return err('INTERNAL_ERROR', GENERIC_ERROR_MESSAGE);
    }
  };
}

export function registerResolvers(resolver: Resolver): void {
  resolver.define<PageStatusPayload, Result<PageStatusResponse>>(
    'getPageStatus',
    withErrorHandling(async ({ pageId }, accountId) => {
      const pageRead = await readPageAsUser(pageId);
      if (!pageRead.ok) {
        // Review finding: the upstream HTTP status used to be baked into
        // the message, turning a 403-vs-404 into a client-visible existence
        // oracle the docs say to collapse. Logged server-side; the frontend
        // never branches on this message's content.
        console.error('[getPageStatus] page read failed', { pageId, status: pageRead.status });
        return err('PAGE_READ_FAILED', 'Could not read the page.');
      }

      const memberOfLookup = createGroupMembershipLookup(accountId);
      const [config, latest, mayConfigure] = await Promise.all([
        getPageConfig(pageId),
        getLatestConfirmation(pageId, accountId),
        canConfigure(pageId, accountId, memberOfLookup),
      ]);

      const reconfirmOnChange = config?.reconfirmOnChange ?? false;
      const status = computeStatus({
        confirmedVersions: latest ? [latest.pageVersion] : [],
        currentVersion: pageRead.page.version,
        reconfirmOnChange,
        // The viewer of their own macro can, by definition, already view
        // the page they're looking at (readPageAsUser above already proved
        // it) — `cannot-view` is for an admin checking an *other* user
        // (T10 drill-down), never for this resolver.
        canView: true,
      });

      return ok({
        status,
        pageVersion: pageRead.page.version,
        dueDate: config?.dueDate ?? null,
        isAssigned: await resolveIsAssigned(config, accountId, memberOfLookup),
        confirmedAt: latest?.confirmedAt ?? null,
        confirmedVersion: latest?.pageVersion ?? null,
        canConfigure: mayConfigure,
      });
    }),
  );

  resolver.define<ConfirmPayload, Result<ConfirmResponse>>('confirm', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId, pageVersion: clientVersion } = request.payload;

      const pageRead = await readPageAsUser(pageId);
      if (!pageRead.ok) {
        console.error('[confirm] page read failed', { pageId, status: pageRead.status });
        return err('PAGE_READ_FAILED', 'Could not read the page.');
      }
      const serverVersion = pageRead.page.version;

      // tech design §6.3: the page changed between render and click. Detect
      // and refuse to record — never trust the client's version for the write.
      if (serverVersion !== clientVersion) {
        return ok({ outcome: 'pageChanged', currentVersion: serverVersion });
      }

      const config = await getPageConfig(pageId);
      const isAssigned = await resolveIsAssigned(config, accountId);
      const spaceKey = await resolveSpaceKey(pageRead.page.spaceId);

      const record: ConfirmationRecord = {
        pageId,
        spaceKey,
        pageVersion: serverVersion,
        accountId,
        confirmedAt: new Date().toISOString(),
        assignmentType: isAssigned ? 'assigned' : 'voluntary',
        appVersion: APP_VERSION,
        schemaVersion: 1,
      };

      const { record: written } = await writeConfirmation(record);

      const status = computeStatus({
        confirmedVersions: [written.pageVersion],
        currentVersion: serverVersion,
        reconfirmOnChange: config?.reconfirmOnChange ?? false,
        canView: true,
      });

      return ok({ outcome: 'confirmed', status, pageVersion: written.pageVersion, confirmedAt: written.confirmedAt });
    } catch {
      // tech design §8: storage failures on confirm surface as retryable —
      // the button re-enables, nothing was left half-written (writeConfirmation
      // is all-or-nothing per tech design §6.1).
      return err('CONFIRM_FAILED', "We couldn't record your confirmation. Please try again.");
    }
  });

  resolver.define<GetConfigPayload, Result<ConfigResponse>>(
    'getConfig',
    withErrorHandling(async ({ pageId }, accountId) => {
      if (!(await canConfigure(pageId, accountId))) {
        return err('FORBIDDEN', 'You need page edit permission or compliance-manager access to view this configuration.');
      }

      const config = await getPageConfig(pageId);
      return ok({
        pageId,
        assignedUsers: config?.assignedUsers ?? [],
        assignedGroups: config?.assignedGroups ?? [],
        assignedGroupOptions: config ? await resolveGroupNames(config.assignedGroups) : [],
        dueDate: config?.dueDate ?? null,
        reconfirmOnChange: config?.reconfirmOnChange ?? false,
      });
    }),
  );

  resolver.define<SaveConfigPayload, Result<ConfigResponse>>(
    'saveConfig',
    withErrorHandling(async ({ pageId, assignedUsers, assignedGroups, dueDate, reconfirmOnChange }, accountId) => {
      if (!(await canConfigure(pageId, accountId))) {
        return err('FORBIDDEN', 'You need page edit permission or compliance-manager access to change this configuration.');
      }

      const existing = await getPageConfig(pageId);
      const nowIso = new Date().toISOString();

      let spaceKey = existing?.spaceKey;
      if (!spaceKey) {
        const pageRead = await readPageAsUser(pageId);
        if (!pageRead.ok) {
          console.error('[saveConfig] page read failed', { pageId, status: pageRead.status });
          return err('PAGE_READ_FAILED', 'Could not read the page.');
        }
        spaceKey = await resolveSpaceKey(pageRead.page.spaceId);
      }

      const updated: PageConfigRecord = {
        pageId,
        spaceKey,
        active: true,
        dueDate,
        reconfirmOnChange,
        createdBy: existing?.createdBy ?? accountId,
        createdAt: existing?.createdAt ?? nowIso,
        updatedBy: accountId,
        updatedAt: nowIso,
        schemaVersion: 1,
        assignedUsers,
        assignedGroups,
        counters: existing?.counters ?? { confirmedCurrentVersion: 0 },
      };

      // One transaction (storage/configs.ts) — a config write must never
      // persist unaudited (data model §2.4): if the audit write throws, the
      // config change must not stick either. Same guarantee the confirm path
      // already gets from writeConfirmation's transaction.
      await saveConfigWithAudit(updated, {
        pageId,
        at: nowIso,
        actor: accountId,
        entry: {
          action: existing ? 'updated' : 'created',
          before: existing
            ? {
                assignedUsers: existing.assignedUsers,
                assignedGroups: existing.assignedGroups,
                dueDate: existing.dueDate,
                reconfirmOnChange: existing.reconfirmOnChange,
              }
            : null,
          after: { assignedUsers, assignedGroups, dueDate, reconfirmOnChange },
        },
        schemaVersion: 1,
      });

      return ok({
        pageId,
        assignedUsers,
        assignedGroups,
        assignedGroupOptions: await resolveGroupNames(assignedGroups),
        dueDate,
        reconfirmOnChange,
      });
    }),
  );

  resolver.define<SearchGroupsPayload, Result<GroupOption[]>>(
    'searchGroups',
    withErrorHandling(async ({ pageId, query }, accountId) => {
      // T7's config modal passes pageId (gate: canConfigure); T13's
      // settings page has no page context and gates on isConfluenceAdmin
      // instead (shared/types.ts's SearchGroupsPayload docstring).
      const allowed = pageId ? await canConfigure(pageId, accountId) : await isConfluenceAdmin();
      if (!allowed) {
        return err(
          'FORBIDDEN',
          pageId
            ? 'You need page edit permission or compliance-manager access to search groups.'
            : 'You need Confluence admin access to search groups.',
        );
      }

      return ok(await searchGroupsByQuery(query));
    }),
  );

  resolver.define<GetDashboardPayload, Result<GetDashboardResponse>>(
    'getDashboard',
    withErrorHandling((payload, accountId) => getDashboardRows(payload, accountId)),
  );

  resolver.define<SearchPagesPayload, Result<PageOption[]>>(
    'searchPages',
    withErrorHandling(async ({ query }, accountId) => {
      if (!(await isComplianceManager(accountId))) {
        return err('FORBIDDEN', 'You need compliance-manager access to search pages.');
      }
      return ok(await searchPagesByTitle(query));
    }),
  );

  resolver.define<GetPageDetailPayload, Result<GetPageDetailResponse>>(
    'getPageDetail',
    withErrorHandling((payload, accountId) => getPageDetail(payload, accountId)),
  );

  resolver.define<GetPageHistoryPayload, Result<GetPageHistoryResponse>>(
    'getPageHistory',
    withErrorHandling((payload, accountId) => getPageHistory(payload, accountId)),
  );

  resolver.define<ExportRowsPayload, Result<ExportRowsResponse>>(
    'exportRows',
    withErrorHandling((payload, accountId) => exportRows(payload, accountId)),
  );

  resolver.define<BuildPdfExportPayload, Result<BuildPdfExportResponse>>(
    'buildPdfExport',
    withErrorHandling((payload, accountId) => buildPdfExport(payload, accountId)),
  );

  resolver.define<GetSettingsPayload, Result<GetSettingsResponse>>(
    'getSettings',
    withErrorHandling(() => getSettingsForAdmin()),
  );

  resolver.define<SaveSettingsPayload, Result<GetSettingsResponse>>(
    'saveSettings',
    withErrorHandling((payload) => saveSettingsForAdmin(payload)),
  );
}
