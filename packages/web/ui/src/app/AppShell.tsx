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
import { changesModel } from '../rightbar/changes-model.js';
import type { StripState } from '../rightbar/strip-state.js';
import type { RightbarTabId, StripTabId } from '../rightbar/tabs.js';
import { ErrorBoundary } from '../shell/ErrorBoundary.js';
import { SHELL_COPY } from '../shell/copy.js';
import { AppFrame } from '../shell/AppFrame.js';
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
  onOpenPageFromGuide: (page: RightbarTabId) => void;
  onAddGuideTab: () => void;
  onCloseStripTab: (tab: StripTabId) => void;
  onOpenFileTab: (path: string) => void;
  shellPick: number;
  onDiscoverShells: () => void;
  onPickTerminalShell: (path: string) => void;
  onOpenWorkspace: () => void;
  onReferenceFile: (path: string) => void;
  onToggleFullscreen: () => void;
  onCloseRightbar: () => void;
  onOpenRightbar: () => void;
}

export function AppShell(props: AppShellProps): JSX.Element {
  const { state, send, dispatch, connection, reconnect, layout, center } = props;
  // The right panel's 变更 tab folds the conversation's own tool calls into a
  // change list — a pure derivation of the blocks, recomputed only when they do.
  const changes = changesModel(state.blocks);
  const sessionFile = state.meta?.sessionFile ?? '';
  const rootDir = state.meta?.rootDir ?? '';

  const pickStripTab = props.onPickStripTab;
  return (
    <AppFrame
      layout={layout.layout}
      dragging={layout.dragging}
      onDragChange={layout.setDragging}
      onViewportWidth={layout.setViewportWidth}
      onSidebarWidth={layout.setSidebar}
      onRightbarWidth={layout.setRightbar}
      sidebar={({ collapsed, width, auto }) => (
        <Sidebar
          items={state.sessions}
          currentFile={sessionFile}
          collapsed={collapsed}
          width={width}
          autoCollapsed={auto}
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
          onToggleCollapsed={layout.toggleSidebar}
        />
      )}
      center={center}
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
              onOpenPage={props.onOpenPageFromGuide}
              shells={state.shells}
              shellPick={props.shellPick}
              onDiscoverShells={props.onDiscoverShells}
              onPickShell={props.onPickTerminalShell}
              onAddGuide={props.onAddGuideTab}
              onCloseTab={props.onCloseStripTab}
              changes={changes}
              tree={state.tree}
              term={state.term}
              currentFile={sessionFile}
              rootDir={rootDir}
              connected={connection === 'open'}
              editor={state.editor}
              git={state.git}
              jobs={state.jobs}
              clonePending={state.clonePending}
              // The git setup card's 打开文件夹 is the hero's own gesture: the
              // native dialog first, the in-page browser on fallback.
              onOpenWorkspace={props.onOpenWorkspace}
              // The 变更 row's verb opens the file as ITS OWN TAB (the strip's
              // reveal-if-opened) — the read goes out through the same one
              // entrance every other opener uses.
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
  );
}

