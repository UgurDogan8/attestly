/**
 * Spike M0-6: minimal resolver to prove invoke() works from a custom macro
 * config resource (the product's saveConfig path depends on it).
 */
import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('ping', async ({ context }) => ({
  pong: true,
  accountId: context.accountId ?? null,
  contentId: (context.extension as { content?: { id?: string } } | undefined)?.content?.id ?? null,
}));

export const handler = resolver.getDefinitions();
