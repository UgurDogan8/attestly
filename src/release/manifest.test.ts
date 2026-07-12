import { loadManifest } from './manifest';

/**
 * Release guards (docs/07 §6, T14; docs/08 TC-H1/TC-H2). These replace the
 * reference's `forge eligibility` RoA gate. TC-H2 originally asserted
 * exactly one (token-guarded, accepted-trade-off) webtrigger existed; a
 * later PR review removed the webtrigger entirely (export moved to a normal
 * resolver + Custom UI download surface, docs/07 §5) — the guard's whole
 * point (catch an accidental webtrigger before it ships) still holds, just
 * inverted: this app should now have zero.
 */
describe('manifest release guards', () => {
  it('TC-H1: scope snapshot — any PR touching permissions.scopes must consciously update this snapshot', () => {
    const manifest = loadManifest();
    expect(manifest.permissions.scopes).toMatchSnapshot();
  });

  it('TC-H2: no webtrigger exists — export runs through the normal resolver + Custom UI, never an inbound HTTP endpoint', () => {
    const manifest = loadManifest();
    expect(manifest.modules.webtrigger ?? []).toHaveLength(0);
  });
});
