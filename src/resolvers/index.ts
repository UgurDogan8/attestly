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
  type GetDashboardPayload,
  type GetDashboardResponse,
} from '../shared';
import { computeStatus } from '../domain/status';
import type { ConfirmationRecord } from '../domain/confirm';
import { getLatestConfirmation, writeConfirmation } from '../storage/confirmations';
import { getPageConfig, savePageConfig, type PageConfigRecord } from '../storage/configs';
import { appendAuditEntry } from '../storage/audit';
import {
  readPageAsUser,
  resolveSpaceKey,
  isMemberOfAnyGroup,
  canConfigure,
  searchGroupsByQuery,
  resolveGroupNames,
} from './auth';
import { getDashboardRows } from './dashboard';
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

async function resolveIsAssigned(config: PageConfigRecord | undefined, accountId: string): Promise<boolean> {
  if (!config) {
    return false;
  }
  if (config.assignedUsers.includes(accountId)) {
    return true;
  }
  return isMemberOfAnyGroup(accountId, config.assignedGroups);
}

export function registerResolvers(resolver: Resolver): void {
  resolver.define<PageStatusPayload, Result<PageStatusResponse>>('getPageStatus', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId } = request.payload;

      const pageRead = await readPageAsUser(pageId);
      if (!pageRead.ok) {
        return err('PAGE_READ_FAILED', `Could not read page ${pageId} (status ${pageRead.status}).`);
      }

      const [config, latest, mayConfigure] = await Promise.all([
        getPageConfig(pageId),
        getLatestConfirmation(pageId, accountId),
        canConfigure(pageId, accountId),
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
        isAssigned: await resolveIsAssigned(config, accountId),
        confirmedAt: latest?.confirmedAt ?? null,
        canConfigure: mayConfigure,
      });
    } catch (error) {
      return err('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error.');
    }
  });

  resolver.define<ConfirmPayload, Result<ConfirmResponse>>('confirm', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId, pageVersion: clientVersion } = request.payload;

      const pageRead = await readPageAsUser(pageId);
      if (!pageRead.ok) {
        return err('PAGE_READ_FAILED', `Could not read page ${pageId} (status ${pageRead.status}).`);
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

  resolver.define<GetConfigPayload, Result<ConfigResponse>>('getConfig', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId } = request.payload;

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
    } catch (error) {
      return err('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error.');
    }
  });

  resolver.define<SaveConfigPayload, Result<ConfigResponse>>('saveConfig', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId, assignedUsers, assignedGroups, dueDate, reconfirmOnChange } = request.payload;

      if (!(await canConfigure(pageId, accountId))) {
        return err('FORBIDDEN', 'You need page edit permission or compliance-manager access to change this configuration.');
      }

      const existing = await getPageConfig(pageId);
      const nowIso = new Date().toISOString();

      let spaceKey = existing?.spaceKey;
      if (!spaceKey) {
        const pageRead = await readPageAsUser(pageId);
        if (!pageRead.ok) {
          return err('PAGE_READ_FAILED', `Could not read page ${pageId} (status ${pageRead.status}).`);
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

      await savePageConfig(updated);
      await appendAuditEntry({
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
    } catch (error) {
      return err('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error.');
    }
  });

  resolver.define<SearchGroupsPayload, Result<GroupOption[]>>('searchGroups', async (request) => {
    try {
      const accountId = requireAccountId(request);
      const { pageId, query } = request.payload;

      if (!(await canConfigure(pageId, accountId))) {
        return err('FORBIDDEN', 'You need page edit permission or compliance-manager access to search groups.');
      }

      return ok(await searchGroupsByQuery(query));
    } catch (error) {
      return err('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error.');
    }
  });

  resolver.define<GetDashboardPayload, Result<GetDashboardResponse>>('getDashboard', async (request) => {
    try {
      const accountId = requireAccountId(request);
      return await getDashboardRows(request.payload, accountId);
    } catch (error) {
      return err('INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error.');
    }
  });
}
