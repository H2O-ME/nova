/**
 * The column's top row: the brand seat and the collapse toggle.
 * Ported from deepseek-harness `ui-sidebar/src/client/SidebarRoot.tsx`
 * (the `.logoRow` block) (c) 2026 DeepSeek — MIT License.
 *
 * Expanded, the brand doubles as a New Session shortcut; the rail has no brand
 * seat (this bundle carries no brand mark glyph, and the reference's rail mark
 * is its fish logo), so the toggle stands alone there.
 */
import { PanelIcon } from '../icons.js';
import { SIDEBAR_COPY as COPY, cls } from './view.js';
import css from './Sidebar.module.css';

export function SidebarLogoRow({
  wide,
  collapsed,
  onToggleCollapsed,
  onStartSession,
}: {
  /** The wide layout (expanded, or still fading out of a live collapse). */
  wide: boolean;
  /** Rail state: the toggle's copy and box follow the settled collapse. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The brand's click: the reference wires it to New Session. */
  onStartSession: () => void;
}): JSX.Element {
  return (
    <div className={css.logoRow}>
      {wide && (
        <button
          type="button"
          className={cls(css.brand, css.wide)}
          aria-label={COPY['session.new.label']}
          onClick={onStartSession}
        >
          <span className={css.brandIdentity} aria-hidden="true">
            <span className={css.brandName}>
              <span className={css.fallbackBrandName}>{COPY.brand}</span>
            </span>
          </span>
        </button>
      )}
      <button
        type="button"
        className={css.iconButton}
        aria-label={collapsed ? COPY['toggle.open'] : COPY['toggle.collapse']}
        title={collapsed ? COPY['toggle.open'] : COPY['toggle.collapse']}
        onClick={onToggleCollapsed}
      >
        <PanelIcon className={css.panelIcon} />
      </button>
    </div>
  );
}