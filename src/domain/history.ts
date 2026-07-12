/**
 * config-audit before/after diffing (data model §2.4, docs/06 T10 History
 * tab — "who was required since when"). Pure: no @forge/* imports, same
 * convention as status.ts/export.ts — every id here is resolved to a
 * display name by the caller (resolvers/pageDetail.ts), never here.
 */

export interface ConfigChangeSnapshot {
  assignedUsers: string[];
  assignedGroups: string[];
  dueDate: string | null;
}

/** Shape `saveConfig` writes into `config-audit.entry` (resolvers/index.ts). */
export interface ConfigChangeEntry {
  action: 'created' | 'updated';
  before: ConfigChangeSnapshot | null;
  after: ConfigChangeSnapshot;
}

export type HistoryChange =
  | { kind: 'assigned'; subjectType: 'user' | 'group'; subjectId: string }
  | { kind: 'removed'; subjectType: 'user' | 'group'; subjectId: string }
  | { kind: 'dueDate'; dueDate: string | null };

function diffIds(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((id) => !beforeSet.has(id)),
    removed: before.filter((id) => !afterSet.has(id)),
  };
}

/**
 * `before === null` on the initial `created` entry (resolvers/index.ts) —
 * every assignee/group/due-date in `after` reads as newly assigned.
 */
export function diffConfigChange(entry: ConfigChangeEntry): HistoryChange[] {
  const before = entry.before ?? { assignedUsers: [], assignedGroups: [], dueDate: null };
  const after = entry.after;
  const changes: HistoryChange[] = [];

  const users = diffIds(before.assignedUsers, after.assignedUsers);
  for (const subjectId of users.added) changes.push({ kind: 'assigned', subjectType: 'user', subjectId });
  for (const subjectId of users.removed) changes.push({ kind: 'removed', subjectType: 'user', subjectId });

  const groups = diffIds(before.assignedGroups, after.assignedGroups);
  for (const subjectId of groups.added) changes.push({ kind: 'assigned', subjectType: 'group', subjectId });
  for (const subjectId of groups.removed) changes.push({ kind: 'removed', subjectType: 'group', subjectId });

  if (before.dueDate !== after.dueDate) {
    changes.push({ kind: 'dueDate', dueDate: after.dueDate });
  }

  return changes;
}
