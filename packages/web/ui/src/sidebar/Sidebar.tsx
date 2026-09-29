/**
 * Sidebar shell: column geometry and the column's own controls.
 * Ported from deepseek-harness `ui-sidebar/src/client/SidebarRoot.tsx` +
 * `SidebarRoot.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * Collapse is a slide plus crossfade: content freezes at its expanded width
 * (inline style) and fades out in place while the sliding column (AppFrame grid
 * tracks) clips it — nothing reflows mid-slide. At settle the wide-only content
 * unmounts and the upper controls enter the 56px rail from the same horizontal
 * offset on one fade that ends with the slide. The bottom-pinned foot only
 * fades.
 *
 * The column is also the shell's one stateful owner: which controls the wide
 * layout mounts (`.logoRow` / New Session label / the session browser), whether
 * the pointer is inside (the scrollbar affordance), and the width the content
 * freezes at while it fades.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClientFrame, SessionListItem } from '../types.js';
import { NewSessionButton } from './NewSessionButton.js';
import { SessionBrowser } from './SessionBrowser.js';
import { SidebarFoot } from './SidebarFoot.js';
import { SidebarLogoRow } from './SidebarLogoRow.js';
import { cls } from './view.js';
import css from './Sidebar.module.css';

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150;

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2_000;

export interface SidebarProps {
  /** The host's session list (`null` until the first `sessions` frame). */
  items: readonly SessionListItem[] | null;
  /** Absolute path of the log the kernel is attached to (the row highlight). */
  currentFile: string;
  collapsed: boolean;
  connection: 'connecting' | 'open' | 'closed';
  /**
   * Request an immediate reconnect attempt from the foot's indicator. Optional
   * in the type but ALWAYS passed by the shell: the indicator renders its
   * retry-as-a-button branch only when this arrives, so leaving it out silently
   * degrades the outage readout to an inert label (which is what happened —
   * declared, documented, and unreachable until it was wired).
   */
  onReconnect?: (() => void) | undefined;
  send: (frame: ClientFrame) => void;
  /** Whether the settings dialog this column's seat opens is on screen. */
  settingsOpen: boolean;
  /** Open the settings dialog (the shell owns the panel and its sections). */
  onOpenSettings: () => void;
  /** Delete one session log (the shell owns the frame; the dialog is local). */
  onDeleteSession: (file: string) => void;
  /** Re-ask the host for the session list (the shell's single-flight policy). */
  onReloadSessions: () => void;
  onToggleCollapsed: () => void;
  /**
   * The column is collapsed because the FRAME is narrower than
   * `SIDEBAR_AUTO_COLLAPSE` — not because the reader closed it. Passed down from
   * the frame (`AppFrame`'s sidebar slot params) so the rail's one control can
   * name the reason instead of reading like the reader's own choice.
   */
  autoCollapsed?: boolean;
  /**
   * The column's expanded width, for the collapse freeze: content holds this
   * width while it fades and the sliding track clips it. Optional — without it
   * the collapse is a plain slide and the content reflows as the track
   * narrows (the reference always receives it from its layout owner).
   */
  width?: number;
}

/**
 * Render the sidebar column.
 * @param props.items - session rows to browse, grouped by workspace.
 * @param props.width - expanded width for the collapse freeze (see SidebarProps).
 * @returns the sidebar element tree.
 */
export function Sidebar({
  items,
  currentFile,
  collapsed,
  connection,
  onReconnect,
  send,
  settingsOpen,
  onOpenSettings,
  onDeleteSession,
  onReloadSessions,
  onToggleCollapsed,
  autoCollapsed,
  width,
}: SidebarProps): JSX.Element {
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => { setSettled(true); }, COLLAPSE_SETTLE_MS);
    return () => { window.clearTimeout(timer); };
  }, [collapsed]);
  const wide = !collapsed || !settled;

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(width);
  if (!collapsed) lastWideWidth.current = width;

  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed);
  if (!collapsed) everWide.current = true;

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const [pointerInside, setPointerInside] = useState(false);
  const lingerTimer = useRef<number | undefined>(undefined);
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return;
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined;
      setPointerInside(false);
    }, SCROLLBAR_LINGER_MS);
  };
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current);
    lingerTimer.current = undefined;
  };
  // The element's own leave is the one signal geometry cannot give: a pointer
  // that leaves the window emits no further moves. (The reference also polls
  // document pointer moves to catch descendants that leave this box — it hosts
  // a fixed-position settings panel there; this column has none.)
  useEffect(() => () => { cancelLinger(); }, []);

  const startSession = (): void => { send({ type: 'new_session' }); };
  const openSession = (file: string): void => {
    // Opening the session already attached would re-baseline the same log for
    // nothing; the row keeps its normal affordances either way.
    if (file === currentFile) return;
    send({ type: 'resume', file });
  };

  return (
    <div
      className={cls(
        css.root,
        !wide && css.collapsed,
        !wide && everWide.current && css.railIn,
        collapsed && wide && css.fading,
        !pointerInside && css.quietBars,
      )}
      style={wide && width !== undefined ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger();
        setPointerInside(true);
      }}
      onPointerLeave={() => { armLinger(); }}
    >
      <SidebarLogoRow
        wide={wide}
        collapsed={collapsed}
        autoCollapsed={autoCollapsed ?? false}
        onToggleCollapsed={onToggleCollapsed}
        onStartSession={startSession}
      />
      <NewSessionButton wide={wide} onStartSession={startSession} />

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail control rides the same seat. */}
      <div className={css.regionArea}>
        <SessionBrowser
          items={items}
          currentFile={currentFile}
          rail={!wide}
          onOpen={openSession}
          onDelete={onDeleteSession}
          onReload={onReloadSessions}
          onExpand={() => { if (collapsed) onToggleCollapsed(); }}
        />
      </div>

      <div className={css.footArea}>
        <div className={css.settingsArea}>
          <SidebarFoot
            rail={!wide}
            connection={connection}
            onReconnect={onReconnect}
            settingsOpen={settingsOpen}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    </div>
  );
}