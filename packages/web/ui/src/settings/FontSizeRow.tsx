/**
 * 界面字号 row: a labeled row whose control is the reference's compact number
 * field — 112px wide, the value right-aligned, a `px` suffix inside the box, no
 * stepper and no arrows (`FontSizeInput` in the reference's settings page).
 *
 * The stepper this replaces revealed its up/down column on hover, so the
 * control's own affordance was invisible until the pointer was already on it,
 * and the 36px pill sat a size above every other control in the column. The
 * reference's field states its value the same way the reader types it.
 *
 * The displayed value follows the persisted setting, never the local echo: a
 * host that clamps the write is what the field then shows.
 */
import { useEffect, useState } from 'react';
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
  // The draft is local so a partially-typed number is not committed on every
  // keystroke; the persisted value settles it (Enter, blur, or a write from
  // elsewhere).
  const [draft, setDraft] = useState(String(fontSize));
  useEffect(() => { setDraft(String(fontSize)); }, [fontSize]);

  const commit = (): void => {
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    const next = Number.isFinite(parsed)
      ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(parsed)))
      : fontSize;
    setDraft(String(next));
    if (next !== fontSize) onPick(next);
  };

  return (
    <SettingsRow title={SETTINGS_COPY['fontSize.title']} description={SETTINGS_COPY['fontSize.description']}>
      <div className={css.field}>
        <input
          type="number"
          inputMode="numeric"
          className={css.input}
          value={draft}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          aria-label={SETTINGS_COPY['fontSize.title']}
          onChange={(event) => { setDraft(event.currentTarget.value); }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(String(fontSize));
              event.currentTarget.blur();
            }
          }}
        />
        <span className={css.unit}>{SETTINGS_COPY['fontSize.unit']}</span>
      </div>
    </SettingsRow>
  );
}
