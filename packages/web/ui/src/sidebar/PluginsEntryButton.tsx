/**
 * The sidebar's 插件 entry: the plugin center's door.
 *
 * The harness contributes a SIDEBAR panel entry (`PANEL_ID = 'plugins'`)
 * whose page owns the main column. Nova shipped the same page as a section
 * inside the settings dialog, so the plugin center sat two clicks deep behind
 * 设置 while the reference keeps it beside 新会话 — the placement this fixes.
 *
 * Geometry is the reference's panel-list row, not the New Session bar: a plain
 * nav row (icon + label, hover fill, the ACTIVE row filled). One shape only —
 * the closed column has no narrow layout (the reference's panel fades out
 * whole), so the label never needs a tooltip stand-in.
 */
import { PluginIcon } from '../icons.js';
import { SIDEBAR_COPY as COPY } from './view.js';
import { cx } from '../composer/cx.js';
import css from './Sidebar.module.css';

export function PluginsEntryButton({
  active,
  onOpen,
}: {
  /** The plugin center owns the main column: this row is the current page. */
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const label = COPY['plugins.entry'];
  return (
    <button
      type="button"
      className={cx(css.pluginsEntry, active && css.pluginsEntryActive)}
      aria-label={label}
      title={label}
      /* The row is the current page, not a link to one: `aria-current` is what
         a screen reader announces, and it is the same fact the fill paints. */
      aria-current={active ? 'page' : undefined}
      onClick={onOpen}
    >
      <PluginIcon className={css.pluginsEntryIcon} />
      <span className={css.pluginsEntryLabel}>{label}</span>
    </button>
  );
}
