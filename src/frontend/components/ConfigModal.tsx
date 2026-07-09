import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  HelperMessage,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Toggle,
  UserPicker,
  DatePicker,
} from '@forge/react';
import { useI18n } from './useI18n';
import { useInvoke } from './useInvoke';
import type {
  GetConfigPayload,
  ConfigResponse,
  SaveConfigPayload,
  SearchGroupsPayload,
  GroupOption,
} from '../../shared';

/**
 * The assignment config modal (docs/06 T7, docs/07 §4.3 — the key
 * adaptation from the reference's native macro-config panel to a UI Kit
 * `Modal`). Save writes only via `invoke('saveConfig')` to KVS; there is no
 * macro `config:` block in manifest.yml for this data to leak into (tech
 * design §11.6's rule holds by construction, not by care taken here).
 *
 * Reusable: same component, same props, opens from the macro (T6) and, from
 * T10, a dashboard row — "same config editable from the dashboard later" is
 * true because this component doesn't know or care who opened it.
 *
 * UNVERIFIED AGAINST A LIVE SITE (spike-pending assumption, tech design
 * §11 convention): UserPicker/Select's exact onChange payload shape in
 * `isMulti` mode. UserPicker's own generated type only declares a
 * single-value onChange signature, but the prior Attestly build used
 * `UserPicker isMulti` successfully in production — the handlers below
 * accept both a single value and an array defensively rather than trusting
 * either shape exclusively. Select's isMulti onChange is assumed to follow
 * react-select's well-established array convention (used under
 * @atlaskit/select), a safer bet than UserPicker's less-standard widget.
 *
 * Uncontrolled-field pattern (UserPicker, DatePicker) is deliberate, not an
 * oversight: feeding `defaultValue` from the same state `onChange` writes
 * to is a known crash in this exact component family (validated live in
 * the prior Attestly build) — each field's initial value comes once from
 * the fetched config and is never rebound afterward.
 */

export interface ConfigModalProps {
  pageId: string;
  onClose: () => void;
  onSaved?: (config: ConfigResponse) => void;
}

interface SelectOption {
  label: string;
  value: string;
}

function toSelectOptions(groups: GroupOption[]): SelectOption[] {
  return groups.map((g) => ({ label: g.name, value: g.id }));
}

function normalizeUserPickerValue(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item): item is { id: string } => !!item && typeof item === 'object' && 'id' in item)
    .map((item) => item.id);
}

function normalizeSelectValue(value: unknown): GroupOption[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .filter((item): item is SelectOption => !!item && typeof item === 'object' && 'value' in item && 'label' in item)
    .map((item) => ({ id: item.value, name: item.label }));
}

const GROUP_RECOMMENDATION_THRESHOLD = 50;
const GROUP_SEARCH_DEBOUNCE_MS = 300;

export function ConfigModal({ pageId, onClose, onSaved }: ConfigModalProps): React.JSX.Element {
  const { t } = useI18n();
  const getConfigInvoke = useInvoke<GetConfigPayload, ConfigResponse>('getConfig');
  const saveConfigInvoke = useInvoke<SaveConfigPayload, ConfigResponse>('saveConfig');
  const searchGroupsInvoke = useInvoke<SearchGroupsPayload, GroupOption[]>('searchGroups');

  const [initialConfig, setInitialConfig] = useState<ConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [assignedUsers, setAssignedUsers] = useState<string[]>([]);
  const [assignedGroups, setAssignedGroups] = useState<GroupOption[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [groupSearchOptions, setGroupSearchOptions] = useState<SelectOption[]>([]);

  const groupSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getConfigInvoke.run({ pageId }).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setInitialConfig(result.data);
      setAssignedUsers(result.data.assignedUsers);
      setAssignedGroups(result.data.assignedGroupOptions);
      setDueDate(result.data.dueDate);
    });
    return () => {
      cancelled = true;
    };
    // Runs once per mount (one modal instance per open) -- getConfigInvoke.run
    // is useCallback-stable on its literal functionKey, same reasoning as Macro.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    return () => {
      if (groupSearchTimer.current) {
        clearTimeout(groupSearchTimer.current);
      }
    };
  }, []);

  function handleGroupInputChange(query: string): void {
    if (groupSearchTimer.current) {
      clearTimeout(groupSearchTimer.current);
    }
    if (!query) {
      setGroupSearchOptions([]);
      return;
    }
    groupSearchTimer.current = setTimeout(async () => {
      const result = await searchGroupsInvoke.run({ pageId, query });
      if (result.ok) {
        setGroupSearchOptions(toSelectOptions(result.data));
      }
    }, GROUP_SEARCH_DEBOUNCE_MS);
  }

  async function handleSave(): Promise<void> {
    setSaveError(null);
    const result = await saveConfigInvoke.run({
      pageId,
      assignedUsers,
      assignedGroups: assignedGroups.map((g) => g.id),
      dueDate,
      // The reconfirm toggle is disabled (v1.1) -- preserve whatever was
      // already stored rather than silently clearing it on an unrelated save.
      reconfirmOnChange: initialConfig?.reconfirmOnChange ?? false,
    });
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    onSaved?.(result.data);
    onClose();
  }

  const loading = getConfigInvoke.loading && !initialConfig;
  const isVoluntary = assignedUsers.length === 0 && assignedGroups.length === 0;
  const showGroupRecommendation = assignedUsers.length > GROUP_RECOMMENDATION_THRESHOLD;

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="large" title={t('config.title')}>
        <ModalBody>
          {loading ? <Spinner label={t('common.loadMore')} /> : null}
          {loadError ? (
            <SectionMessage appearance="error">
              <Text>{loadError}</Text>
            </SectionMessage>
          ) : null}
          {!loading && !loadError ? (
            <Stack space="space.200">
              <Box>
                <UserPicker
                  name="assignedUsers"
                  label={t('config.users')}
                  isMulti
                  defaultValue={initialConfig?.assignedUsers}
                  onChange={(value) => setAssignedUsers(normalizeUserPickerValue(value))}
                  placeholder={t('config.users.placeholder')}
                />
              </Box>
              <Box>
                <Label labelFor="assignedGroups">{t('config.groups')}</Label>
                <Select
                  inputId="assignedGroups"
                  isMulti
                  isLoading={searchGroupsInvoke.loading}
                  defaultValue={toSelectOptions(initialConfig?.assignedGroupOptions ?? [])}
                  options={groupSearchOptions}
                  onInputChange={handleGroupInputChange}
                  onChange={(value) => setAssignedGroups(normalizeSelectValue(value))}
                  placeholder={t('config.groups.placeholder')}
                />
                {showGroupRecommendation ? (
                  <SectionMessage appearance="warning">
                    <Text>{t('config.groupsHint')}</Text>
                  </SectionMessage>
                ) : (
                  <HelperMessage>{t('config.groupsHint')}</HelperMessage>
                )}
              </Box>
              {isVoluntary ? (
                <SectionMessage appearance="information">
                  <Text>{t('config.voluntaryNote')}</Text>
                </SectionMessage>
              ) : null}
              <Box>
                <Label labelFor="dueDate">{t('config.dueDate')}</Label>
                <DatePicker id="dueDate" defaultValue={dueDate ?? undefined} onChange={setDueDate} />
              </Box>
              <Inline space="space.100" alignBlock="center">
                <Toggle
                  isDisabled
                  isChecked={initialConfig?.reconfirmOnChange ?? false}
                  label={t('config.reconfirm')}
                />
                <Lozenge appearance="new">v1.1</Lozenge>
              </Inline>
              {saveError ? (
                <SectionMessage appearance="error" title={t('macro.error.title')}>
                  <Text>{saveError}</Text>
                </SectionMessage>
              ) : null}
            </Stack>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <LoadingButton
            appearance="primary"
            isLoading={saveConfigInvoke.loading}
            isDisabled={loading || !!loadError}
            onClick={handleSave}
          >
            {t('common.save')}
          </LoadingButton>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  );
}
