/**
 * Sidebar shell: column geometry and the column's own content.
 *
 * Close is a fade, not a layout swap (2026-11-23, ZCode alignment): the content
 * stays mounted at its expanded width while the sliding column (AppFrame grid
 * tracks) clips it, and fades to `opacity: 0` on the same
 * `--nova-dur-panel`/`--nova-ease-panel` pair the track rides. There is no
 * second, narrow layout — the reference has none (`WorkspaceShellLayout.tsx`
 * collapses its panel to a 6px sliver with `pointer-events-none opacity-0`),
 * and Nova's 56px icon rail of five stacked glyphs was its own invention: it
 * read as a different sidebar rather than as this one being closed. The way
 * back lives in the frame's top-left overlay (`shell/TopOverlay.tsx`), which
 * never moves.
 *
 * The column is also the shell's one stateful owner: whether the pointer is
 * inside (the scrollbar affordance) and the width the content holds while the
 * column closes.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClientFrame, SessionListItem } from '../types.js';
import { NewSessionButton } from './NewSessionButton.js';
import { PluginsEntryButton } from './PluginsEntryButton.js';
import { SessionBrowser } from './SessionBrowser.js';
import { SidebarFoot } from './SidebarFoot.js';
import { cx } from '../composer/cx.js';
import css from './Sidebar.module.css';

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
  /**
   * Whether the plugin center owns the main column. The reference puts that
   * page in the sidebar (`ui-plugin-manager`'s panel entry) rather than in the
   * settings dialog, so this column is where its door belongs.
   */
  pluginsOpen: boolean;
  /** Open the plugin center (the shell owns the page). */
  onOpenPlugins: () => void;
  /**
   * Leave the plugin center. Every session gesture means "back to the
   * conversation": without this, picking a session while the plugin page is up
   * would change what the frame holds and show nothing.
   */
  onLeavePlugins: () => void;
  /** Delete one session log (the shell owns the frame; the dialog is local). */
  onDeleteSession: (file: string) => void;
  /** Re-ask the host for the session list (the shell's single-flight policy). */
  onReloadSessions: () => void;
  /**
   * The shell's own rule riding a session gesture: a NEW SESSION collapses the
   * right panel (the reference's new task collapses its side pane — a fresh
   * conversation wants the whole centre). The sidebar doesn't know the panel
   * exists; the shell hands its close down. Optional so tests can render the
   * column without the shell.
   */
  onNewSession?: () => void;
  /**
   * The column's expanded width, for the close freeze: content holds this
   * width while it fades and the sliding track clips it. Optional — without it
   * the close is a plain slide and the content reflows as the track narrows
   * (the reference always receives it from its layout owner).
   */
  width?: number;
}

/**
 * Render the sidebar column.
 * @param props.items - session rows to browse, grouped by workspace.
 * @param props.width - expanded width for the close freeze (see SidebarProps).
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
  pluginsOpen,
  onOpenPlugins,
  onLeavePlugins,
  onDeleteSession,
  onReloadSessions,
  onNewSession,
  width,
}: SidebarProps): JSX.Element {
  // Freeze the content at its expanded width while it fades out: the sliding
  // column then clips it instead of reflowing it, which is what makes the
  // close read as the column going away rather than as its text squashing.
  const lastWideWidth = useRef(width);
  if (!collapsed) lastWideWidth.current = width;

  // Closed means "not on screen", not just "invisible": the content stays
  // mounted (the reference keeps its sidebar mounted through the same state,
  // so an expand never reloads the tree), so it would otherwise keep its rows
  // and controls in the keyboard's tab order. `inert` is the HTML answer and
  // costs no state; `aria-hidden` alone leaves them focusable.
  const rootEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (rootEl.current !== null) rootEl.current.inert = collapsed;
  }, [collapsed]);

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

  const startSession = (): void => {
    onLeavePlugins();
    send({ type: 'new_session' });
    // The shell's rule, not the column's: a new session collapses the right
    // panel (a fresh conversation wants the whole centre).
    onNewSession?.();
  };
  const openSession = (file: string): void => {
    // Leaving the plugin page comes FIRST: the session already attached would
    // otherwise hit the early return below and the gesture would look inert.
    onLeavePlugins();
    // Opening the session already attached would re-baseline the same log for
    // nothing; the row keeps its normal affordances either way.
    if (file === currentFile) return;
    send({ type: 'resume', file });
  };

  return (
    <div
      ref={rootEl}
      className={cx(css.root, collapsed && css.closed, !pointerInside && css.quietBars)}
      style={width !== undefined ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      aria-hidden={collapsed || undefined}
      onPointerEnter={() => {
        cancelLinger();
        setPointerInside(true);
      }}
      onPointerLeave={() => { armLinger(); }}
    >
      {/* The band the frame's top-left overlay floats over: its own drag seat
          (the reference gives its sidebar the same `h-12 [app-region:drag]`
          spacer, project-sidebar/index.tsx:245). */}
      <div className={css.topSeat} data-tauri-drag-region="" />
      <NewSessionButton onStartSession={startSession} />
      <PluginsEntryButton active={pluginsOpen} onOpen={onOpenPlugins} />

      {/* The browsing region fills the column between the controls and the
          foot in both states. */}
      <div className={css.regionArea}>
        <SessionBrowser
          items={items}
          currentFile={currentFile}
          onOpen={openSession}
          onDelete={onDeleteSession}
          onReload={onReloadSessions}
        />
      </div>

      <div className={css.footArea}>
        <div className={css.settingsArea}>
          <SidebarFoot
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
