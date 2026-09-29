/**
 * A settings section's content column: the scroll area's inner stack that
 * strips the last row's separator (the reference's rule —
 * `GeneralSection.module.css`: "the section strips the trailing separator
 * wherever the column ends"), (c) 2026 DeepSeek — MIT License.
 */
import type { ReactNode } from 'react';
import css from './Section.module.css';

/**
 * Render one section's column.
 * @param props.children - the section's rows.
 * @returns the section element tree.
 */
export function SettingsSection({ children }: { children: ReactNode }): JSX.Element {
  return <div className={css.section}>{children}</div>;
}
