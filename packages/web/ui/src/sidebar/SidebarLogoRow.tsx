/**
 * The column's top row: the brand seat and the collapse toggle.
 * Ported from deepseek-harness `ui-sidebar/src/client/SidebarRoot.tsx`
 * (the `.logoRow` block) (c) 2026 DeepSeek — MIT License.
 *
 * Expanded, the brand doubles as a New Session shortcut; the rail has no brand
 * seat (this bundle carries no brand mark glyph, and the reference's rail mark
 * is its fish logo), so the toggle stands alone there.
 *
 * The rail toggle carries a real tooltip rather than only a `title`: in the
 * 56px rail the glyph is the whole control (no label anywhere on screen), so
 * the name has to be readable without a pointer — a `title` never appears for a
 * keyboard user. Expanded, the row already reads as a labelled control family
 * and the tooltip stays off, which is the reference's own `disabled={wide}`.
 */
import { PanelIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { SIDEBAR_COPY as COPY, cls } from './view.js';
import css from './Sidebar.module.css';

export function SidebarLogoRow({
  wide,
  collapsed,
  autoCollapsed = false,
  onToggleCollapsed,
  onStartSession,
}: {
  /** The wide layout (expanded, or still fading out of a live collapse). */
  wide: boolean;
  /** Rail state: the toggle's copy and box follow the settled collapse. */
  collapsed: boolean;
  /**
   * The rail is drawn because the FRAME is narrower than
   * `SIDEBAR_AUTO_COLLAPSE`, not because the reader closed the column. The label
   * says so: the reported defect was a sidebar that "just disappeared", and a
   * rail whose only affordance looks exactly like the reader's own collapse
   * cannot answer "where did it go, and why".
   */
  autoCollapsed?: boolean;
  onToggleCollapsed: () => void;
  /** The brand's click: the reference wires it to New Session. */
  onStartSession: () => void;
}): JSX.Element {
  const toggleLabel = collapsed
    ? autoCollapsed ? COPY['toggle.openAuto'] : COPY['toggle.open']
    : COPY['toggle.collapse'];
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
      <Tooltip label={toggleLabel} side="right" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={toggleLabel}
          title={toggleLabel}
          {...(autoCollapsed ? { 'data-auto-collapsed': '' } : {})}
          onClick={onToggleCollapsed}
        >
          <PanelIcon className={css.panelIcon} />
        </button>
      </Tooltip>
    </div>
  );
}