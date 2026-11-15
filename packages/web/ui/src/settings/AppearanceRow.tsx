/**
 * 界面主题 row: the reference's `settings.themeMode` — a labeled row whose
 * control is a 260px select, not the three-cube chooser this used to draw.
 *
 * The cubes were a figma-era deviation: three ~190×80 slabs for a setting with
 * three plain states, inside a card whose other rows carry 32px controls. The
 * reference states the choice as one select (`SelectTrigger size="lg"` showing
 * the active mode's glyph), and that is the control shape every row on the
 * 常规 page reads as now.
 *
 * Selection follows the persisted preference, never the resolved active theme:
 * a reader on 系统 while the OS is dark must still see 系统 in the trigger.
 */
import { FollowSystemIcon, MoonIcon, SunIcon } from '../icons.js';
import { ModeSelect } from '../conversation/PermissionSelect.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsRow } from './SettingsRow.js';
import type { ThemePreference } from '../theme.js';
import css from './AppearanceRow.module.css';

/** The three preferences, in the reference's order (`THEME_MODES`:
 *  system → dark → light). */
const OPTIONS: readonly {
  code: ThemePreference;
  label: string;
  hint: string;
  Icon: typeof SunIcon;
}[] = [
  {
    code: 'system',
    label: SETTINGS_COPY['appearance.system'],
    hint: '跟随系统外观',
    Icon: FollowSystemIcon,
  },
  { code: 'dark', label: SETTINGS_COPY['appearance.dark'], hint: '深色界面', Icon: MoonIcon },
  { code: 'light', label: SETTINGS_COPY['appearance.light'], hint: '浅色界面', Icon: SunIcon },
];

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
        align="end"
        glyphOf={(code) => {
          const option = OPTIONS.find((candidate) => candidate.code === code);
          return option === undefined ? undefined : <option.Icon />;
        }}
        variant="field"
        className={css.field}
      />
    </SettingsRow>
  );
}
