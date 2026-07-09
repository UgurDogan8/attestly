import { loadManifest } from './manifest';

/**
 * Release guards (docs/07 §6, T14; docs/08 TC-H1/TC-H2). These replace the
 * reference's `forge eligibility` RoA gate, which is knowingly dropped here
 * (manifest.yml's webtrigger comment, docs/07 §1/§6) — a single token-guarded
 * export webtrigger is an accepted trade-off, not an accident, and these
 * tests are what keeps it that way.
 */
describe('manifest release guards', () => {
  it('TC-H1: scope snapshot — any PR touching permissions.scopes must consciously update this snapshot', () => {
    const manifest = loadManifest();
    expect(manifest.permissions.scopes).toMatchSnapshot();
  });

  it('TC-H2: exactly one webtrigger exists, and it is the export trigger', () => {
    const manifest = loadManifest();
    const webtriggers = manifest.modules.webtrigger ?? [];
    expect(webtriggers).toHaveLength(1);
    expect(webtriggers[0]).toMatchObject({ key: 'export-trigger', function: 'exportTrigger' });
  });
});
