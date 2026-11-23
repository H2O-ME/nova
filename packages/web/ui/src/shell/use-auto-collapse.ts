/**
 * The responsive collapse policy for the shell's two side columns — the
 * reference's, behavior for behavior (`WorkspaceShellLayout.tsx:890-975`):
 *
 *  - **Only a WINDOW resize can trigger it.** The reference deliberately does
 *    not watch the conversation pane's own ResizeObserver: a panel the reader
 *    just opened, or a sidebar they just dragged, shrinks the transcript, and
 *    that shrink must never be read as "the window got small, close things".
 *    (This was Nova's real defect: opening the right panel on a mid-size
 *    window auto-collapsed the sidebar a moment later.)
 *  - **It only ever closes.** The reference has no auto-expand at all:
 *    widening the window leaves each column where the reader put it, and the
 *    top-left overlay is the one way back (`DesktopTopOverlay`). One
 *    `isSidebarVisible`-style preference serves both a reader toggle and a
 *    policy close, so the state never needs to know which one it was.
 *  - **The panel concedes first.** A side pane that leaves a 360px transcript
 *    is not a panel, so it closes at `RIGHTBAR_COLLAPSE_BELOW_CONVERSATION`
 *    (480); the sidebar follows at `SIDEBAR_COLLAPSE_BELOW_CONVERSATION`
 *    (360), and its decision is taken off the width the panel's close handed
 *    back. The reference re-checks two `requestAnimationFrame`s later, which
 *    is enough there because its pane width is a CSS variable: hiding the pane
 *    reflows the transcript in the SAME frame. Nova's tracks are React state
 *    (`layout.rightbarTrack`), so the panel can be gone from the DOM while the
 *    grid still carries its track — two frames then measure a squeezed 0px
 *    centre and close the sidebar the panel just paid for. Hence the wait
 *    below polls for the track itself to be released, bounded so a stuck
 *    frame cannot leave the policy hanging.
 *  - **Fullscreen is exempt.** A fullscreen side pane covers the frame, so the
 *    measured conversation says nothing about what the reader can read
 *    (`isFullViewRef` in the reference).
 *  - **Only a conversation participates.** The reference's effect lives behind
 *    `workspaceMainView === "chat"`; Nova's plugin center owns the main column
 *    the same way, so it is excluded by the caller (`active`).
 *  - **Debounced by `AUTO_COLLAPSE_RESIZE_IDLE_MS`** (300): dragging a window
 *    edge must not flip a column per frame.
 */
import { useEffect, useRef } from 'react';
import {
  AUTO_COLLAPSE_RESIZE_IDLE_MS,
  RIGHTBAR_COLLAPSE_BELOW_CONVERSATION,
  SIDEBAR_COLLAPSE_BELOW_CONVERSATION,
} from './columns.js';

/** What the policy reads and the two closes it may call. */
export interface AutoCollapsePolicy {
  /** A live conversation owns the main column (false: plugin center, settings). */
  active: boolean;
  rightbarOpen: boolean;
  rightbarFullscreen: boolean;
  sidebarCollapsed: boolean;
  /** Close the right panel (the shell's own gate — presentation included). */
  closeRightbar: () => void;
  /** Close the sidebar (the same toggle the reader's own control uses). */
  collapseSidebar: () => void;
}

/**
 * The measured conversation column's width, read from the frame's own marker.
 * Reading the DOM keeps the policy free of a second width pipeline: the frame
 * publishes `data-conversation-measure` on the box it already measures, and
 * nothing has to be kept in sync through state for a timer to read later.
 * @returns the width in px, or null before layout (and during the boot frame).
 */
function conversationWidth(): number | null {
  const element = document.querySelector('[data-conversation-measure]');
  if (element === null) return null;
  const width = element.getBoundingClientRect().width;
  return width > 0 ? width : null;
}

/**
 * Whether the right panel still OWNS a grid track. The frame marks the
 * released state on itself (`data-rightbar-collapsed`), so this is the same
 * fact the grid column is solved from — not a proxy.
 * @returns true while the track exists, or when there is no frame yet.
 */
function rightbarTracked(): boolean {
  const frame = document.querySelector('[data-desktop]');
  return frame === null || frame.getAttribute('data-rightbar-collapsed') === null;
}

/** How long the panel's close may take to release its track before we measure anyway. */
const TRACK_RELEASE_TIMEOUT_MS = 1000;

/**
 * Run the policy for the life of the shell. The latest props are read through
 * a ref, so the resize listener binds once and still sees current state.
 * @param policy - see {@link AutoCollapsePolicy}.
 */
export function useAutoCollapse(policy: AutoCollapsePolicy): void {
  const latest = useRef(policy);
  latest.current = policy;
  useEffect(() => {
    let timer: number | null = null;
    let pending: number | null = null;
    const collapseSidebarIfStillNarrow = (): void => {
      const current = latest.current;
      if (!current.active || current.rightbarFullscreen || current.sidebarCollapsed) return;
      const width = conversationWidth();
      if (width !== null && width < SIDEBAR_COLLAPSE_BELOW_CONVERSATION) current.collapseSidebar();
    };
    /**
     * Take the sidebar's decision once the panel's track is actually gone:
     * the close is a React state write, so the DOM keeps the squeezed centre
     * until the next commit. Polls on rAF (cheap, one read per frame) and
     * gives up after {@link TRACK_RELEASE_TIMEOUT_MS}.
     */
    const recheckAfterPanelClose = (): void => {
      const deadline = performance.now() + TRACK_RELEASE_TIMEOUT_MS;
      const step = (): void => {
        pending = null;
        if (rightbarTracked() && performance.now() < deadline) {
          pending = window.requestAnimationFrame(step);
          return;
        }
        collapseSidebarIfStillNarrow();
      };
      pending = window.requestAnimationFrame(step);
    };
    const settle = (): void => {
      timer = null;
      const current = latest.current;
      if (!current.active || current.rightbarFullscreen) return;
      const width = conversationWidth();
      if (width === null) return;
      if (current.rightbarOpen && width < RIGHTBAR_COLLAPSE_BELOW_CONVERSATION) {
        current.closeRightbar();
        // The close hands the transcript its width back; the sidebar's
        // decision belongs to THAT measurement, not the squeezed one.
        recheckAfterPanelClose();
        return;
      }
      collapseSidebarIfStillNarrow();
    };
    const onResize = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(settle, AUTO_COLLAPSE_RESIZE_IDLE_MS);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer !== null) window.clearTimeout(timer);
      if (pending !== null) window.cancelAnimationFrame(pending);
    };
  }, []);
}
