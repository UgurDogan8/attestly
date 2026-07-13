import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  EmptyState,
  HelperMessage,
  Icon,
  Inline,
  Label,
  Lozenge,
  LoadingButton,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Toggle,
  xcss,
} from '@forge/react';
import type { IconProps } from '@forge/react';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { useDebouncedCallback } from './useDebouncedCallback';
import { SurfaceHeader } from './SurfaceHeader';
import { openExportPage } from './exportNavigation';
import type {
  GetSettingsPayload,
  GetSettingsResponse,
  SaveSettingsPayload,
  SearchGroupsPayload,
  GroupOption,
} from '../../shared';

/**
 * Settings global page (docs/06 T13, UX doc §3.5): compliance-managers
 * group picker, defaults (reconfirm — locked in v1, same disabled+Lozenge
 * treatment as ConfigModal.tsx's per-page toggle, for the same reason:
 * nothing in v1 reads a *different* default for new configs yet), export
 * all data (opens the Custom UI export surface via `openExportPage()` with
 * no scope override — that surface's own default scope is "site"), and the
 * 28-day/21-day data-lifecycle notice.
 *
 * Gated on isConfluenceAdmin alone (resolvers/settings.ts) — a compliance
 * manager who isn't a Confluence admin reaches the dashboard but not this
 * page, matching T13's accept criteria and the bootstrap reasoning in
 * auth.ts's isComplianceManager docstring (this page is where that group
 * gets configured in the first place).
 *
 * Group picker follows ConfigModal.tsx's established uncontrolled-field
 * rule: `defaultValue` is seeded once from the loaded settings, never from
 * the `managersGroup` state `onChange` writes to.
 */

interface GroupSelectOption {
  label: string;
  value: string;
}

const GROUP_SEARCH_DEBOUNCE_MS = 300;

const sectionStyles = xcss({ borderRadius: 'radius.medium' });

interface SettingsSectionProps {
  icon: IconProps['glyph'];
  title: string;
  children: React.ReactNode;
}

/** A visually-separated group within the settings page (2026-07-12 UI pass) — the same subtle-card
 * treatment as the dashboard's filter toolbar, so unrelated settings ("who can manage this",
 * "what's the default", "get your data out") don't read as one undifferentiated list. */
function SettingsSection({ icon, title, children }: SettingsSectionProps): React.JSX.Element {
  return (
    <Box backgroundColor="color.background.neutral.subtle" padding="space.200" xcss={sectionStyles}>
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center">
          <Icon glyph={icon} label="" color="color.icon.subtle" size="small" />
          <Text weight="bold">{title}</Text>
        </Inline>
        {children}
      </Stack>
    </Box>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { t } = useI18n();
  const getSettingsInvoke = useInvoke<GetSettingsPayload, GetSettingsResponse>('getSettings');
  const saveSettingsInvoke = useInvoke<SaveSettingsPayload, GetSettingsResponse>('saveSettings');
  const searchGroupsInvoke = useInvoke<SearchGroupsPayload, GroupOption[]>('searchGroups');

  const [initial, setInitial] = useState<GetSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [managersGroup, setManagersGroup] = useState<GroupOption | null>(null);
  const [groupSearchOptions, setGroupSearchOptions] = useState<GroupSelectOption[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const groupSearch = useDebouncedCallback(async (query: string) => {
    const result = await searchGroupsInvoke.run({ query });
    if (result.ok) {
      setGroupSearchOptions(result.data.map((g) => ({ label: g.name, value: g.id })));
    }
  }, GROUP_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    let cancelled = false;
    getSettingsInvoke.run({}).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        if (result.code === 'FORBIDDEN') {
          setForbidden(true);
        } else {
          setLoadError(result.message);
        }
        return;
      }
      setInitial(result.data);
      setManagersGroup(
        result.data.complianceManagersGroupId
          ? { id: result.data.complianceManagersGroupId, name: result.data.complianceManagersGroupName ?? result.data.complianceManagersGroupId }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGroupInputChange(query: string): void {
    if (!query) {
      groupSearch.cancel();
      setGroupSearchOptions([]);
      return;
    }
    groupSearch.run(query);
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);
    setSaved(false);
    const result = await saveSettingsInvoke.run({
      complianceManagersGroupId: managersGroup?.id ?? null,
      // Locked in v1 (disabled control below) -- preserve whatever was loaded.
      reconfirmDefault: initial?.reconfirmDefault ?? false,
    });
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setInitial(result.data);
    setSaved(true);
  }

  if (forbidden) {
    return <EmptyState header={t('settings.noAccess.header')} description={t('settings.noAccess.description')} />;
  }

  if (loadError) {
    return <Text>{loadError}</Text>;
  }

  if (!initial) {
    return <Spinner label={t('common.loadMore')} />;
  }

  const defaultGroupOption: GroupSelectOption | undefined = initial.complianceManagersGroupId
    ? { label: initial.complianceManagersGroupName ?? initial.complianceManagersGroupId, value: initial.complianceManagersGroupId }
    : undefined;

  return (
    <Stack space="space.200">
      <SurfaceHeader icon="settings" title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <SettingsSection icon="people-group" title={t('settings.managers')}>
        <Box>
          <Label labelFor="managersGroup">{t('settings.managers')}</Label>
          <Select
            inputId="managersGroup"
            isClearable
            isLoading={searchGroupsInvoke.loading}
            defaultValue={defaultGroupOption}
            options={groupSearchOptions}
            onInputChange={handleGroupInputChange}
            onChange={(option: unknown) => {
              const next = option as GroupSelectOption | null;
              setManagersGroup(next ? { id: next.value, name: next.label } : null);
            }}
            placeholder={t('settings.managers.placeholder')}
          />
          <HelperMessage>{t('settings.managers.hint')}</HelperMessage>
        </Box>

        {saveError ? (
          <SectionMessage appearance="error">
            <Text>{saveError}</Text>
          </SectionMessage>
        ) : null}
        {saved ? (
          <SectionMessage appearance="success">
            <Text>{t('settings.saved')}</Text>
          </SectionMessage>
        ) : null}

        <Box>
          <LoadingButton appearance="primary" isLoading={saveSettingsInvoke.loading} onClick={handleSave}>
            {t('common.save')}
          </LoadingButton>
        </Box>
      </SettingsSection>

      <SettingsSection icon="tools" title={t('settings.defaults')}>
        <Inline space="space.100" alignBlock="center">
          <Toggle isDisabled isChecked={initial.reconfirmDefault} label={t('settings.defaults.reconfirm')} />
          <Lozenge appearance="new">v1.1</Lozenge>
        </Inline>
      </SettingsSection>

      <SettingsSection icon="download" title={t('settings.exportAll')}>
        <HelperMessage>{t('settings.exportAll.hint')}</HelperMessage>
        <Box>
          <Button iconBefore="export" onClick={() => openExportPage()}>
            {t('settings.exportAll')}
          </Button>
        </Box>
      </SettingsSection>

      <SectionMessage appearance="information" title={t('settings.lifecycle.title')}>
        <Text>{t('settings.lifecycle.body')}</Text>
      </SectionMessage>
    </Stack>
  );
}
