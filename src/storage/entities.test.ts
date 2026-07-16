import { ENTITY, confirmationKey, pageConfigKey, configAuditKey, SETTINGS_KEY } from './entities';

describe('entity names (data model §2 — must stay lowercase, platform constraint)', () => {
  it.each(Object.values(ENTITY))('%s matches the manifest naming pattern', (name) => {
    expect(name).toMatch(/^[a-z0-9:\-_.]*$/);
  });
});

describe('confirmationKey (data model §2.1 — deterministic -> idempotent)', () => {
  it('is deterministic for the same inputs', () => {
    expect(confirmationKey('page-1', 'acc-1', 7)).toBe(confirmationKey('page-1', 'acc-1', 7));
  });

  it('changes when any component changes', () => {
    const base = confirmationKey('page-1', 'acc-1', 7);
    expect(confirmationKey('page-2', 'acc-1', 7)).not.toBe(base);
    expect(confirmationKey('page-1', 'acc-2', 7)).not.toBe(base);
    expect(confirmationKey('page-1', 'acc-1', 8)).not.toBe(base);
  });

  it('has the expected shape', () => {
    expect(confirmationKey('page-1', 'acc-1', 7)).toBe('confirm#page-1#acc-1#7');
  });

  it('rejects a pageId containing "#" (review finding, docs/07 §7.1: key-segment collision)', () => {
    expect(() => confirmationKey('123#acc-2#5', 'acc-1', 7)).toThrow(/#/);
  });
});

describe('pageId key-segment safety (review finding, docs/07 §7.1)', () => {
  it('pageConfigKey rejects a pageId containing "#"', () => {
    expect(() => pageConfigKey('123#other')).toThrow(/#/);
  });

  it('configAuditKey rejects a pageId containing "#"', () => {
    expect(() => configAuditKey('123#other', '2026-07-09T00:00:00Z', 'n1')).toThrow(/#/);
  });
});

describe('pageConfigKey / configAuditKey / SETTINGS_KEY', () => {
  it('pageConfigKey is keyed by pageId only', () => {
    expect(pageConfigKey('page-1')).toBe('config#page-1');
  });

  it('configAuditKey includes page, timestamp and a nonce for uniqueness', () => {
    const a = configAuditKey('page-1', '2026-07-09T00:00:00Z', 'n1');
    const b = configAuditKey('page-1', '2026-07-09T00:00:00Z', 'n2');
    expect(a).not.toBe(b);
    expect(a).toBe('cfgaudit#page-1#2026-07-09T00:00:00Z#n1');
  });

  it('SETTINGS_KEY is a fixed singleton key', () => {
    expect(SETTINGS_KEY).toBe('settings#global');
  });
});
