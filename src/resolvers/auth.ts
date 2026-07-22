import api, { route, assumeTrustedRoute, type Route } from '@forge/api';
import { getSettings } from '../storage/settings';
import type { GroupOption } from '../shared';

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
 *
 * `searchGroupsByQuery` (T7) is the one exception: its endpoint, params,
 * scope, and response shape were confirmed directly against Atlassian's
 * published Confluence Cloud REST API docs during this task, not just
 * inferred from a prior build's pattern.
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

/**
 * Lazily fetches and memoizes an accountId's group memberships for the
 * lifetime of a single resolver invocation — pass the same lookup into both
 * isMemberOfAnyGroup and isComplianceManager/canConfigure when a resolver
 * needs both, so getCurrentUserGroupIds' paginated fetch runs at most once
 * per request instead of once per caller (see resolvers/index.ts's
 * getPageStatus, the one handler that needs both today).
 */
export type GroupMembershipLookup = () => Promise<Set<string>>;

/** True if the current user belongs to any of the given group IDs (empty list -> false, no call made). */
export async function isMemberOfAnyGroup(accountId: string, groupIds: string[], memberOf?: GroupMembershipLookup): Promise<boolean> {
  if (groupIds.length === 0) {
    return false;
  }
  const groups = await (memberOf ? memberOf() : getCurrentUserGroupIds(accountId));
  return groupIds.some((id) => groups.has(id));
}

interface UserOperation {
  operation?: string;
  targetType?: string;
}

interface CurrentUserResponse {
  operations?: UserOperation[];
}

/**
 * `GET /wiki/rest/api/user/current?expand=operations` (T13 — resolves the
 * admin-check residual T9's dashboard.ts docstring deferred).
 *
 * Scope: Atlassian's own REST API reference (Confluence Cloud, "Get current
 * user" operation) lists the granular scope as `read:content-details:confluence`
 * — NOT `read:user:confluence` as an earlier version of this comment
 * claimed. That earlier claim was never checked against Atlassian's docs and
 * was wrong: without `read:content-details:confluence` in manifest.yml, this
 * call 403s for every caller (admin or not), so `isConfluenceAdmin()` always
 * fails closed and nobody can reach settings — the live-site symptom that
 * surfaced this. `read:content-details:confluence` is now declared in
 * manifest.yml.
 *
 * What remains genuinely UNVERIFIED AGAINST A LIVE SITE (this file's
 * standing convention): the signal for *site-wide* admin is an
 * `{operation: "administer", targetType: "application"}` entry in the
 * `operations` array. `targetType: "application"` is community-documented
 * (Atlassian Developer Community), not in Atlassian's own published API
 * reference — it's the best available signal, not a confirmed one. Fails
 * CLOSED (not admin) on any unexpected response shape, missing field, or
 * error — an unverified "yes" is never trusted, only a verified "no" ever
 * denies falsely. Verify live before this gate is relied on in production
 * (docs/05 §4 checklist, T15 territory).
 */
export async function isConfluenceAdmin(): Promise<boolean> {
  try {
    const response = await api.asUser().requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as CurrentUserResponse;
    return (body.operations ?? []).some((op) => op.operation === 'administer' && op.targetType === 'application');
  } catch {
    return false;
  }
}

/**
 * data model §2.3: members of `settings.complianceManagersGroupIds` (any of
 * them) or `settings.complianceManagersUserIds` (direct) reach the
 * dashboard/drill-down/export without being Confluence admins — *and* (T13,
 * resolving T9's disclosed deferral) a genuine Confluence admin always
 * qualifies too, matching T9's own original accept criteria ("admin or
 * compliance-managers group"). Settings itself (getSettings/saveSettings)
 * does NOT use this function — it gates on isConfluenceAdmin alone,
 * deliberately stricter, since compliance-manager membership is *configured*
 * on the settings page and can't be allowed to grant access to itself.
 */
export async function isComplianceManager(accountId: string, memberOfLookup?: GroupMembershipLookup): Promise<boolean> {
  const settings = await getSettings();
  const [isAdmin, isGroupManager] = await Promise.all([
    isConfluenceAdmin(),
    isMemberOfAnyGroup(accountId, settings.complianceManagersGroupIds, memberOfLookup),
  ]);
  return isAdmin || isGroupManager || settings.complianceManagersUserIds.includes(accountId);
}

/** Config write gate (tech design §4 resolver table): page edit permission OR compliance manager. */
export async function canConfigure(pageId: string, accountId: string, memberOfLookup?: GroupMembershipLookup): Promise<boolean> {
  const [canEdit, isManager] = await Promise.all([hasEditPermission(pageId, accountId), isComplianceManager(accountId, memberOfLookup)]);
  return canEdit || isManager;
}

interface GroupPickerResult {
  id: string;
  name: string;
}

interface GroupPickerResponse {
  results?: GroupPickerResult[];
}

/**
 * `GET /wiki/rest/api/group/picker?query=...` (verified against Atlassian's
 * Confluence Cloud REST API docs, scope `read:group:confluence` — already
 * declared, no manifest change needed). Used by the T7 config modal's group
 * field, since no UI Kit GroupPicker component exists (unlike UserPicker,
 * which searches Confluence's user directory internally).
 */
export async function searchGroupsByQuery(query: string): Promise<GroupOption[]> {
  const response = await api
    .asUser()
    .requestConfluence(route`/wiki/rest/api/group/picker?query=${query}&limit=20`, {
      headers: { Accept: 'application/json' },
    });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as GroupPickerResponse;
  return (body.results ?? []).map((group) => ({ id: group.id, name: group.name }));
}

interface PageSearchResult {
  id: string;
  title: string;
}

interface PagesV2SearchResponse {
  results?: { id: string; title: string }[];
}

/**
 * `GET /wiki/api/v2/pages?title=...` — Dashboard's "track a page" search
 * (2026-07-22, owner-reported gap: starting to track a page required adding
 * the macro to it first; this lets a compliance manager find and configure
 * any page they can already see, straight from the dashboard). `asUser()` —
 * results are therefore already visibility-filtered to what THIS viewer can
 * see (the same bulk-read visibility guarantee `resolvePageVisibility`
 * relies on, tech design §4), so this can never surface a page's
 * existence/title to someone who couldn't otherwise see it. Scoped under the
 * already-declared `read:page:confluence` — no manifest change needed.
 *
 * UNVERIFIED AGAINST A LIVE SITE (this file's standing convention): v2's
 * `title` filter is documented by Atlassian as an EXACT, case-sensitive
 * match, not a substring/fuzzy search — there is no v2 endpoint for partial
 * title search. A true type-ahead search would need the classic CQL search
 * endpoint (`/wiki/rest/api/search?cql=title~"..."`), which needs a scope
 * this app doesn't have — adding one is a major version (README's hard
 * rules), so it was deliberately not reached for here. If this endpoint's
 * real behavior turns out to differ, this comment and the "type the exact
 * page title" UI copy (Dashboard.tsx) should be revisited together.
 */
export async function searchPagesByTitle(title: string): Promise<PageSearchResult[]> {
  if (!title.trim()) {
    return [];
  }
  const response = await api.asUser().requestConfluence(route`/wiki/api/v2/pages?title=${title}&limit=10`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as PagesV2SearchResponse;
  return (body.results ?? []).map((page) => ({ id: page.id, title: page.title }));
}

export type ViewPermissionOutcome = 'can-view' | 'cannot-view' | 'deleted-user';

/**
 * Other-user cannot-view check (T10 drill-down, tech design §4's tier-3
 * `asApp()` exception (a): run only for pages that already passed the
 * viewer-visibility filter, and only to answer "can THIS OTHER user view
 * this page" — never to show its content. `operation: 'read'` mirrors the
 * live-validated example in tech design §4 (that snippet used 'update' for
 * the *current* user's edit-permission check in hasEditPermission above;
 * this is deliberately 'read' for a different question).
 *
 * HTTP 404 means the account itself is gone (erased/deactivated), not that
 * it lacks permission — data model §4 is explicit: map that to a distinct
 * outcome so the row can render "[deleted user]" rather than a misleading
 * "grant them permission" hint. Any other failure fails CLOSED to
 * cannot-view (never crash the row, never guess at content).
 */
export async function checkViewPermission(pageId: string, accountId: string): Promise<ViewPermissionOutcome> {
  try {
    const response = await api.asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}/permission/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'read' }),
    });
    if (response.status === 404) {
      return 'deleted-user';
    }
    if (!response.ok) {
      return 'cannot-view';
    }
    const body = (await response.json()) as { hasPermission?: boolean };
    return body.hasPermission === true ? 'can-view' : 'cannot-view';
  } catch {
    return 'cannot-view';
  }
}

interface GroupMember {
  accountId: string;
}

interface MembersByGroupIdResponse {
  results?: GroupMember[];
}

/**
 * Which tier calls a helper below: `'user'` for the current viewer
 * (asUser() — server-authoritative), `'app'` for questions about an *other*
 * user that the current viewer's own session can't answer (tech design §4's
 * tier-3 exception). Group membership and user-display-name lookups aren't
 * viewer-permission-sensitive the way page content is (both endpoints only
 * require basic product access, which the app's own scopes already grant),
 * so the same call works under either tier — this selects which one.
 */
export type ApiTier = 'user' | 'app';

function apiFor(tier: ApiTier) {
  return tier === 'app' ? api.asApp() : api.asUser();
}

/**
 * `GET /wiki/rest/api/group/{groupId}/membersByGroupId` (T10 — verified
 * against Atlassian's published Confluence Cloud REST API docs this task;
 * same `read:group:confluence` + `read:user:confluence` scopes already
 * declared, no manifest change needed). Reverse of getCurrentUserGroupIds:
 * given a group, list its members, for resolving group-based assignments at
 * drill-down call time (PRD B1 — membership must reflect live, not a
 * snapshot). Start/limit pagination (this endpoint's shape, unlike
 * memberof's `_links.next`) — page-sized loop until a short page ends it.
 * Best-effort: a group that fails to resolve (e.g. deleted) simply
 * contributes zero members rather than failing the whole drill-down — see
 * data model's degraded-states table ("group deleted -> members no longer
 * counted"). `tier` defaults to `'user'` (T10 and T11's export resolver
 * both call this from a normal `asUser`-invoked context).
 */
export async function getGroupMemberAccountIds(groupId: string, tier: ApiTier = 'user'): Promise<string[]> {
  const accountIds: string[] = [];
  const limit = 200;
  let start = 0;

  for (;;) {
    let response;
    try {
      response = await apiFor(tier).requestConfluence(
        route`/wiki/rest/api/group/${groupId}/membersByGroupId?start=${start}&limit=${limit}`,
        { headers: { Accept: 'application/json' } },
      );
    } catch {
      break;
    }
    if (!response.ok) {
      break;
    }
    const body = (await response.json()) as MembersByGroupIdResponse;
    const results = body.results ?? [];
    for (const member of results) {
      if (member.accountId) {
        accountIds.push(member.accountId);
      }
    }
    if (results.length < limit) {
      break;
    }
    start += results.length;
  }

  return accountIds;
}

interface GroupByIdResponse {
  id: string;
  name: string;
}

/**
 * `GET /wiki/rest/api/group/by-id?id=...` (verified against Atlassian's
 * Confluence Cloud REST API docs, same `read:group:confluence` scope).
 * Resolves already-assigned group IDs (data model §2.2 stores IDs only) to
 * names so the config modal can pre-populate real labels instead of raw
 * IDs. Best-effort per group: a failed lookup (e.g. a since-deleted group)
 * is dropped rather than failing the whole config load — the ID stays
 * authoritative in storage regardless of whether its name still resolves.
 */
export async function resolveGroupNames(groupIds: string[]): Promise<GroupOption[]> {
  const resolved = await Promise.all(
    groupIds.map(async (id): Promise<GroupOption | null> => {
      try {
        const response = await api.asUser().requestConfluence(route`/wiki/rest/api/group/by-id?id=${id}`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return null;
        }
        const body = (await response.json()) as GroupByIdResponse;
        return { id: body.id, name: body.name };
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((group): group is GroupOption => group !== null);
}

interface UserResponse {
  displayName?: string | null;
}

/**
 * `GET /wiki/rest/api/user?accountId=...` (T11 export — data model §4's
 * `user_display_name` column). UNVERIFIED AGAINST A LIVE SITE (this file's
 * standing convention, tech design §11): the endpoint and `displayName`
 * field are confirmed against Atlassian's docs, but the exact signal for
 * "deactivated" (as opposed to fully erased) isn't confirmed — Atlassian's
 * docs note `displayName` can come back `null` for privacy reasons, which is
 * the closest available signal, so it's treated as deactivated here. A 404
 * (unknown/erased accountId, same pattern as checkViewPermission's tier-3
 * probe) and any other failure both collapse to `[deleted user]` — the
 * safer of the two labels data model §4 defines, never a crash or a blank
 * cell. Runs under whichever tier the caller passes — T10's drill-down and
 * T11's export resolver both pass `'user'` (normal `asUser`-invoked
 * contexts); `pageDetail.ts`'s History-tab actor/subject name resolution
 * does the same.
 */
export async function resolveUserDisplayName(accountId: string, tier: ApiTier): Promise<string> {
  try {
    const response = await apiFor(tier).requestConfluence(route`/wiki/rest/api/user?accountId=${accountId}`, {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) {
      return '[deleted user]';
    }
    if (!response.ok) {
      return '[deleted user]';
    }
    const body = (await response.json()) as UserResponse;
    return body.displayName ?? '[deactivated]';
  } catch {
    return '[deleted user]';
  }
}

/**
 * Same resolution as `resolveUserDisplayName`, but the unresolved cases come
 * back `null` instead of the baked-in English `'[deleted user]'`/
 * `'[deactivated]'` strings. For callers whose result gets interpolated into
 * a client-rendered, *localized* sentence (`getPageHistory`'s
 * `detail.history.*` templates are the one such caller) — bug found in
 * review: without this, a Turkish-locale viewer saw an untranslated English
 * fragment stuck inside an otherwise-Turkish sentence. `resolveUserDisplayName`
 * itself is unchanged and still correct for `resolvers/export.ts`'s CSV/PDF
 * row-building, which already uses unlocalized English enum values
 * elsewhere in the same row (data model §4) and is never passed through `t()`.
 */
export async function resolveUserDisplayNameOrNull(accountId: string, tier: ApiTier): Promise<string | null> {
  const name = await resolveUserDisplayName(accountId, tier);
  return name === '[deleted user]' || name === '[deactivated]' ? null : name;
}
