/**
 * Fixture builders (test plan §6: "no hand-rolled JSON in tests"). Each
 * builder returns a valid record with sensible defaults; pass `overrides`
 * for the fields a specific test cares about.
 */
import type { ConfirmationRecord } from '../domain/confirm';
import type { PageConfigRecord } from '../storage/configs';
import type { ConfigAuditRecord } from '../storage/audit';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function aConfirmation(overrides: Partial<ConfirmationRecord> = {}): ConfirmationRecord {
  return {
    pageId: nextId('page'),
    spaceKey: 'SPACE',
    pageVersion: 1,
    accountId: nextId('acc'),
    confirmedAt: '2026-07-09T00:00:00.000Z',
    assignmentType: 'assigned',
    appVersion: '0.1.0',
    schemaVersion: 1,
    ...overrides,
  };
}

export function aPageConfig(overrides: Partial<PageConfigRecord> = {}): PageConfigRecord {
  return {
    pageId: nextId('page'),
    spaceKey: 'SPACE',
    active: true,
    dueDate: null,
    reconfirmOnChange: false,
    createdBy: 'acc-admin',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedBy: 'acc-admin',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    assignedUsers: [],
    assignedGroups: [],
    counters: { confirmedCurrentVersion: 0 },
    ...overrides,
  };
}

export function anAuditEntry(overrides: Partial<ConfigAuditRecord> = {}): ConfigAuditRecord {
  return {
    pageId: nextId('page'),
    at: '2026-07-09T00:00:00.000Z',
    actor: 'acc-admin',
    entry: { action: 'assigned' },
    schemaVersion: 1,
    ...overrides,
  };
}
