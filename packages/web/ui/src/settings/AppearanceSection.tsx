/**
 * The 外观 section: the reference keeps appearance as its OWN nav page
 * (`settingsPageConfig.ts`'s `appearance` entry, Palette icon), not as rows on
 * 常规 — the page owns the theme mode and the interface font size, and the
 * reading surface's own look is what the reader opens it for.
 *
 * Every control writes through the host the same way its composer seat does, so
 * a pick here and a pick there are one fact, not two.
 */
import { SETTINGS_COPY } from './copy.js';
import { AppearanceRow } from './AppearanceRow.js';
import { FontSizeRow } from './FontSizeRow.js';
import { SettingsGroup } from './SettingsGroup.js';
import type { ThemePreference } from '../theme.js';

export interface AppearanceSectionProps {
  /** The persisted appearance preference. */
  preference: ThemePreference;
  /** The persisted interface font size, in px. */
  fontSize: number;
  onPickPreference: (preference: ThemePreference) => void;
  onPickFontSize: (px: number) => void;
}

/**
 * Render the 外观 section.
 * @param props - see AppearanceSectionProps.
 * @returns the section element tree.
 */
export function AppearanceSection({
  preference,
  fontSize,
  onPickPreference,
  onPickFontSize,
}: AppearanceSectionProps): JSX.Element {
  return (
    <SettingsGroup
      title={SETTINGS_COPY['general.groupUi']}
      description={SETTINGS_COPY['general.groupUiDesc']}
    >
      <AppearanceRow preference={preference} onPick={onPickPreference} />
      <FontSizeRow fontSize={fontSize} onPick={onPickFontSize} />
    </SettingsGroup>
  );
}
