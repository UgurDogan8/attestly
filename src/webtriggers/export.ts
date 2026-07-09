import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';

/**
 * The app's one webtrigger (docs/07 §5, manifest.yml comment). Full pipeline
 * — job lookup by token, secret check, CSV/PDF streaming — lands in T11/T12.
 * T1 only proves the function/handler wiring resolves and answers requests.
 *
 * Invariant this must keep once implemented (docs/07 §9 #6): every page this
 * handler ever reads must already have been visibility-filtered by an
 * `asUser()` resolver call (the `startExport` resolver, T11) — this handler
 * never makes its own visibility decisions.
 */
export async function handler(_request: WebTriggerRequest): Promise<WebTriggerResponse> {
  return {
    statusCode: 501,
    headers: { 'Content-Type': ['text/plain; charset=utf-8'] },
    body: 'Not implemented yet (T11/T12).',
  };
}
