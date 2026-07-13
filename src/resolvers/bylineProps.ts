import api, { route } from '@forge/api';
import { computeStatus } from '../domain/status';
import { getLatestConfirmation } from '../storage/confirmations';
import { getPageConfig } from '../storage/configs';
import { isMemberOfAnyGroup } from './auth';
import { translate } from '../shared';

/**
 * `dynamicProperties` handler for the byline chip (docs/06 T8, UX doc §2.2).
 * NOT invoked through @forge/resolver's Resolver/invoke() mechanism T4's
 * resolvers use — verified against Atlassian's Forge docs, this is a plain
 * `(payload, context) => value` function module, a genuinely different
 * calling convention. Computes {title, tooltip} for the chip shown in the
 * byline list; the platform automatically re-invokes this after the
 * dialog closes (confirmed against Atlassian's Forge community docs) —
 * "chip refreshes after dialog close" (T8 accept criteria) is satisfied by
 * simply returning fresh values here, no push-update code needed.
 *
 * Chip states (UX doc §2.2): required / confirmed {date} / expired /
 * hidden (best-effort — see below). R4-style "expired" IS shown here,
 * unlike the macro/dialog's v1 fallback (ConfirmBlock docstring) — chip
 * text is cheap to differentiate and the UX doc explicitly lists it as a
 * distinct chip state.
 *
 * UNVERIFIED AGAINST A LIVE SITE (this project's convention for
 * spike-pending assumptions, tech design §11): the exact payload shape
 * (`payload.extension.content.id`) per Atlassian's docs, and whether
 * `asUser()` is valid in this invocation context at all — tech design §4
 * only confirms `asUser()` for UI-invoked resolver calls, a different
 * mechanism from this one. Uses `asApp()` for the page-version read
 * instead: a chip's display doesn't need the same view-permission proof
 * `confirm`'s audit-critical write does, and `asApp()` is guaranteed to
 * work regardless of invocation context. Fails safe throughout: any
 * missing field, unexpected shape, or thrown error returns `{}` (no
 * update — the manifest's static "Read confirmation" title stays) rather
 * than throwing, since an uncaught error here could break byline
 * rendering for every viewer of the page, not just this app's own surface.
 *
 * English-only: no locale field is confirmed available in this context
 * (unlike `view.getContext()` client-side, used by the dialog itself via
 * useI18n). The full dialog (Byline.tsx) localizes properly; the chip
 * does not, until a locale field here is confirmed live.
 */

interface BylineDynamicPropertiesPayload {
  extension?: { content?: { id?: string } };
}

interface BylineContext {
  principal?: { accountId?: string };
}

interface BylineProperties {
  title?: string;
  tooltip?: string;
}

async function readCurrentVersionAsApp(pageId: string): Promise<number | null> {
  try {
    const response = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { version: { number: number } };
    return body.version.number;
  } catch {
    return null;
  }
}

/** Locale-free, deterministic (server-side; no viewer-local-timezone concept here unlike the client-rendered dialog). */
function formatUtcDate(iso: string): string {
  return iso.slice(0, 10);
}

export async function handler(
  payload: BylineDynamicPropertiesPayload,
  context: BylineContext,
): Promise<BylineProperties> {
  try {
    const contentId = payload?.extension?.content?.id;
    const accountId = context?.principal?.accountId;
    if (!contentId || !accountId) {
      return {};
    }

    const [currentVersion, config, latest] = await Promise.all([
      readCurrentVersionAsApp(contentId),
      getPageConfig(contentId),
      getLatestConfirmation(contentId, accountId),
    ]);
    if (currentVersion === null) {
      return {};
    }

    const isAssigned =
      !!config &&
      (config.assignedUsers.includes(accountId) || (await isMemberOfAnyGroup(accountId, config.assignedGroups)));

    if (!isAssigned && !latest) {
      // "Not assigned, no voluntary record: byline hidden" (UX doc §2.2) --
      // best-effort via an empty title; true conditional module visibility
      // isn't confirmed achievable through dynamicProperties alone.
      return { title: '' };
    }

    const status = computeStatus({
      confirmedVersions: latest ? [latest.pageVersion] : [],
      currentVersion,
      reconfirmOnChange: config?.reconfirmOnChange ?? false,
      canView: true,
    });

    if (status === 'confirmed' && latest) {
      return { title: translate('en', 'byline.confirmed', { date: formatUtcDate(latest.confirmedAt) }) };
    }
    if (status === 'expired') {
      return { title: translate('en', 'byline.expired') };
    }
    return { title: translate('en', 'byline.required') };
  } catch {
    return {};
  }
}
