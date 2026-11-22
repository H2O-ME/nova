/**
 * 界面主题 row: three peer modes stated as segment pills — the reference's
 * `SegmentPill` shape (`settings/PluginStoreListView.tsx:262-289`), the form
 * it gives a short row of flat choices (its own usage tabs ride it at
 * `SettingsPage.tsx:210`). The theme row used to be a 260px field select; the
 * task here moves the three modes onto the pills and widens the row's control
 * seat for them (`SettingsRow`'s `wide`, the reference's
 * `sm:grid-cols-[minmax(0,1fr)_280px]`). The reference itself keeps a select
 * on this row (`settingsCodePreview.tsx:129-145`); the pills are the same
 * family's answer for exactly three always-visible options, taken per this
 * page's alignment brief.
 *
 * Selection follows the persisted preference, never the resolved active theme:
 * a reader on 系统 while the OS is dark must still see 系统 pressed.
 */
import { SETTINGS_COPY } from './copy.js';
import { SegmentPill } from './SegmentPill.js';
import { SettingsRow } from './SettingsRow.js';
import type { ThemePreference } from '../theme.js';
import css from './AppearanceRow.module.css';

/** The three preferences, in the reference's order (`THEME_MODES`:
 *  system → dark → light). */
const OPTIONS: readonly {
  code: ThemePreference;
  label: string;
  hint: string;
}[] = [
  {
    code: 'system',
    label: SETTINGS_COPY['appearance.system'],
    hint: '跟随系统外观',
  },
  { code: 'dark', label: SETTINGS_COPY['appearance.dark'], hint: '深色界面' },
  { code: 'light', label: SETTINGS_COPY['appearance.light'], hint: '浅色界面' },
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
      wide
    >
      <div className={css.modes} role="group" aria-label={SETTINGS_COPY['appearance.title']}>
        {OPTIONS.map((option) => (
          <SegmentPill
            key={option.code}
            label={option.label}
            title={option.hint}
            active={preference === option.code}
            onPick={() => { onPick(option.code); }}
          />
        ))}
      </div>
    </SettingsRow>
  );
}
