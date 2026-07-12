/**
 * Minimal, per-test-configurable fake of the @forge/api surface this app
 * uses: `asUser()/asApp().requestConfluence(route, init)`, plus the `route`
 * and `assumeTrustedRoute` template helpers. Tests supply a handler mapping
 * URL (+ method) to a canned response; there is no attempt to simulate real
 * Confluence beyond that.
 *
 * Usage — mock the real module per test file:
 *
 *   jest.mock('@forge/api', () => {
 *     const { FakeForgeApi, fakeRoute, fakeAssumeTrustedRoute } = require('../testUtils/forgeApiFake');
 *     return { __esModule: true, default: new FakeForgeApi(), route: fakeRoute, assumeTrustedRoute: fakeAssumeTrustedRoute };
 *   });
 *   import apiFake from '@forge/api';
 *   const fakeApi = apiFake as unknown as FakeForgeApi;
 *   beforeEach(() => fakeApi.setHandler(myHandler));
 */

export interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export function jsonResponse(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

export interface FakeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FakeRequestHandler = (url: string, init?: FakeRequestInit) => FakeResponse | Promise<FakeResponse>;

const notConfigured: FakeRequestHandler = (url) => {
  throw new Error(`forgeApiFake: no handler configured for request to "${url}" — call setHandler() in the test.`);
};

export class FakeForgeApi {
  private handler: FakeRequestHandler = notConfigured;
  /** Tracks which tier issued the most recent request -- lets tests assert
   * a helper called asApp() vs asUser() without the handler itself caring. */
  lastTier: 'user' | 'app' | undefined;

  setHandler(handler: FakeRequestHandler): void {
    this.handler = handler;
  }

  private request(url: { value: string } | string, init?: FakeRequestInit): Promise<FakeResponse> {
    const urlString = typeof url === 'string' ? url : url.value;
    return Promise.resolve(this.handler(urlString, init));
  }

  asUser(): { requestConfluence: FakeForgeApi['request'] } {
    this.lastTier = 'user';
    return { requestConfluence: (url, init) => this.request(url, init) };
  }

  asApp(): { requestConfluence: FakeForgeApi['request'] } {
    this.lastTier = 'app';
    return { requestConfluence: (url, init) => this.request(url, init) };
  }
}

export function fakeRoute(strings: TemplateStringsArray, ...values: unknown[]): { value: string } {
  let result = strings[0];
  values.forEach((value, i) => {
    result += String(value) + strings[i + 1];
  });
  return { value: result };
}

export function fakeAssumeTrustedRoute(url: string): { value: string } {
  return { value: url };
}
