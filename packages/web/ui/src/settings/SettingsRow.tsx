/**
 * One settings row: title + one-line description on the left, a control on
 * the right — the shape every 通用设置 row shares
 * (gap 8, pad 16/0, hairline separator).
 * The section column strips the trailing separator wherever it ends.
 */
import type { ReactNode } from 'react';
import { cx } from '../composer/cx.js';
import css from './SettingsRow.module.css';

export interface SettingsRowProps {
  /** The row's one-line label. */
  title: string;
  /** One-line explanation rendered under the title. */
  description?: string | undefined;
  /** The control on the row's right edge. */
  children: ReactNode;
  /**
   * Widen the control seat to 280px from `sm` up (the reference's
   * `controlLayout="wide"`: `sm:grid-cols-[minmax(0,1fr)_280px]`, single
   * column below) — for controls longer than the 192px seat the switches and
   * selects share, e.g. the appearance page's three theme pills.
   */
  wide?: boolean;
}

/**
 * Render one settings row.
 * @param props - see SettingsRowProps.
 * @returns the row element tree.
 */
export function SettingsRow({ title, description, children, wide = false }: SettingsRowProps): JSX.Element {
  return (
    <div className={cx(css.row, wide && css.rowWide)}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        {description !== undefined && <div className={css.desc}>{description}</div>}
      </div>
      <div className={css.control}>{children}</div>
    </div>
  );
}
