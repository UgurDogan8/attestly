import { InMemoryKvs } from '../testUtils/kvsFake';
import { FakeForgeApi, jsonResponse } from '../testUtils/forgeApiFake';
import { aPageConfig } from '../testUtils/fixtures';

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
import { writeConfirmation } from '../storage/confirmations';
import { handler } from './bylineProps';

const fakeKvs = kvsFake as unknown as InMemoryKvs;
const fakeApi = apiFake as unknown as FakeForgeApi;

const PAYLOAD = { extension: { content: { id: 'page-1' } } };
const CONTEXT = { principal: { accountId: 'acc-1' } };

function pageVersionHandler(version: number) {
  return (_url: string) => jsonResponse(200, { id: 'page-1', title: 'Policy', version: { number: version }, spaceId: '111' });
}

beforeEach(() => {
  fakeKvs.reset();
});

describe('bylineProps handler (T8 chip — dynamicProperties, not the Resolver/invoke mechanism)', () => {
  it('returns {} when contentId is missing from the payload', async () => {
    fakeApi.setHandler(pageVersionHandler(1));
    expect(await handler({ extension: {} }, CONTEXT)).toEqual({});
  });

  it('returns {} when accountId is missing from the context', async () => {
    fakeApi.setHandler(pageVersionHandler(1));
    expect(await handler(PAYLOAD, {})).toEqual({});
  });

  it('returns {} (fails safe) when the page read fails', async () => {
    fakeApi.setHandler(() => jsonResponse(404, {}));
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({});
  });

  it('returns {} (fails safe) rather than throwing on an unexpected error', async () => {
    fakeApi.setHandler(() => {
      throw new Error('network blip');
    });
    await expect(handler(PAYLOAD, CONTEXT)).resolves.toEqual({});
  });

  it('hides the chip (empty title) for an uninvolved viewer: not assigned, no record', async () => {
    fakeApi.setHandler(pageVersionHandler(1));
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: '' });
  });

  it('shows "Confirmation required" for an assigned, unconfirmed viewer', async () => {
    fakeApi.setHandler(pageVersionHandler(1));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'] }));
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: 'Confirmation required' });
  });

  it('shows "Confirmed {date}" for a confirmed viewer at the current version', async () => {
    fakeApi.setHandler(pageVersionHandler(3));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'] }));
    await writeConfirmation({
      pageId: 'page-1',
      spaceKey: 'SEC',
      pageVersion: 3,
      accountId: 'acc-1',
      confirmedAt: '2026-07-12T11:03:00.000Z',
      assignmentType: 'assigned',
      appVersion: '0.1.0',
      schemaVersion: 1,
    });
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: 'Confirmed 2026-07-12' });
  });

  it('shows "Confirmed" for a voluntary confirmer even though not assigned', async () => {
    fakeApi.setHandler(pageVersionHandler(1));
    await writeConfirmation({
      pageId: 'page-1',
      spaceKey: 'SEC',
      pageVersion: 1,
      accountId: 'acc-1',
      confirmedAt: '2026-07-12T11:03:00.000Z',
      assignmentType: 'voluntary',
      appVersion: '0.1.0',
      schemaVersion: 1,
    });
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: 'Confirmed 2026-07-12' });
  });

  it('shows "Re-confirmation required" when the page moved past the confirmed version and reconfirm is on', async () => {
    fakeApi.setHandler(pageVersionHandler(7));
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: ['acc-1'], reconfirmOnChange: true }));
    await writeConfirmation({
      pageId: 'page-1',
      spaceKey: 'SEC',
      pageVersion: 5,
      accountId: 'acc-1',
      confirmedAt: '2026-07-01T00:00:00.000Z',
      assignmentType: 'assigned',
      appVersion: '0.1.0',
      schemaVersion: 1,
    });
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: 'Re-confirmation required' });
  });

  it('assigned via group counts as assigned (does not hide the chip)', async () => {
    fakeApi.setHandler((url) => {
      if (url.includes('/user/memberof')) return jsonResponse(200, { results: [{ id: 'sec-all' }] });
      return pageVersionHandler(1)(url);
    });
    await savePageConfig(aPageConfig({ pageId: 'page-1', assignedUsers: [], assignedGroups: ['sec-all'] }));
    expect(await handler(PAYLOAD, CONTEXT)).toEqual({ title: 'Confirmation required' });
  });
});
