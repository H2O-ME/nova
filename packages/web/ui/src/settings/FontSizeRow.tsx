/**
 * Font-size preference row: title + body-text description + stepper pill
 * (centered value; hover reveals the up/down arrow column anchored to the
 * pill's right edge) + a px unit label after the pill. Ported from
 * deepseek-harness `ui-theme/src/client/FontSizeRow.tsx` +
 * `FontSizeRow.module.css`, (c) 2026 DeepSeek — MIT License. The displayed
 * value follows the persisted setting, never the click echo.
 */
import { ChevronDownIcon, ChevronUpIcon } from '../icons.js';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsRow } from './SettingsRow.js';
import css from './FontSizeRow.module.css';

export interface FontSizeRowProps {
  /** The persisted size in force, in px. */
  fontSize: number;
  /** Change the content font size (integer px within the theme's bounds). */
  onPick: (px: number) => void;
}

/**
 * Render the font-size row.
 * @param props - see FontSizeRowProps.
 * @returns the row element tree.
 */
export function FontSizeRow({ fontSize, onPick }: FontSizeRowProps): JSX.Element {
  return (
    <SettingsRow title={SETTINGS_COPY['fontSize.title']} description={SETTINGS_COPY['fontSize.description']}>
      <div className={css.control}>
        <div className={css.stepper}>
          <span className={css.value}>{fontSize}</span>
          <span className={css.arrows}>
            <button
              type="button"
              className={css.arrow}
              aria-label={SETTINGS_COPY['fontSize.increase']}
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => { onPick(fontSize + 1); }}
            >
              <ChevronUpIcon />
            </button>
            <button
              type="button"
              className={css.arrow}
              aria-label={SETTINGS_COPY['fontSize.decrease']}
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => { onPick(fontSize - 1); }}
            >
              <ChevronDownIcon />
            </button>
          </span>
        </div>
        <span className={css.unit}>{SETTINGS_COPY['fontSize.unit']}</span>
      </div>
    </SettingsRow>
  );
}
