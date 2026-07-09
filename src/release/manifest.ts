import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

/**
 * Minimal shape of manifest.yml this module cares about (docs/07 §6, T14) —
 * not a full Forge manifest type, just the fields the release guards check.
 */
interface ForgeManifest {
  permissions: { scopes: string[] };
  modules: {
    webtrigger?: Array<{ key: string; function: string }>;
  };
}

/** Reads and parses the repo-root manifest.yml. Test-only — never bundled into a Forge function. */
export function loadManifest(): ForgeManifest {
  const raw = readFileSync(join(__dirname, '..', '..', 'manifest.yml'), 'utf8');
  return load(raw) as ForgeManifest;
}
