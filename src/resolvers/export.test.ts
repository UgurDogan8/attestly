import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';
import { aPageConfig, aConfirmation } from '../testUtils/fixtures';

jest.mock('@forge/kvs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { InMemoryKvs: FakeKvs, FakeSort, FakeWhereConditions } = require('../testUtils/kvsFake');
  return {
    __esModule: true,
    default: new FakeKvs(),
    Sort: FakeSort,
    WhereConditions: FakeWhereConditions,
  };
});

jest.mock('@forge/api', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FakeForgeApi: Fake, fakeRoute, fakeAssumeTrustedRoute } = require('../testUtils/forgeApiFake');
  return {
    __esModule: true,
    default: new Fake(),
    route: fakeRoute,
    assumeTrustedRoute: fakeAssumeTrustedRoute,
  };
});

import kvsFake from '@forge/kvs';
import apiFake from '@forge/api';
import { savePageConfig } from '../storage/configs';
import { saveSettings } from '../storage/settings';
import { writeConfirmation } from '../storage/confirmations';
import { exportFile } from './export';
import type { ExportFilePayload, ExportFileResponse } from '../shared';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

beforeEach(() => {
  fakeKvs.reset();
});

async function asManager(): Promise<void> {
  await saveSettings({ schemaVersion: 1, complianceManagersGroupId: 'managers', reconfirmDefault: false });
}

/** Manager check + bulk page visibility + "everyone can view, every name is X" -- enough to make an assigned user's row actually appear. */
function visibleHandler(pages: { id: string; title: string; version?: number }[] = []) {
  return (url: string) => {
    if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
    if (url.startsWith('/wiki/api/v2/pages?')) {
      // Review finding: a bulk result without version.number is no longer
      // trusted as visible -- default to 1 here so tests unrelated to that
      // finding keep exercising the "visible" path they were written for.
      return jsonResponse(200, { results: pages.map((p) => ({ id: p.id, title: p.title, version: { number: p.version ?? 1 } })) });
    }
    if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
    if (url.includes('/user?accountId')) return jsonResponse(200, { displayName: 'X' });
    return jsonResponse(404, {});
  };
}

async function csvOf(result: { ok: true; data: ExportFileResponse } | { ok: false }): Promise<string> {
  if (!result.ok || result.data.format !== 'csv') {
    throw new Error('expected a csv result');
  }
  return result.data.csv;
}

describe('exportFile — access gates', () => {
  it('FORBIDDEN without compliance-manager membership', async () => {
    fakeApi.setHandler(() => jsonResponse(200, { results: [] }));
    const result = await exportFile({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('exportFile — scope resolution (data model §4, visibility rule)', () => {
  it('scope "site": includes every tracked page across spaces', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler(
      visibleHandler([
        { id: 'sec-page', title: 'Sec' },
        { id: 'hr-page', title: 'HR' },
      ]),
    );

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('Sec,sec-page');
    expect(csv).toContain('HR,hr-page');
  });

  it('scope "space": includes only that space\'s tracked pages', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler(visibleHandler([{ id: 'sec-page', title: 'Sec' }]));

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'space', scopeValue: 'SEC' }, 'acc-1'));
    expect(csv).toContain('sec-page');
    expect(csv).not.toContain('hr-page');
  });

  it('scope "page": includes only that one page', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'sec-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await savePageConfig(aPageConfig({ pageId: 'hr-page', spaceKey: 'HR', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler(visibleHandler([{ id: 'sec-page', title: 'Sec' }]));

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'page', scopeValue: 'sec-page' }, 'acc-1'));
    expect(csv).toContain('sec-page');
    expect(csv).not.toContain('hr-page');
  });

  it('a restricted page is omitted entirely (visibility rule)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'visible-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await savePageConfig(aPageConfig({ pageId: 'restricted-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?'))
        return jsonResponse(200, { results: [{ id: 'visible-page', title: 'Visible', version: { number: 1 } }] });
      if (url === '/wiki/api/v2/pages/restricted-page') return jsonResponse(200, {});
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      if (url.includes('/user?accountId')) return jsonResponse(200, { displayName: 'X' });
      return jsonResponse(404, {});
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('visible-page');
    expect(csv).not.toContain('restricted-page');
  });

  it('a deleted page is included as "[deleted page {id}]" (never omitted)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'gone-page', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [] });
      if (url === '/wiki/api/v2/pages/gone-page') return jsonResponse(404, {});
      if (url.includes('/user?accountId')) return jsonResponse(200, { displayName: 'X' });
      return jsonResponse(404, {});
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('[deleted page gone-page]');
  });

  it('applies the status filter the same way the dashboard does', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 1 } }));
    await savePageConfig(aPageConfig({ pageId: 'not-done', spaceKey: 'SEC', assignedUsers: ['acc-2'], counters: { confirmedCurrentVersion: 0 } }));
    fakeApi.setHandler(
      visibleHandler([
        { id: 'done', title: 'Done' },
        { id: 'not-done', title: 'Not done' },
      ]),
    );

    const payload: ExportFilePayload = { format: 'csv', scope: 'site', statusFilter: 'complete' };
    const csv = await csvOf(await exportFile(payload, 'acc-1'));
    expect(csv).toContain('done');
    expect(csv).not.toContain('not-done');
  });

  it('PR review regression: a site export with more than 100 tracked pages still includes the overflow pages', async () => {
    await asManager();
    const pageIds = Array.from({ length: 120 }, (_, i) => `page-${i}`);
    for (const pageId of pageIds) {
      await savePageConfig(aPageConfig({ pageId, spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    }
    fakeApi.setHandler(visibleHandler(pageIds.map((id) => ({ id, title: id }))));

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    // Page 119 is well past the old 100-id bulk-read cap.
    expect(csv).toContain('page-119');
  });
});

describe('exportFile — CSV generation', () => {
  it('returns a CSV with the correct headers and a BOM-prefixed body', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [] }));
    fakeApi.setHandler(visibleHandler([{ id: 'page-1', title: 'Security Policy' }]));

    const result = await exportFile({ format: 'csv', scope: 'site' }, 'acc-1');
    expect(result.ok).toBe(true);
    const data = (result as { ok: true; data: ExportFileResponse }).data;
    expect(data.format).toBe('csv');
    expect(data.filename).toMatch(/^read-confirmations_site_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = (data as { csv: string }).csv;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv).toContain('page_title,page_id,space_key');
  });

  it('emits one row per assigned user, outstanding when never confirmed (PRD F1: the negative space)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('Security Policy,page-1,SEC,,');
    expect(csv).toContain(',acc-1,assigned,outstanding,,');
  });

  it('substitutes a placeholder for an unresolved (raw numeric) space key instead of leaking it into the export (regression: the dashboard\'s same fix was never applied here)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: '327684', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('Security Policy,page-1,(unresolved),');
    expect(csv).not.toContain('327684');
  });

  it('emits a confirmed row with its version and confirmed_at_utc', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 3, confirmedAt: '2026-07-01T10:00:00.000Z', assignmentType: 'assigned' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 3 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'Ayşe Yılmaz' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('3,Ayşe Yılmaz,acc-1,assigned,confirmed,2026-07-01T10:00:00Z');
  });

  it('PR review regression: reports expired, not confirmed, when the page has moved past the confirmed version', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'], reconfirmOnChange: true }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1, confirmedAt: '2026-07-01T10:00:00.000Z' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      // Page is live at v5 now -- the export must read this, not the confirmer's own v1.
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 5 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('acc-1,assigned,expired');
    expect(csv).not.toContain('acc-1,assigned,confirmed');
  });

  it('emits a voluntary row for a confirmer who is not assigned', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-vol', pageVersion: 1, assignmentType: 'voluntary' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('acc-vol,voluntary,confirmed');
  });

  it('emits cannot-view for an assigned user who fails the permission check, not outstanding', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-blocked'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: false });
      return jsonResponse(404, {});
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('acc-blocked,assigned,cannot-view');
  });

  it('resolves group-assigned users via membersByGroupId', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: [], assignedGroups: ['g1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('membersByGroupId')) return jsonResponse(200, { results: [{ accountId: 'acc-viaGroup' }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(404, {});
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).toContain('acc-viaGroup,assigned,outstanding');
  });

  it('applies the date range to confirmed rows only, never dropping outstanding rows', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-in', 'acc-out', 'acc-never'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-in', pageVersion: 1, confirmedAt: '2026-07-15T00:00:00.000Z' }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-out', pageVersion: 1, confirmedAt: '2026-01-01T00:00:00.000Z' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'X', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const payload: ExportFilePayload = { format: 'csv', scope: 'site', dateFrom: '2026-07-01', dateTo: '2026-07-31' };
    const csv = await csvOf(await exportFile(payload, 'acc-1'));
    expect(csv).toContain('acc-in,assigned,confirmed');
    expect(csv).not.toContain('acc-out,assigned,confirmed');
    expect(csv).toContain('acc-never,assigned,outstanding'); // negative space survives the date filter
  });
});

describe('exportFile — PDF generation (T12)', () => {
  it('returns a base64-encoded PDF', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const result = await exportFile({ format: 'pdf', scope: 'site' }, 'acc-1');
    expect(result.ok).toBe(true);
    const data = (result as { ok: true; data: ExportFileResponse }).data;
    expect(data.format).toBe('pdf');
    expect(data.filename).toMatch(/\.pdf$/);
    const pdfText = Buffer.from((data as { base64: string }).base64, 'base64').toString('latin1');
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText).toContain('acc-1');
  });

  it('produces the exact same set of (page, user) records as the CSV of the same scope (record parity)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1', 'acc-2'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 2, confirmedAt: '2026-07-05T00:00:00.000Z' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 2 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    const pdfResult = await exportFile({ format: 'pdf', scope: 'site' }, 'acc-1');
    const pdfBody = Buffer.from((pdfResult as { ok: true; data: { base64: string } }).data.base64, 'base64').toString('latin1');

    expect(csv).toContain('acc-1,assigned,confirmed');
    expect(pdfBody).toContain('acc-1');
    expect(pdfBody).toContain('confirmed');
    expect(csv).toContain('acc-2,assigned,outstanding');
    expect(pdfBody).toContain('acc-2');
    expect(pdfBody).toContain('outstanding');
    expect(csv).toContain('2026-07-05T00:00:00Z');
    expect(pdfBody).toContain('2026-07-05T00:00:00Z');
  });

  it('drops millisecond precision from confirmed_at/exported_at timestamps (data model §4)', async () => {
    await asManager();
    await savePageConfig(aPageConfig({ pageId: 'page-1', spaceKey: 'SEC', assignedUsers: ['acc-1'] }));
    await writeConfirmation(aConfirmation({ pageId: 'page-1', accountId: 'acc-1', pageVersion: 1, confirmedAt: '2026-07-05T00:00:00.123Z' }));
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'managers' }] });
      if (url.startsWith('/wiki/api/v2/pages?')) return jsonResponse(200, { results: [{ id: 'page-1', title: 'Security Policy', version: { number: 1 } }] });
      if (url.includes('/permission/check')) return jsonResponse(200, { hasPermission: true });
      return jsonResponse(200, { displayName: 'X' });
    });

    const csv = await csvOf(await exportFile({ format: 'csv', scope: 'site' }, 'acc-1'));
    expect(csv).not.toMatch(/\.\d{3}Z/);
    expect(csv).toContain('2026-07-05T00:00:00Z');
  });
});
