/**
 * The column's top row: the brand seat and the collapse toggle.
 *
 * The brand doubles as the New Session shortcut in BOTH states (2026-11-22,
 * ZCode alignment): the reference's top-left cluster pairs its logo with the
 * new-task entry (`DesktopTopOverlay` renders the logo, then the new-task
 * button beside it), so the rail keeps a new-task entry at the brand's seat
 * instead of losing it with the wide bar. The 56px rail seats one control per
 * row, so the pair stacks — brand (new session) on top, the collapse toggle
 * right below, never obscured.
 *
 * Every rail control carries a real tooltip rather than only a `title`: in the
 * 56px rail the glyph is the whole control (no label anywhere on screen), so
 * the name has to be readable without a pointer — a `title` never appears for a
 * keyboard user. Expanded, the row already reads as a labelled control family
 * and the tooltip stays off, which is the reference's own `disabled={wide}`.
 */
import { PanelIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { SIDEBAR_COPY as COPY } from './view.js';
import { cx } from '../composer/cx.js';
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
  /** The brand's click: the reference wires its logo seat to New Session. */
  onStartSession: () => void;
}): JSX.Element {
  const toggleLabel = collapsed
    ? autoCollapsed ? COPY['toggle.openAuto'] : COPY['toggle.open']
    : COPY['toggle.collapse'];
  return (
    /* The desktop shell's frameless window drags from here (Tauri reads
       `data-tauri-drag-region` on mousedown and moves the window). The value is
       `deep`, not the bare attribute: the bare form only drags when the pressed
       element IS the attributed one, and the brand button fills this row — so
       the row's own padding was the only draggable strip, effectively zero. The
       brand and toggle are buttons, which the drag script exempts, so their
       clicks are unaffected. In a browser the attribute is inert. */
    <div className={css.logoRow} data-tauri-drag-region="deep">
      <Tooltip label={COPY['session.new.label']} side="right" delayMs={500} disabled={wide}>
        <button
          type="button"
          className={cx(css.brand, css.wide)}
          aria-label={COPY['session.new.label']}
          onClick={onStartSession}
        >
          <span className={css.brandMark} aria-hidden="true">
            {COPY.brand.slice(0, 1)}
          </span>
        </button>
      </Tooltip>
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
