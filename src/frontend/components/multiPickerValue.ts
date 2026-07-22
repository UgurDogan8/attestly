import type { GroupOption } from '../../shared';

/**
 * Shared between ConfigModal.tsx (per-page assignment) and SettingsPage.tsx
 * (compliance managers) — both need the same UserPicker `isMulti` + group
 * `Select` `isMulti` normalization, so it lives here once instead of twice.
 */

export interface SelectOption {
  label: string;
  value: string;
}

export function toSelectOptions(groups: GroupOption[]): SelectOption[] {
  return groups.map((g) => ({ label: g.name, value: g.id }));
}

/** UI Kit's UserPicker/Select onChange hands back a single item, an array, or null/undefined depending on isMulti and whether the field was cleared -- always coerce to an array before filtering/mapping. */
function normalizeMultiValue<Item, R>(value: unknown, isItem: (item: unknown) => item is Item, map: (item: Item) => R): R[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter(isItem).map(map);
}

export function normalizeUserPickerValue(value: unknown): string[] {
  return normalizeMultiValue(value, (item): item is { id: string } => !!item && typeof item === 'object' && 'id' in item, (item) => item.id);
}

export function normalizeSelectValue(value: unknown): GroupOption[] {
  return normalizeMultiValue(
    value,
    (item): item is SelectOption => !!item && typeof item === 'object' && 'value' in item && 'label' in item,
    (item) => ({ id: item.value, name: item.label }),
  );
}
