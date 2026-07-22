import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  EmptyState,
  HelperMessage,
  Icon,
  Inline,
  Label,
  LoadingButton,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  UserPicker,
  xcss,
} from '@forge/react';
import type { IconProps } from '@forge/react';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import { useDebouncedCallback } from './useDebouncedCallback';
import { useLatestOnly } from './useLatestOnly';
import { SurfaceHeader } from './SurfaceHeader';
import { openExportPage } from './exportNavigation';
import { toSelectOptions, normalizeUserPickerValue, normalizeSelectValue } from './multiPickerValue';
import type {
  GetSettingsPayload,
  GetSettingsResponse,
  SaveSettingsPayload,
  SearchGroupsPayload,
  GroupOption,
} from '../../shared';

/**
 * Settings global page (docs/06 T13, UX doc §3.5): compliance-managers
 * users/groups picker (multi, same UserPicker isMulti + Select isMulti
 * pattern as ConfigModal.tsx's per-page assignment — see multiPickerValue.ts),
 * export all data (opens the Custom UI export surface via `openExportPage()`
 * with no scope override — that surface's own default scope is "site"), and
 * the 28-day/21-day data-lifecycle notice.
 *
 * The "defaults for new configurations" (reconfirm-on-change default) section
 * that used to sit here was removed (owner decision, 2026-07-22): v1 has no
 * code path that reads a *different* default for new configs, so the toggle
 * was permanently disabled and did nothing — confusing with no payoff. Bring
 * it back once v1.1 actually implements per-site reconfirm defaults.
 *
 * Gated on isConfluenceAdmin alone (resolvers/settings.ts) — a compliance
 * manager who isn't a Confluence admin reaches the dashboard but not this
 * page, matching T13's accept criteria and the bootstrap reasoning in
 * auth.ts's isComplianceManager docstring (this page is where that group
 * gets configured in the first place).
 *
 * Pickers follow ConfigModal.tsx's established uncontrolled-field rule:
 * `defaultValue` is seeded once from the loaded settings, never from the
 * state `onChange` writes to.
 */

const GROUP_SEARCH_DEBOUNCE_MS = 300;

const sectionStyles = xcss({ borderRadius: 'radius.medium' });

interface SettingsSectionProps {
  icon: IconProps['glyph'];
  title: string;
  children: React.ReactNode;
}

/** A visually-separated group within the settings page (2026-07-12 UI pass) — the same subtle-card
 * treatment as the dashboard's filter toolbar, so unrelated settings ("who can manage this",
 * "get your data out") don't read as one undifferentiated list. */
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

  const [managerUsers, setManagerUsers] = useState<string[]>([]);
  const [managerGroups, setManagerGroups] = useState<GroupOption[]>([]);
  const [groupSearchOptions, setGroupSearchOptions] = useState<ReturnType<typeof toSelectOptions>>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [exportNavError, setExportNavError] = useState(false);
  const { runLatest } = useLatestOnly();

  const groupSearch = useDebouncedCallback(async (query: string) => {
    // Review finding: an older, slower search response landing after a
    // newer one must not overwrite it.
    const result = await runLatest(() => searchGroupsInvoke.run({ query }));
    if (result?.ok) {
      setGroupSearchOptions(toSelectOptions(result.data));
    }
  }, GROUP_SEARCH_DEBOUNCE_MS);

  async function handleExportClick(): Promise<void> {
    const opened = await openExportPage();
    setExportNavError(!opened);
  }

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
      setManagerUsers(result.data.complianceManagersUserIds);
      setManagerGroups(result.data.complianceManagersGroupOptions);
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
      complianceManagersUserIds: managerUsers,
      complianceManagersGroupIds: managerGroups.map((g) => g.id),
      // Locked in v1 (no UI control any longer) -- preserve whatever was loaded.
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
    return <Spinner label={t('common.loading')} />;
  }

  return (
    <Stack space="space.200">
      <SurfaceHeader icon="settings" title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <SettingsSection icon="people-group" title={t('settings.managers')}>
        <Box>
          <UserPicker
            name="managerUsers"
            label={t('settings.managers.users')}
            isMulti
            defaultValue={initial.complianceManagersUserIds}
            onChange={(value) => setManagerUsers(normalizeUserPickerValue(value))}
            placeholder={t('settings.managers.users.placeholder')}
          />
        </Box>
        <Box>
          <Label labelFor="managerGroups">{t('settings.managers.groups')}</Label>
          <Select
            inputId="managerGroups"
            isMulti
            isLoading={searchGroupsInvoke.loading}
            defaultValue={toSelectOptions(initial.complianceManagersGroupOptions)}
            options={groupSearchOptions}
            onInputChange={handleGroupInputChange}
            onChange={(value) => setManagerGroups(normalizeSelectValue(value))}
            placeholder={t('settings.managers.groups.placeholder')}
          />
        </Box>
        <HelperMessage>{t('settings.managers.hint')}</HelperMessage>

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

      <SettingsSection icon="download" title={t('settings.exportAll')}>
        <HelperMessage>{t('settings.exportAll.hint')}</HelperMessage>
        {exportNavError ? (
          <SectionMessage appearance="error">
            <Text>{t('export.navError')}</Text>
          </SectionMessage>
        ) : null}
        <Box>
          <Button iconBefore="export" onClick={() => void handleExportClick()}>
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
