/**
 * The 通用设置 section: the reference's general column (figma 501:29980's
 * Options area) carrying this product's real axes — the permission tier, the
 * appearance preference, and the content font size — in the reference's row
 * order (权限 first, appearance and font size after), (c) 2026 DeepSeek — MIT
 * License. Every control writes through the host the same way its composer seat
 * does, so a pick here and a pick there are one fact, not two.
 *
 * The EXECUTION MODE (native / PTC / 两者) is deliberately NOT a row here. It
 * picks the toolset — part of the cached prompt prefix and the presence of the
 * `run_code` tool — so it is a property of a SESSION, not a standing
 * preference, and the hero's composer chip is where it is chosen. As a settings
 * row it made two promises it could not keep: it claimed to set 新会话的默认
 * while actually re-rostering the live kernel, and its "default for later"
 * reading meant writing `tools.code.mode` — which is also the PTC plugin's
 * SECOND opt-in door, so setting a default would silently flip that plugin's own
 * switch back on.
 */
import { PermissionSelect } from '../conversation/PermissionSelect.js';
import { SETTINGS_COPY } from './copy.js';
import { AppearanceRow } from './AppearanceRow.js';
import { FontSizeRow } from './FontSizeRow.js';
import { SettingsRow } from './SettingsRow.js';
import { SettingsSection } from './Section.js';
import type { ApprovalMode } from '../types.js';
import type { ThemePreference } from '../theme.js';

export interface GeneralSectionProps {
  /** The approval tier in force (the select's echo is the host's truth). */
  approvalMode: ApprovalMode;
  /** The persisted appearance preference. */
  preference: ThemePreference;
  /** The persisted content font size, in px. */
  fontSize: number;
  /** An ask is pending or the socket is down: the tier control refuses. */
  disabled: boolean;
  onPickApproval: (mode: ApprovalMode) => void;
  onPickPreference: (preference: ThemePreference) => void;
  onPickFontSize: (px: number) => void;
}

/**
 * Render the 通用设置 section.
 * @param props - see GeneralSectionProps.
 * @returns the section element tree.
 */
export function GeneralSection({
  approvalMode,
  preference,
  fontSize,
  disabled,
  onPickApproval,
  onPickPreference,
  onPickFontSize,
}: GeneralSectionProps): JSX.Element {
  return (
    <SettingsSection>
      <SettingsRow title={SETTINGS_COPY['permission.title']} description={SETTINGS_COPY['permission.description']}>
        {/* Upward + right-edge aligned (the reference's settings row recipe):
            the card covers the text rows above, never the controls below. */}
        <PermissionSelect value={approvalMode} onPick={onPickApproval} side="above" align="end" disabled={disabled} />
      </SettingsRow>
      <AppearanceRow preference={preference} onPick={onPickPreference} />
      <FontSizeRow fontSize={fontSize} onPick={onPickFontSize} />
    </SettingsSection>
  );
}
