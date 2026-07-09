import api, { route, assumeTrustedRoute, type Route } from '@forge/api';
import { getSettings } from '../storage/settings';

/**
 * Role/permission gate helpers (tech design §4's three-tier model). Every
 * check here runs `asUser()` — the calling user's own permissions,
 * server-authoritative — because everything in this file answers questions
 * about the CURRENT user, never an *other* user's access. Tier-3 `asApp()`
 * other-user checks (cannot-view fan-out) belong to T10, not here.
 *
 * UNVERIFIED AGAINST A LIVE SITE (flagged per the project's own convention
 * for spike-pending assumptions, tech design §11): the exact endpoint/field
 * names below (`/wiki/api/v2/pages/{id}`, `/wiki/api/v2/spaces/{id}`,
 * `/wiki/rest/api/user/memberof`, permission-check `operation: 'update'`)
 * are believed correct but have not been exercised against a real
 * Confluence site in this session. Every helper here fails CLOSED on an
 * unexpected response shape or error (denies the permission / treats the
 * page as unreadable) rather than crashing or failing open — verify during
 * the next real Forge deploy-and-test pass (docs/05 §4 checklist).
 */

export interface PageRead {
  id: string;
  title: string;
  version: number;
  spaceId: string;
}

export type PageReadResult = { ok: true; page: PageRead } | { ok: false; status: number };

/**
 * The server-authoritative page read (tech design §4/§6.3): proves the
 * current user can view the page (non-200 = can't) and supplies the version
 * that gets recorded — never the client-sent one.
 */
export async function readPageAsUser(pageId: string): Promise<PageReadResult> {
  const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const body = (await response.json()) as { id: string; title: string; version: { number: number }; spaceId: string };
  return {
    ok: true,
    page: { id: body.id, title: body.title, version: body.version.number, spaceId: body.spaceId },
  };
}

/**
 * Best-effort space key lookup (data model §2.1: "we record where it was").
 * Never blocks a confirmation on failure — falls back to the numeric
 * spaceId so the record still has *something* denormalized, and the
 * confirmation itself (the audit-critical part) is unaffected.
 */
export async function resolveSpaceKey(spaceId: string): Promise<string> {
  try {
    const response = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces/${spaceId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return spaceId;
    }
    const body = (await response.json()) as { key?: string };
    return body.key ?? spaceId;
  } catch {
    return spaceId;
  }
}

/** Classic content-permission-check API, current user's own `update` (edit) permission. */
export async function hasEditPermission(pageId: string, accountId: string): Promise<boolean> {
  try {
    const response = await api.asUser().requestConfluence(route`/wiki/rest/api/content/${pageId}/permission/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'update' }),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { hasPermission?: boolean };
    return body.hasPermission === true;
  } catch {
    return false;
  }
}

interface ConfluenceGroup {
  id: string;
}

interface MemberOfResponse {
  results?: ConfluenceGroup[];
  _links?: { next?: string };
}

/** All group IDs the current user belongs to (paginated). Used for both
 * group-based assignment (isAssigned) and compliance-manager gating. */
export async function getCurrentUserGroupIds(accountId: string): Promise<Set<string>> {
  const groupIds = new Set<string>();
  let next: Route | undefined = route`/wiki/rest/api/user/memberof?accountId=${accountId}&limit=200`;

  while (next) {
    const response = await api.asUser().requestConfluence(next, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      break;
    }
    const body = (await response.json()) as MemberOfResponse;
    for (const group of body.results ?? []) {
      groupIds.add(group.id);
    }
    next = body._links?.next ? assumeTrustedRoute(body._links.next) : undefined;
  }

  return groupIds;
}

/** True if the current user belongs to any of the given group IDs (empty list -> false, no call made). */
export async function isMemberOfAnyGroup(accountId: string, groupIds: string[]): Promise<boolean> {
  if (groupIds.length === 0) {
    return false;
  }
  const memberOf = await getCurrentUserGroupIds(accountId);
  return groupIds.some((id) => memberOf.has(id));
}

/** data model §2.3: members of `settings.complianceManagersGroupId` reach the dashboard without being Confluence admins. */
export async function isComplianceManager(accountId: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.complianceManagersGroupId) {
    return false;
  }
  const memberOf = await getCurrentUserGroupIds(accountId);
  return memberOf.has(settings.complianceManagersGroupId);
}

/** Config write gate (tech design §4 resolver table): page edit permission OR compliance manager. */
export async function canConfigure(pageId: string, accountId: string): Promise<boolean> {
  const [canEdit, isManager] = await Promise.all([hasEditPermission(pageId, accountId), isComplianceManager(accountId)]);
  return canEdit || isManager;
}
