/**
 * One segment in a pill row — the reference's `SegmentPill`
 * (`settings/PluginStoreListView.tsx:262-289`, also the usage tabs at
 * `SettingsPage.tsx:210`): a `rounded-full px-3 py-1` 14/500 label where the
 * active segment wears the selected wash and the idle ones stay muted until
 * hovered. It is the reference's control for a FEW flat, peer choices — used
 * here for the appearance page's three theme modes, which are labels a reader
 * picks between, not a value to open a select for.
 */
import { cx } from '../composer/cx.js';
import css from './SegmentPill.module.css';

export interface SegmentPillProps {
  /** The segment's visible label (`系统`, `深色`, `浅色`). */
  label: string;
  /** Whether this segment is the value in force. */
  active: boolean;
  /** Pick this segment. */
  onPick: () => void;
  /** Tooltip wording for the segment's meaning (idle hints ride here). */
  title?: string | undefined;
}

/**
 * Render one segment pill.
 * @param props - see SegmentPillProps.
 * @returns the pill element tree.
 */
export function SegmentPill({ label, active, onPick, title }: SegmentPillProps): JSX.Element {
  return (
    <button
      type="button"
      className={cx(css.pill, active && css.active)}
      aria-pressed={active}
      {...(title !== undefined ? { title } : {})}
      onClick={onPick}
    >
      {label}
    </button>
  );
}
