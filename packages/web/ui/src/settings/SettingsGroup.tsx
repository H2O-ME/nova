/**
 * One settings GROUP: a heading, its one-line explanation, and the card of rows
 * under them — the reference's `min-w-0 space-y-3` block
 * (`settingsCodePreview.tsx`'s `AppearanceSectionContent`):
 *
 *   <h3 className="text-ui-lg font-semibold">界面设置</h3>
 *   <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">…</p>
 *   <Card className="border border-border bg-card py-0 shadow-none">…</Card>
 *
 * The grouping is the point: before this, a section's cards stacked with no
 * words between them, so 「哪个开关管什么」 had to be inferred from its row. The
 * reference states each group's subject once and puts the rows under it.
 */
import type { ReactNode } from 'react';
import { SettingsSection } from './Section.js';
import css from './SettingsGroup.module.css';

export interface SettingsGroupProps {
  /** The group's subject line (`界面设置`, `代码设置`). */
  title: string;
  /** One sentence saying what the rows below govern. */
  description: string;
  /** The group's rows. */
  children: ReactNode;
}

/**
 * Render one settings group.
 * @param props - see SettingsGroupProps.
 * @returns the group element tree.
 */
export function SettingsGroup({ title, description, children }: SettingsGroupProps): JSX.Element {
  return (
    <section className={css.group}>
      <div className={css.head}>
        <h3 className={css.title}>{title}</h3>
        <p className={css.description}>{description}</p>
      </div>
      <SettingsSection>{children}</SettingsSection>
    </section>
  );
}
