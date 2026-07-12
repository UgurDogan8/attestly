import { diffConfigChange, type ConfigChangeEntry, type ConfigChangeSnapshot } from './history';

function snapshot(overrides: Partial<ConfigChangeSnapshot> = {}): ConfigChangeSnapshot {
  return { assignedUsers: [], assignedGroups: [], dueDate: null, ...overrides };
}

describe('diffConfigChange (data model §2.4 — History tab diff)', () => {
  it('on a "created" entry (before === null), every after-field reads as newly assigned', () => {
    const entry: ConfigChangeEntry = {
      action: 'created',
      before: null,
      after: snapshot({ assignedUsers: ['acc-1'], assignedGroups: ['g1'], dueDate: '2026-08-01' }),
    };
    expect(diffConfigChange(entry)).toEqual(
      expect.arrayContaining([
        { kind: 'assigned', subjectType: 'user', subjectId: 'acc-1' },
        { kind: 'assigned', subjectType: 'group', subjectId: 'g1' },
        { kind: 'dueDate', dueDate: '2026-08-01' },
      ]),
    );
  });

  it('reports added and removed users/groups on an "updated" entry', () => {
    const entry: ConfigChangeEntry = {
      action: 'updated',
      before: snapshot({ assignedUsers: ['acc-1', 'acc-2'], assignedGroups: ['g1'] }),
      after: snapshot({ assignedUsers: ['acc-2', 'acc-3'], assignedGroups: [] }),
    };
    expect(diffConfigChange(entry)).toEqual(
      expect.arrayContaining([
        { kind: 'assigned', subjectType: 'user', subjectId: 'acc-3' },
        { kind: 'removed', subjectType: 'user', subjectId: 'acc-1' },
        { kind: 'removed', subjectType: 'group', subjectId: 'g1' },
      ]),
    );
    // acc-2 is unchanged — never reported.
    expect(diffConfigChange(entry)).not.toContainEqual(expect.objectContaining({ subjectId: 'acc-2' }));
  });

  it('reports a dueDate change only when it actually changed', () => {
    const unchanged: ConfigChangeEntry = {
      action: 'updated',
      before: snapshot({ dueDate: '2026-08-01' }),
      after: snapshot({ dueDate: '2026-08-01' }),
    };
    expect(diffConfigChange(unchanged)).toEqual([]);

    const cleared: ConfigChangeEntry = {
      action: 'updated',
      before: snapshot({ dueDate: '2026-08-01' }),
      after: snapshot({ dueDate: null }),
    };
    expect(diffConfigChange(cleared)).toEqual([{ kind: 'dueDate', dueDate: null }]);
  });

  it('a no-op update (identical before/after) produces no changes', () => {
    const snap = snapshot({ assignedUsers: ['acc-1'], assignedGroups: ['g1'], dueDate: '2026-08-01' });
    const entry: ConfigChangeEntry = { action: 'updated', before: snap, after: { ...snap } };
    expect(diffConfigChange(entry)).toEqual([]);
  });
});
