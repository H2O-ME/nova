/**
 * The frame: the shell's three tracks and who occupies them. The shell decides
 * nothing about the transcript, the composer or the panels — it wires the
 * model's state into the surfaces and owns only what the FRAME must know to
 * size its columns. The center occupant is the active ROUTE (`app/routes/`);
 * the sidebar and the right panel are assembled here.
 *
 * One phase derivation drives the column's layout (`conversationPhase`), until
 * a session is bound the column is the centered hero, a replayed session keeps
 * its seat invisible while the baseline lands, and only an active transcript
 * gets a scroller, width handles and the strict header.
 */
import type { ReactNode } from 'react';
import type { Action, UiState } from '../state.js';
import type { ClientFrame } from '../types.js';
import { Sidebar } from '../sidebar/Sidebar.js';
import { RightbarPanel } from '../rightbar/RightbarPanel.js';
import type { StripState } from '../rightbar/strip-state.js';
import type { StripTabId } from '../rightbar/tabs.js';
import { ErrorBoundary } from '../shell/ErrorBoundary.js';
import { SHELL_COPY } from '../shell/copy.js';
import { AppFrame } from '../shell/AppFrame.js';
import { sidebarCollapsed } from '../shell/layout-store.js';
import { TopOverlay } from '../shell/TopOverlay.js';
import { WindowControls } from '../shell/WindowControls.js';
import type { useLayout } from '../shell/use-layout.js';

export interface AppShellProps {
  state: UiState;
  send: (frame: ClientFrame) => void;
  dispatch: (action: Action) => void;
  connection: 'connecting' | 'open' | 'closed';
  reconnect: () => void;
  layout: ReturnType<typeof useLayout>;
  /** The main column's occupant: the active route. */
  center: ReactNode;

  // --- sidebar ---
  settingsOpen: boolean;
  onOpenSettings: () => void;
  pluginsOpen: boolean;
  onOpenPlugins: () => void;
  onLeavePlugins: () => void;
  onReloadSessions: () => void;

  // --- right panel ---
  rightbarOpen: boolean;
  strip: StripState;
  onPickStripTab: (tab: StripTabId) => void;
  onCloseStripTab: (tab: StripTabId) => void;
  onOpenFileTab: (path: string) => void;
  onReferenceFile: (path: string) => void;
  onToggleFullscreen: () => void;
  onCloseRightbar: () => void;
  onOpenRightbar: () => void;
}
export function AppShell(props: AppShellProps): JSX.Element {
  const { state, send, dispatch, connection, reconnect, layout, center } = props;
  const sessionFile = state.meta?.sessionFile ?? '';
  const rootDir = state.meta?.rootDir ?? '';

  const pickStripTab = props.onPickStripTab;
  const sidebarClosed = sidebarCollapsed(layout.layout);
  // The auto-collapse is a fact about WHY the column is closed, and it is only
  // true while the frame is (debounced) narrow AND the column is closed (a
  // reader who expanded it below the breakpoint has already answered the
  // question). The top-left cluster's toggle answers to the same fact.
  const sidebarAutoClosed = layout.layout.autoNarrow && sidebarClosed;
  return (
    <>
      {/* The frameless desktop window's caption buttons (nothing in a
          browser). Fixed-position, so it costs the frame no layout. */}
      <WindowControls />
      <AppFrame
      layout={layout.layout}
      dragging={layout.dragging}
      onDragChange={layout.setDragging}
      onViewportWidth={layout.setViewportWidth}
      onConversationWidth={layout.setConversationWidth}
      onSidebarWidth={layout.setSidebar}
      onRightbarWidth={layout.setRightbar}
      sidebar={({ collapsed, width }) => (
        <Sidebar
          items={state.sessions}
          currentFile={sessionFile}
          collapsed={collapsed}
          width={width}
          connection={connection}
          onReconnect={reconnect}
          send={send}
          settingsOpen={props.settingsOpen}
          onOpenSettings={props.onOpenSettings}
          pluginsOpen={props.pluginsOpen}
          onOpenPlugins={props.onOpenPlugins}
          onLeavePlugins={props.onLeavePlugins}
          onDeleteSession={(file) => { send({ type: 'delete_session', file }); }}
          onReloadSessions={props.onReloadSessions}
          // A session gesture made in the sidebar collapses the right panel —
          // the shell's own rule (the reference's new task collapses its side
          // pane), not the sidebar's, so it arrives as the shell's close.
          onNewSession={props.onCloseRightbar}
        />
      )}
      center={center}
      topOverlay={(
        <TopOverlay
          collapsed={sidebarClosed}
          autoCollapsed={sidebarAutoClosed}
          onToggleCollapsed={layout.toggleSidebar}
          // The same New Session gesture the sidebar's own row makes, minus the
          // sidebar: leaving the plugin page, then the frame, then the shell's
          // right-panel rule.
          onStartSession={() => {
            props.onLeavePlugins();
            send({ type: 'new_session' });
            props.onCloseRightbar();
          }}
        />
      )}
      rightbar={({ width, canShow }) => {
        // The column is guarded on its own: a panel that cannot draw must cost
        // the reader the panel, not the conversation beside it. `resetKey` is
        // what is on screen, so switching tab is itself the way out.
        const occupant = ((): JSX.Element | null => {
          if (!props.rightbarOpen) return null;
          return (
            <RightbarPanel
              width={width}
              canShow={canShow}
              fullscreen={layout.layout.rightbarFullscreen}
              onToggleFullscreen={props.onToggleFullscreen}
              onClose={props.onCloseRightbar}
              tabs={props.strip.tabs}
              tab={props.strip.front}
              onPickTab={pickStripTab}
              onCloseTab={props.onCloseStripTab}
              tree={state.tree}
              rootDir={rootDir}
              connected={connection === 'open'}
              editor={state.editor}
              git={state.git}
              onOpenFileTab={props.onOpenFileTab}
              dispatch={dispatch}
              send={send}
              // The tree row's `@` railing reuses the pickers' own intake — one
              // channel, so a file named from the tree and a file named from the
              // OS dialog land in the composer as the same card.
              onReferenceFile={props.onReferenceFile}
            />
          );
        })();
        return (
          <ErrorBoundary
            label={SHELL_COPY['error.label.rightbar']}
            resetKey={props.rightbarOpen ? `panel:${props.strip.front}` : 'closed'}
          >
            {occupant}
          </ErrorBoundary>
        );
      }}
      />
    </>
  );
}

