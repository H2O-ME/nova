/**
 * The window's top-left cluster: the product mark doubling as the sidebar
 * toggle, plus the New Session control while the sidebar is closed.
 *
 * Written against the reference's `DesktopTopOverlay` (copied in structure,
 * not in code): on Windows/Linux the first control is the logo badge, and its
 * visual swaps to a panel glyph on hover/focus (`DesktopTopOverlay.tsx:129-151`
 * — a 28px `icon-md` ghost button holding a `size-5` badge over a `size-4`
 * glyph). The cluster floats ABOVE the columns instead of living inside the
 * sidebar, which is what lets the sidebar collapse to a sliver: the way back
 * never moves, because it was never part of the panel. Its New Session seat
 * appears only while the column is closed (`isNewTaskButtonVisible =
 * showNewTaskButton ?? !isSidebarVisible`, `:96`) — with the sidebar open that
 * entry is the sidebar's own row.
 *
 * The cluster is content-sized and anchored to the window's left edge, so it
 * sits inside the sidebar's footprint while the column is open (72px against
 * its 264) and over the conversation column's top-left corner while it is
 * closed — the reference's own placement (`topOverlayWidthStyle`, `:104-106`).
 * The conversation header reserves that corner in turn, which is the
 * reference's `resolveTopOverlayLeadingPaddingClass` (`WorkspaceHeader.tsx:25`).
 */
import { PanelIcon, PlusIcon } from '../icons.js';
import { SIDEBAR_COPY as COPY } from '../sidebar/view.js';
import { Tooltip } from './Tooltip.js';
import css from './TopOverlay.module.css';

export interface TopOverlayProps {
  /** The sidebar is closed: the mark renames itself and New Session appears. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The New Session seat's gesture (the shell owns the follow-up rules). */
  onStartSession: () => void;
}

/**
 * Render the top-left cluster.
 * @param props - see TopOverlayProps.
 * @returns the floating cluster.
 */
export function TopOverlay({
  collapsed,
  onToggleCollapsed,
  onStartSession,
}: TopOverlayProps): JSX.Element {
  const toggleLabel = collapsed ? COPY['toggle.open'] : COPY['toggle.collapse'];
  const newLabel = COPY['session.new.label'];
  return (
    /* `deep`, not the bare attribute: Tauri's drag script only starts a drag
       when the pressed element IS the attributed one, and the buttons cover
       most of this box — the gaps between them are the drag seat. Buttons are
       exempted by that script, so their clicks keep working. Inert in a
       browser. */
    <div className={css.seat} data-tauri-drag-region="deep">
      <Tooltip label={toggleLabel} side="bottom" delayMs={500}>
        <button
          type="button"
          className={css.toggle}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggleCollapsed}
        >
          {/* The mark IS the button (the reference's own swap): it reads as the
              product until the pointer arrives, then states what a press does.
              Focus-visible joins hover so the keyboard path sees the same
              promise. */}
          <span className={css.mark} aria-hidden="true">
            {COPY.brand.slice(0, 1)}
          </span>
          <PanelIcon className={css.glyph} />
        </button>
      </Tooltip>
      {collapsed && (
        <Tooltip label={newLabel} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.action}
            aria-label={newLabel}
            title={newLabel}
            onClick={onStartSession}
          >
            <PlusIcon className={css.actionIcon} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
