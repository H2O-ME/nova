/**
 * The session route: the main column's conversation — header, hero, transcript
 * and composer, the whole `ConversationRoot` assembly. This is the shell's
 * default route; the derivations it renders from (`chromeView`,
 * `conversationPhase`, `flowRows`) are pure functions of the state it receives,
 * so the route invents no state of its own.
 */
import { useMemo } from 'react';
import type { Action } from '../../state.js';
import type { UiState } from '../../state.js';
import type { ClientFrame } from '../../types.js';
import { chromeView } from '../../chrome-view.js';
import { flowRows, turnStatus } from '../../flow.js';
import { conversationPhase, awaitingFirstTurn } from '../../conversation/phase.js';
import { ConversationRoot } from '../../conversation/ConversationRoot.js';
import { HeroShell, WorkspaceRow } from '../../conversation/EmptyHero.js';
import { SessionHeader } from '../../conversation/SessionHeader.js';
import { ChatView } from '../../chat/ChatView.js';
import { TraceView } from '../../trace/TraceView.js';
import { ContextView } from '../../context/ContextView.js';
import { ApprovalPanel } from '../../approval/ApprovalPanel.js';
import { QuestionPanel } from '../../question/QuestionPanel.js';
import { DockStack } from '../../composer/DockStack.js';
import { QueueDock } from '../../composer/QueueDock.js';
import { GoalPanel } from '../../conversation/GoalPanel.js';
import { TodoPanel } from '../../conversation/TodoPanel.js';
import { InputBar } from '../../composer/InputBar.js';
import { StatsPills } from '../../composer/StatsPills.js';
import { ContextMeter } from '../../conversation/ContextMeter.js';
import { composerDisabled } from '../../chrome-view.js';
import { RightbarOpenButton } from '../../rightbar/RightbarPanel.js';
import { useTranscriptView } from '../../chat/transcript-view.js';

/**
 * The session pane's views, in tab order. The strip only renders when there is
 * more than one (`SessionHeader`'s rule), and these ARE the views it offers: the
 * conversation and the durable log behind it — plus the Context tab, which is
 * appended only while the `context` plugin provides a reading.
 */
const SESSION_TABS = [
  { id: 'chat', label: '对话' },
  { id: 'trace', label: '轨迹' },
] as const;

const CONTEXT_TAB = { id: 'context', label: '上下文' } as const;

export interface SessionRouteProps {
  state: UiState;
  send: (frame: ClientFrame) => void;
  dispatch: (action: Action) => void;
  openTurns: ReadonlySet<string>;
  onToggleTurn: (id: string) => void;
  /** The workspace shortlist the hero's picker offers (the shell's browser memory). */
  recentWorkspaces: readonly string[];
  onPickWorkspace: (dir: string) => void;
  /** The hero's 打开文件夹: the host's native dialog first, browser on fallback. */
  onBrowse: () => void;
  /** A file picked in the HOST's dialog, on its way into the composer's rail.
   *  The counter makes the same path pickable twice (a bare string would be
   *  identical on the second pick and the consumer's effect would not re-run). */
  pickedFile: { path: string; name: string; seq: number } | null;
  onPickedFileConsumed: () => void;
  /** The composer's 引用本地文件 opens the HOST's native dialog first. */
  onReferenceFile: () => void;
  /** Whether the right column is shown (the header's corner seat renders only when it is not). */
  rightbarOpen: boolean;
  /** The collapsed right column's corner seat opens it (the header's corner slot). */
  onOpenRightbar: () => void;
}

export function SessionRoute(props: SessionRouteProps): JSX.Element {
  const { state, send, dispatch } = props;
  const transcript = useTranscriptView();
  // One pure derivation for everything the frame shows about the session; the
  // JSX below reads fields instead of deciding (see chrome-view.ts).
  const view = chromeView(state);
  const transcriptPolicy = transcript.policy;

  const stopJob = useMemo(
    () => (id: string): void => send({ type: 'stop_job', id }),
    [send],
  );
  const onLoadEarlier = useMemo(
    () => (): void => send({ type: 'load_earlier', have: state.historyLoaded }),
    [send, state.historyLoaded],
  );
  // The trace's two gestures. `have: 0` is a fresh read (opening the view, or
  // its refresh button); the pane's own count is the cursor for paging back.
  const onLoadTrace = useMemo(() => (): void => send({ type: 'load_trace', have: 0 }), [send]);
  const onLoadMoreTrace = useMemo(
    () => (): void => send({ type: 'load_trace', have: state.trace?.rows.length ?? 0 }),
    [send, state.trace?.rows.length],
  );
  // The Context pane's read: the reading also rides `ready` and every run's
  // end, so this is the open/refresh path only (mounting the tab, or pulling it
  // back to date after it was hidden).
  const onRefreshContext = useMemo(() => (): void => send({ type: 'context' }), [send]);

  const runningStatus = useMemo(() => turnStatus(view.phase, view.running), [view.phase, view.running]);
  // The flow is rebuilt only when a block changed, not on every frame: a stream
  // delta re-renders the transcript, and rebuilding 200 rows' element trees for
  // a frame that touched one of them is the waste the streaming pass removes.
  const rows = useMemo(
    () =>
      flowRows(state.blocks, {
        idle: view.idle,
        onStopJob: stopJob,
        cwd: view.rootDir,
        runningStatus,
        openTurns: props.openTurns,
        onToggleTurn: props.onToggleTurn,
        modelName: state.modelName,
        policy: transcriptPolicy,
      }),
    [state.blocks, view.idle, stopJob, view.rootDir, runningStatus, props.openTurns, props.onToggleTurn, state.modelName, transcriptPolicy],
  );
  const phase = conversationPhase({
    bound: state.meta !== null,
    // The harness's awaiting-first-turn semantic, not a row count: the seeded
    // context fragments are pre-turn chrome, so a fresh session still takes
    // the centered hero until the first prompt lands.
    blank: awaitingFirstTurn(state.blocks),
    replaying: state.historyPending,
  });

  return (
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
          tabs={state.context !== null ? [...SESSION_TABS, CONTEXT_TAB] : SESSION_TABS}
          activeTabId={state.view}
          onSelectTab={(id) => { dispatch({ type: 'select_view', view: id === 'trace' ? 'trace' : id === 'context' ? 'context' : 'chat' }); }}
          // The corner seat, shown only while the right column is collapsed.
          corner={
            !props.rightbarOpen
              ? <RightbarOpenButton onOpen={props.onOpenRightbar} />
              : undefined
          }
        />
      )}
      hero={<HeroShell version={state.meta?.version} />}
      heroWorkspaceRow={
        <WorkspaceRow
          workspace={view.workspace}
          workspacePath={state.meta?.rootDir}
          recentWorkspaces={props.recentWorkspaces}
          onPickWorkspace={props.onPickWorkspace}
          // No `list_directory` here: the dialog's own opening effect owns
          // the first ask, so sending one here put TWO identical frames on
          // the socket for one 打开文件夹 click and let the two answers race.
          onBrowse={props.onBrowse}
        />
      }
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
        ) : state.view === 'context' ? (
          <ContextView
            timeline={state.context}
            {...(state.contextWindow !== null ? { window: state.contextWindow } : {})}
            {...(state.meta?.sessionFile !== undefined ? { sessionFile: state.meta.sessionFile } : {})}
            totals={state.totals}
            onRefresh={onRefreshContext}
          />
        ) : phase === 'active' ? (
          <ChatView
            rows={rows}
            hiddenOlder={view.hidden}
            loadingOlder={state.historyPending}
            onLoadEarlier={onLoadEarlier}
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
          {state.pendingQuestion !== null && (
            /* Keyed by request id, same rule as the approval card. */
            <QuestionPanel
              key={state.pendingQuestion.id}
              request={state.pendingQuestion}
              send={send}
              connected={state.connected}
            />
          )}
          <QueueDock items={state.queued} />
          {/* The plan rides the dock ABOVE the input bar (the dock seat), so it
              widens the composer stack rather than covering the transcript. */}
          {/* The goal sits ABOVE the plan: it is the longer-lived
              intention, and the plan is its current step. */}
          <GoalPanel goal={state.goal} send={send} />
          <TodoPanel todos={state.todos} />
          <InputBar
            send={send}
            disabled={composerDisabled(state)}
            running={view.running}
            approvalMode={view.approvalMode}
            model={state.model}
            modelName={state.modelName}
            modelSwitching={state.modelSwitching}
            catalog={state.catalog}
            commands={state.commands}
            // The `/goal` hint disambiguates on whether a goal is already
            // stored: a complete one counts.
            hasGoal={state.goal !== null}
            fileItems={state.files?.items ?? []}
            filesTruncated={state.files?.truncated ?? false}
            filesPending={state.files?.pending ?? false}
            sendRejected={state.sendRejected}
            // The `+` menu's 引用本地文件 opens the HOST's NATIVE file
            // dialog first; a host without one falls back to the in-page
            // browser (the `picked` consumer in the shell).
            onReferenceFile={props.onReferenceFile}
            pickedFile={props.pickedFile}
            onPickedFileConsumed={props.onPickedFileConsumed}
            variant={phase === 'hero' ? 'hero' : 'composer'}
            /* The dock row rides the composer's own dock slot (inside
               the bar's root): the stats pills and the context meter share
               one centered line under the card. The meter renders
               nothing before the first usage lands, and the pills
               nothing before the first billed run. */
            dock={
              <>
                <StatsPills totals={state.totals} />
                <ContextMeter
                  usedTokens={state.usedTokens}
                  contextWindow={state.contextWindow}
                />
              </>
            }
          />
        </DockStack>
      }
    />
  );
}
