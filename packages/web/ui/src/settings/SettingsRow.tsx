/**
 * One settings row: title + one-line description on the left, a control on
 * the right — the shape every 通用设置 row shares
 * (gap 8, pad 16/0, hairline separator).
 * The section column strips the trailing separator wherever it ends.
 */
import type { ReactNode } from 'react';
import css from './SettingsRow.module.css';

export interface SettingsRowProps {
  /** The row's one-line label. */
  title: string;
  /** One-line explanation rendered under the title. */
  description?: string | undefined;
  /** The control on the row's right edge. */
  children: ReactNode;
}

/**
 * Render one settings row.
 * @param props - see SettingsRowProps.
 * @returns the row element tree.
 */
export function SettingsRow({ title, description, children }: SettingsRowProps): JSX.Element {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        {description !== undefined && <div className={css.desc}>{description}</div>}
      </div>
      <div className={css.control}>{children}</div>
    </div>
  );
}
