/**
 * 界面主题 row: the reference's own control for this row is a SELECT, not a
 * row of pills — `settingsCodePreview.tsx:120-145` renders a 260px `Select`
 * whose three items each carry a 16px icon beside the label (`THEME_MODES` in
 * `settings/settingsPageConfig.ts:32-39`). Nova's version had turned the three
 * modes into segment pills, justified in this file's old note as "the same
 * family's answer for exactly three always-visible options". That was the
 * page's own invention: inspecting the reference, the theme row looks like
 * every other settings row (a value field on the trailing edge), and a reader
 * who has seen one settings page should not have to re-learn the fourth row's
 * control. The row now rides the same field select as 权限 / 工作步骤展示, with
 * each option carrying its mode glyph.
 *
 * Selection follows the persisted preference, never the resolved active theme:
 * a reader on 系统 while the OS is dark must still see 系统 selected.
 */
import { MoonIcon, SunIcon } from '../icons.js';
import { ModeSelect } from '../conversation/PermissionSelect.js';
import type { ModeOption } from '../conversation/PermissionSelect.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsRow } from './SettingsRow.js';
import type { ThemePreference } from '../theme.js';
import css from './AppearanceRow.module.css';

/** The three preferences, in the reference's order (`THEME_MODES`:
 *  system → dark → light). The system mode wears the half-filled circle the
 *  reference draws for it; dark and light take the moon and the sun. */
const OPTIONS: readonly ModeOption<ThemePreference>[] = [
  {
    code: 'system',
    label: SETTINGS_COPY['appearance.system'],
    hint: '跟随系统外观',
  },
  { code: 'dark', label: SETTINGS_COPY['appearance.dark'], hint: '深色界面' },
  { code: 'light', label: SETTINGS_COPY['appearance.light'], hint: '浅色界面' },
];

/** The mode glyphs the reference's select items carry (`size-4` each). */
function modeGlyph(code: string): JSX.Element | undefined {
  if (code === 'dark') return <MoonIcon />;
  if (code === 'light') return <SunIcon />;
  if (code === 'system') return <SystemHalfIcon />;
  return undefined;
}

/** The reference's contrast mark for 跟随系统 (`Contrast` in lucide). */
function SystemHalfIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
    </svg>
  );
}

export interface AppearanceRowProps {
  /** The persisted preference in force. */
  preference: ThemePreference;
  /** Switch the theme preference. */
  onPick: (preference: ThemePreference) => void;
}

/**
 * Render the appearance row.
 * @param props - see AppearanceRowProps.
 * @returns the row element tree.
 */
export function AppearanceRow({ preference, onPick }: AppearanceRowProps): JSX.Element {
  return (
    <SettingsRow
      title={SETTINGS_COPY['appearance.title']}
      description={SETTINGS_COPY['appearance.description']}
    >
      <ModeSelect
        value={preference}
        options={OPTIONS}
        name={SETTINGS_COPY['appearance.title']}
        onPick={onPick}
        side="above"
        align="end"
        variant="field"
        glyphOf={modeGlyph}
        className={css.field}
      />
    </SettingsRow>
  );
}
