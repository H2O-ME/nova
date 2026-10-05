/**
 * The two-state toggle, ported from deepseek-harness
 * `ui-primitives/src/Switch.tsx` + `Switch.module.css`, (c) 2026 DeepSeek — MIT
 * License.
 *
 * It lives here, once, because three settings sections drew their own pill and
 * all three had the same defect: the track's "on" fill was
 * `--dsw-alias-interactive-bg-active`, a 14% white overlay, while "off" was
 * `--dsw-alias-bg-module-platform`, a solid dark gray. In dark mode those two
 * are nearly the same color, so a reader could not tell an enabled row from a
 * disabled one — the reported "按钮开关我都看不出是开还是关". Three copies meant
 * three chances to get it wrong; one component means the appearance cannot
 * disagree between sections.
 *
 * The reference's two rules are both kept:
 *  - the fill keys off `aria-checked`, NOT a parallel class, so what assistive
 *    technology reads and what the eye sees are the same bit — a `data-on`
 *    attribute beside an `aria-checked` prop is two states that can drift;
 *  - the track is `border-l3` → `brand-primary` and the thumb is
 *    `label-primary-foreground`, which is a real luminance inversion in both
 *    themes rather than two shades of the same gray.
 */
import { cls } from '../sidebar/view.js';
import css from './Switch.module.css';

export interface SwitchProps {
  /** The current state; the control is fully controlled. */
  checked: boolean;
  /** Called with the state the click asks for. */
  onChange: (next: boolean) => void;
  /** Localized accessible name; required, so a render site cannot omit it. */
  label: string;
  /** Whether the control refuses input (also set while its own write is in flight). */
  disabled?: boolean;
  /** Whether this row is waiting for its own write to settle. */
  busy?: boolean;
  /** Localized hover text, typically why the toggle is locked. */
  title?: string | undefined;
  /** Extra class for layout placement. */
  className?: string | undefined;
}

/**
 * Render a toggle switch.
 * @param props - see SwitchProps.
 * @returns the switch element.
 */
export function Switch({ checked, onChange, label, disabled = false, busy = false, title, className }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={cls(css.switch, className)}
      onClick={() => { onChange(!checked); }}
    >
      <span className={css.thumb} />
    </button>
  );
}
