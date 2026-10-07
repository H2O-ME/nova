/**
 * The sidebar's 插件 entry: the plugin center's door.
 *
 * Ported from deepseek-harness `ui-plugin-manager` (c) 2026 DeepSeek — MIT
 * License, which contributes a SIDEBAR panel entry (`PANEL_ID = 'plugins'`)
 * whose page owns the main column. Nova shipped the same page as a section
 * inside the settings dialog, so the plugin center sat two clicks deep behind
 * 设置 while the reference keeps it beside 新会话 — the placement this fixes.
 *
 * Geometry is the reference's panel-list row, not the New Session bar: a plain
 * nav row (icon + label, hover fill, the ACTIVE row filled), which in the rail
 * becomes the 36×36 icon control and takes its label from a tooltip.
 */
import { PluginIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { SIDEBAR_COPY as COPY, cls } from './view.js';
import css from './Sidebar.module.css';

export function PluginsEntryButton({
  wide,
  active,
  onOpen,
}: {
  /** The wide layout (expanded, or still fading out of a live collapse). */
  wide: boolean;
  /** The plugin center owns the main column: this row is the current page. */
  active: boolean;
  onOpen: () => void;
}): JSX.Element {
  const label = COPY['plugins.entry'];
  return (
    <Tooltip label={label} side="right" delayMs={500} disabled={wide}>
      <button
        type="button"
        className={cls(css.pluginsEntry, active && css.pluginsEntryActive)}
        aria-label={label}
        title={label}
        /* The row is the current page, not a link to one: `aria-current` is what
           a screen reader announces, and it is the same fact the fill paints. */
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        <PluginIcon className={css.pluginsEntryIcon} />
        {wide && <span className={cls(css.pluginsEntryLabel, css.wide)}>{label}</span>}
      </button>
    </Tooltip>
  );
}
