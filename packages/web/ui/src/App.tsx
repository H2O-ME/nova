/**
 * The shell: the frame's three tracks, and the occupants this product fills
 * them with. Ported from deepseek-harness `ui-layout`'s App composition (MIT):
 * the shell decides nothing about the transcript, the composer or the panels —
 * it wires the reducer's state into the surfaces and owns only what the FRAME
 * must know to size its columns (the detail panel's call). The composer's `/`
 * menu is not here: it is driven by the draft, which is the composer's own
 * state (`InputBar`).
 *
 * One phase derivation drives the column's layout (`conversationPhase`): until
 * a session is bound the column is the centered hero, a replayed session keeps
 * its seat invisible while the baseline lands, and only an active transcript
 * gets a scroller, width handles and the strict header.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApprovalPanel } from './approval/ApprovalPanel.js';
import { ChatView } from './chat/ChatView.js';
import { DockStack } from './composer/DockStack.js';
import { InputBar } from './composer/InputBar.js';
import { QueueDock } from './composer/QueueDock.js';
import { ContextMeter } from './conversation/ContextMeter.js';
import { ConversationRoot } from './conversation/ConversationRoot.js';
import { PanelExpandButton } from './conversation/PanelExpandButton.js';
import { HeroShell } from './conversation/EmptyHero.js';
import { SessionHeader } from './conversation/SessionHeader.js';
import { StatsPills } from './composer/StatsPills.js';
import { conversationPhase } from './conversation/phase.js';
import { useAgent } from './client.js';
import { chromeView, composerDisabled } from './chrome-view.js';
import { flowRows, turnStatus } from './flow.js';
import { Sidebar } from './sidebar/Sidebar.js';
import { AppFrame } from './shell/AppFrame.js';
import { DocumentTitle } from './shell/DocumentTitle.js';
import { useEscapeToClose } from './shell/use-escape.js';
import { useLayout } from './shell/use-layout.js';
import { ToolPanel } from './tool/ToolPanel.js';
import { TraceView } from './trace/TraceView.js';
import { useTheme } from './theme.js';

/**
 * The session pane's views, in tab order. The strip only renders when there is
 * more than one (`SessionHeader`'s rule), and these ARE the views it offers: the
 * conversation, and the durable log behind it.
 */
const SESSION_TABS = [
  { id: 'chat', label: '对话' },
  { id: 'trace', label: '轨迹' },
] as const;

export function App(): JSX.Element {
  const { state, dispatch, send, connection } = useAgent();
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const layout = useLayout();
  const theme = useTheme();
  const { openRightbar, closeRightbar } = layout;

  // The session list is a sidebar concern, and asking for it is ONE decision
  // with one place to make it: whenever the reducer says the list is stale
  // (first attach, a reconnect, a switch that may have added a session) and no
  // request is in flight. The rows already on screen keep rendering while the
  // answer travels, so a switch never blanks the panel — the rule the harness
  // follows by re-listing only on connect and pushing the rest as events.
  const requestSessions = useCallback((): void => {
    if (state.sessionsPending) return;
    send({ type: 'list_sessions' });
  }, [send, state.sessionsPending]);
  useEffect(() => {
    if (connection === 'open' && state.sessionsStale) requestSessions();
  }, [connection, state.sessionsStale, requestSessions]);

  const closePanel = useCallback((): void => setOpenCallId(null), []);
  // Escape closes one layer per press, topmost first: the detail panel, then
  // the sidebar's narrow-frame expansion (the transcript has nothing to close).
  useEscapeToClose([
    ...(openCallId !== null ? [closePanel] : []),
    ...(layout.narrow && !layout.collapsed ? [layout.toggleSidebar] : []),
  ]);

  // The right column is a track, not a box: the detail panel anchors to the
  // frame's right edge at the resolved normal width, and with `track: false`
  // the centre never narrows for it — the panel hangs over the content edge.
  const open = openCallId !== null;
  useEffect(() => {
    if (open) openRightbar(false, false);
    else closeRightbar();
  }, [open, openRightbar, closeRightbar]);

  const openTool = useCallback(
    (callId: string): void => setOpenCallId((current) => (current === callId ? null : callId)),
    [],
  );
  const stopJob = useCallback((id: string): void => send({ type: 'stop_job', id }), [send]);
  const onCompact = useCallback((): void => send({ type: 'compact' }), [send]);
  const onLoadEarlier = useCallback(
    (): void => send({ type: 'load_earlier', have: state.historyLoaded }),
    [send, state.historyLoaded],
  );
  // The trace's two gestures. `have: 0` is a fresh read (opening the view, or
  // its refresh button); the pane's own count is the cursor for paging back.
  const onLoadTrace = useCallback((): void => send({ type: 'load_trace', have: 0 }), [send]);
  const onLoadMoreTrace = useCallback(
    (): void => send({ type: 'load_trace', have: state.trace?.rows.length ?? 0 }),
    [send, state.trace?.rows.length],
  );
  const toggleFullscreen = useCallback(
    (): void => openRightbar(false, !layout.layout.rightbarFullscreen),
    [openRightbar, layout.layout.rightbarFullscreen],
  );

  // One pure derivation for everything the frame shows about the session; the
  // JSX below reads fields instead of deciding (see chrome-view.ts).
  const view = chromeView(state, openCallId);
  const phase = conversationPhase({
    bound: state.meta !== null,
    blank: state.blocks.length === 0,
    replaying: state.historyPending,
  });

  return (
    <AppFrame
      layout={layout.layout}
      dragging={layout.dragging}
      onDragChange={layout.setDragging}
      onViewportWidth={layout.setViewportWidth}
      onSidebarWidth={layout.setSidebar}
      onRightbarWidth={layout.setRightbar}
      sidebar={({ collapsed, width }) => (
        <Sidebar
          items={state.sessions}
          currentFile={state.meta?.sessionFile ?? ''}
          collapsed={collapsed}
          width={width}
          connection={connection}
          preference={theme.preference}
          fontSize={theme.fontSize}
          send={send}
          onReloadSessions={requestSessions}
          onToggleCollapsed={layout.toggleSidebar}
          onPickPreference={theme.setPreference}
          onPickFontSize={theme.setFontSize}
        />
      )}
      center={
        <>
          <DocumentTitle title={view.title} />
          <ConversationRoot
            phase={phase}
            header={({ hidden }) => (
              <SessionHeader
                hidden={hidden}
                title={view.title}
                rootDir={view.rootDir}
                // Two views of one session: the conversation (what a reader
                // saw) and the trace (what the log recorded). The strip renders
                // only when there is more than one, which is the source's rule.
                tabs={SESSION_TABS}
                activeTabId={state.view}
                onSelectTab={(id) => { dispatch({ type: 'select_view', view: id === 'trace' ? 'trace' : 'chat' }); }}
                // The corner's expand control, shown only while the panel is
                // collapsed AND there is a call to show — the harness's own gate,
                // with this product's answer for what that call is.
                corner={!open && view.lastToolCallId !== undefined
                  ? <PanelExpandButton callId={view.lastToolCallId} onOpen={setOpenCallId} />
                  : undefined}
              />
            )}
            hero={<HeroShell />}
            session={
              // The scroller mounts only with a transcript to scroll: the hero
              // and settling phases keep the seat (it must survive the landing)
              // but nothing reads a flow that is not there yet. The trace is the
              // exception: it reads the LOG, which exists before any flow does.
              state.view === 'trace' ? (
                <TraceView
                  rows={state.trace?.rows ?? null}
                  total={state.trace?.total ?? state.meta?.traceTotal ?? 0}
                  pending={state.trace?.pending ?? false}
                  onRefresh={onLoadTrace}
                  onLoadEarlier={onLoadMoreTrace}
                />
              ) : phase === 'active' ? (
                <ChatView
                  rows={flowRows(state.blocks, {
                    idle: view.idle,
                    selectedCallId: openCallId,
                    onOpenTool: openTool,
                    onStopJob: stopJob,
                    cwd: view.rootDir,
                  })}
                  hiddenOlder={view.hidden}
                  loadingOlder={state.historyPending}
                  onLoadEarlier={onLoadEarlier}
                  status={turnStatus(view.phase, view.running)}
                />
              ) : undefined
            }
            composer={
              <DockStack>
                {state.pendingApproval !== null && (
                  /* Keyed by request id: two approvals in a row are two cards.
                     Without the key React reuses the instance, so the reason
                     box, the scope stepper and the 6s answer-unlock all carry
                     over from the previous request. */
                  <ApprovalPanel
                    key={state.pendingApproval.id}
                    request={state.pendingApproval}
                    send={send}
                    connected={state.connected}
                  />
                )}
                <QueueDock items={state.queued} />
                <InputBar
                  send={send}
                  disabled={composerDisabled(state)}
                  running={view.running}
                  approvalMode={view.approvalMode}
                  codeMode={view.codeMode}
                  model={state.model}
                  modelName={state.modelName}
                  modelSwitching={state.modelSwitching}
                  catalog={state.catalog}
                  commands={state.commands}
                  variant={phase === 'hero' ? 'hero' : 'composer'}
                  /* The stats row rides the composer's own dock slot (inside
                     the bar's root): that is where the harness mounts it, and
                     where `.root:has([data-composer-stats])` can see it. */
                  dock={<StatsPills totals={state.totals} />}
                  meter={
                    <ContextMeter
                      usedTokens={state.usedTokens}
                      contextWindow={state.contextWindow}
                      onCompact={onCompact}
                      compactDisabled={!view.canCompact || view.compactBusy}
                    />
                  }
                />
              </DockStack>
            }
          />
        </>
      }
      rightbar={({ width, canShow }) =>
        view.detail === undefined ? null : (
          <ToolPanel
            block={view.detail}
            width={width}
            canShow={canShow}
            idle={view.idle}
            fullscreen={layout.layout.rightbarFullscreen}
            onClose={closePanel}
            onToggleFullscreen={toggleFullscreen}
            cwd={view.rootDir}
          />
        )
      }
    />
  );
}