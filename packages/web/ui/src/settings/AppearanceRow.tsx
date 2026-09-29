/**
 * Appearance preference row: title + three preference cubes. Ported from
 * deepseek-harness `ui-theme/src/client/AppearanceRow.tsx` +
 * `AppearanceRow.module.css` (figma 501:30012 'Frame 2117131228'),
 * (c) 2026 DeepSeek — MIT License. Selection follows the persisted
 * preference, never the resolved active theme.
 */
import { cls } from '../sidebar/view.js';
import { MoonIcon, SunIcon, FollowSystemIcon } from '../icons.js';
import type { ThemePreference } from '../theme.js';
import { SETTINGS_COPY } from './copy.js';
import css from './AppearanceRow.module.css';

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { id: 'light', label: SETTINGS_COPY['appearance.light'], Icon: SunIcon },
  { id: 'dark', label: SETTINGS_COPY['appearance.dark'], Icon: MoonIcon },
  { id: 'system', label: SETTINGS_COPY['appearance.system'], Icon: FollowSystemIcon },
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
    <div className={css.group}>
      <div className={css.title}>{SETTINGS_COPY['appearance.title']}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={cls(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { onPick(id); }}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
