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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApprovalPanel } from './approval/ApprovalPanel.js';
import { QuestionPanel } from './question/QuestionPanel.js';
import { ChatView } from './chat/ChatView.js';
import { DockStack } from './composer/DockStack.js';
import { InputBar } from './composer/InputBar.js';
import { QueueDock } from './composer/QueueDock.js';
import { basename } from './composer/file-type.js';
import { TodoPanel } from './conversation/TodoPanel.js';
import { GoalPanel } from './conversation/GoalPanel.js';
import { ContextMeter } from './conversation/ContextMeter.js';
import { ConversationRoot } from './conversation/ConversationRoot.js';
import { HeroShell, WorkspaceRow } from './conversation/EmptyHero.js';
import { DirectoryBrowser } from './conversation/DirectoryBrowser.js';
import { Sidebar } from './sidebar/Sidebar.js';
import { useNativePick } from './shell/native-pick.js';
import { SessionHeader } from './conversation/SessionHeader.js';
import { StatsPills } from './composer/StatsPills.js';
import { conversationPhase, awaitingFirstTurn } from './conversation/phase.js';
import { useAgent } from './client.js';
import { approvalControlLocked, chromeView, composerDisabled, modeControlsLocked } from './chrome-view.js';
import { flowRows, turnStatus } from './flow.js';
import { GeneralSection } from './settings/GeneralSection.js';
import { ModelSection } from './settings/ModelSection.js';
import { ModelConfigEditor } from './settings/ModelConfigEditor.js';
import { ProviderSection } from './settings/ProviderSection.js';
import { PluginsSection } from './settings/PluginsSection.js';
import { SkillsSection } from './settings/SkillsSection.js';
import { QqbotSection } from './settings/QqbotSection.js';
import { SettingsPanel } from './settings/SettingsPanel.js';
import { SETTINGS_COPY } from './settings/copy.js';
import { AppFrame } from './shell/AppFrame.js';
import { DocumentTitle } from './shell/DocumentTitle.js';
import { readRecentWorkspaces, rememberWorkspace } from './shell/workspaces.js';
import { useEscapeToClose } from './shell/use-escape.js';
import { useLayout } from './shell/use-layout.js';
import { BookIcon, ChatBotIcon, PluginIcon, SettingsIcon } from './icons.js';
import { DataOutline16 } from './composer/Icons.js';
import { TraceView } from './trace/TraceView.js';
import { ContextView } from './context/ContextView.js';
import { RightbarOpenButton, RightbarPanel } from './rightbar/RightbarPanel.js';
import { isFileTabId, filePathOf, type RightbarTabId, type StripTabId } from './rightbar/tabs.js';
import { addGuide, closeTab, focusTab, initialStrip, openFileTab as revealFileTab, pickGuideEntry, type StripState } from './rightbar/strip-state.js';
import { ErrorBoundary } from './shell/ErrorBoundary.js';
import { SHELL_COPY } from './shell/copy.js';
import { changesModel } from './rightbar/changes-model.js';
import { writeShellPreference } from './rightbar/terminal-shell.js';
import { useTheme } from './theme.js';
import { useTranscriptView } from './chat/transcript-view.js';

/**
 * The session pane's views, in tab order. The strip only renders when there is
 * more than one (`SessionHeader`'s rule), and these ARE the views it offers: the
 * conversation and the durable log behind it — plus the Context tab, which is
 * appended only while the `context` plugin provides a reading. That tab IS the
 * plugin's visible on/off: with no reading there is nothing to read, so it is
 * not offered (and a view left on it is dropped by the reducer).
 */
const SESSION_TABS = [
  { id: 'chat', label: '对话' },
  { id: 'trace', label: '轨迹' },
] as const;

const CONTEXT_TAB = { id: 'context', label: '上下文' } as const;

export function App(): JSX.Element {
  const { state, dispatch, send, connection, reconnect } = useAgent();
  /** Turn headers the reader opened; a settled turn starts collapsed without one. */
  const [openTurns, setOpenTurns] = useState<ReadonlySet<string>>(new Set());
  /** The settings dialog: the shell owns the panel, the sidebar foot the seat. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The right panel's four-page body (变更/文件/任务/终端). */
  const [rightbarOpen, setRightbarOpen] = useState(false);
  // The right panel's OPEN tabs and the one in front (null = the start page).
  // Held HERE (the panel still renders from props) because the column's error
  // boundary resets on the front tab: switching to another page must be a
  // fresh try for the component that failed, not the same notice forever.
  // The strip's open set and the tab in front live as ONE state — every
  // transition needs both (closing the front tab asks the remaining set for the
  // next one). The four reference rules are the pure functions in
  // `rightbar/strip-state.ts`; this is only the binding.
  const [strip, setStrip] = useState<StripState>(initialStrip);
  const pickStripTab = useCallback((tab: StripTabId): void => {
    setStrip((state) => focusTab(state, tab));
  }, []);
  const addGuideTab = useCallback((): void => { setStrip((state) => addGuide(state)); }, []);
  const openPageFromGuide = useCallback((page: RightbarTabId): void => {
    setStrip((state) => pickGuideEntry(state, page));
  }, []);
  const closeStripTab = useCallback((tab: StripTabId): void => {
    setStrip((state) => closeTab(state, tab));
    // A closed FILE tab takes its document with it: the strip owns what is on
    // screen, and a doc the strip no longer names is a dead cache (and would
    // re-render as its own pane if a later tab ever read `editor.docs`).
    if (isFileTabId(tab)) dispatch({ type: 'editor_close', path: filePathOf(tab) });
  }, [dispatch]);
  // A file opened from ANYWHERE (tree row, 变更 verb, later pages) takes the
  // same one entrance: the read goes out (the `sent` reduction places the
  // doc), the strip reveals-or-opens its tab. One gesture, one owner.
  const openFileTab = useCallback((path: string): void => {
    send({ type: 'read_entry', path });
    setStrip((state) => revealFileTab(state, path));
  }, [send]);
  // The start page's shell menu: remember the row, bring the terminal tab
  // forward, and let the terminal page re-aim its next open at the pick (the
  // epoch re-render is what reaches the page even when the strip state is
  // unchanged). A RUNNING terminal is killed here — an explicit respawn, the
  // same two halves the restart button performs.
  const [shellPick, setShellPick] = useState(0);
  const discoverShells = useCallback((): void => { send({ type: 'discover_shells' }); }, [send]);
  const pickTerminalShell = useCallback((path: string): void => {
    writeShellPreference(path);
    setStrip((state) => pickGuideEntry(state, 'terminal'));
    if (state.term.status === 'running') send({ type: 'term_kill' });
    setShellPick((epoch) => epoch + 1);
  }, [send, state.term.status]);
  const layout = useLayout();
  const theme = useTheme();
  const transcript = useTranscriptView();
  const { openRightbar, closeRightbar } = layout;

  // Per-session browser selections die with the session. The turn-collapse
  // set is keyed by block ids the baseline mints fresh (`b1…`): carrying the
  // old set across a switch would open the new session's turns by coincidence
  // of numbering. A re-attach to the same session keeps it — the sessionFile
  // effect simply does not run.
  const sessionFile = state.meta?.sessionFile ?? '';
  useEffect(() => {
    setOpenTurns(new Set());
  }, [sessionFile]);
  const toggleTurn = useCallback((id: string): void => {
    setOpenTurns((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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

  // The workspace shortlist the picker offers: what this browser has been in,
  // newest first. The live root is recorded as it arrives, so the menu always
  // contains the workspace in force even on a first visit (a local list would
  // otherwise start empty and offer nothing until a second switch).
  const [recentWorkspaces, setRecentWorkspaces] = useState<readonly string[]>(() => readRecentWorkspaces());
  const rootDir = state.meta?.rootDir ?? '';
  useEffect(() => {
    if (rootDir === '') return;
    setRecentWorkspaces((current) => (current[0] === rootDir ? current : rememberWorkspace(rootDir, current)));
  }, [rootDir]);
  const pickWorkspace = useCallback((dir: string): void => {
    send({ type: 'set_workspace', dir });
  }, [send]);

  // A file picked in the HOST's picker, on its way into the composer's rail.
  // Lifted here because the picker and the rail are different components: the
  // dialog's answer belongs to whoever opened it, and the `+` menu that opens it
  // lives inside `InputBar`. The counter makes the same path pickable twice
  // (naming one file, removing it, naming it again) — a bare string would be
  // identical on the second pick and the consumer's effect would not re-run.
  const [pickedFile, setPickedFile] = useState<{ path: string; name: string; seq: number } | null>(null);
  const pickFile = useCallback((path: string, name: string): void => {
    setPickedFile((current) => ({ path, name, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  // The native dialog is the FIRST move for both pickers (the `+` menu's
  // 引用本地文件 and the hero's 打开文件夹): the host opens the OS chooser and
  // answers with `picked`. The reply lands on the same two seams the in-page
  // browser's answers use (rail a file / adopt a workspace); a host without a
  // dialog falls back to that browser. See `shell/native-pick.ts`.
  const pickNative = useNativePick({
    send,
    pickPending: state.pickPending,
    pick: state.pick,
    onFile: pickFile,
    onDirectory: useCallback((dir: string) => {
      dispatch({ type: 'directory_open', open: false });
      pickWorkspace(dir);
    }, [dispatch, pickWorkspace]),
    onFallback: useCallback((kind) => {
      dispatch({ type: 'directory_open', open: true, mode: kind });
    }, [dispatch]),
  });

  const closeRightbarPanel = useCallback((): void => setRightbarOpen(false), []);
  // Escape closes one layer per press, topmost first: the right panel. The
  // narrow frame's sidebar expansion counts as the outermost layer — closing
  // it is the same "get this out of the way" gesture.
  useEscapeToClose([
    ...(rightbarOpen ? [closeRightbarPanel] : []),
    ...(layout.narrow && !layout.collapsed ? [layout.toggleSidebar] : []),
  ]);

  // The right column is a track, not a box: a shown panel RESERVES its track
  // (`openRightbar` owns the rule), so the centre makes room and the shell is
  // three columns — the panel slid in from the frame's right edge while the
  // conversation narrowed beside it.
  const open = rightbarOpen;
  useEffect(() => {
    if (!open) closeRightbar();
    else openRightbar(layout.layout.rightbarFullscreen);
  }, [open, openRightbar, closeRightbar, layout.layout.rightbarFullscreen]);

  const stopJob = useCallback((id: string): void => send({ type: 'stop_job', id }), [send]);
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
  // The Context pane's read: the reading also rides `ready` and every run's
  // end, so this is the open/refresh path only (mounting the tab, or pulling it
  // back to date after it was hidden).
  const onRefreshContext = useCallback((): void => send({ type: 'context' }), [send]);
  const toggleFullscreen = useCallback(
    (): void => openRightbar(!layout.layout.rightbarFullscreen),
    [openRightbar, layout.layout.rightbarFullscreen],
  );

  // One pure derivation for everything the frame shows about the session; the
  // JSX below reads fields instead of deciding (see chrome-view.ts).
  const view = chromeView(state);
  // The right panel's 变更 tab folds the conversation's own tool calls into a
  // change list — a pure derivation of the blocks, recomputed only when they do.
  const changes = useMemo(() => changesModel(state.blocks), [state.blocks]);
  // The flow is rebuilt only when a block changed, not on every frame: a stream
  // delta re-renders the transcript, and rebuilding 200 rows' element trees for
  // a frame that touched one of them is the waste the streaming pass removes.
  // Every option below is a primitive or a stable identity (useCallback'd
  // handlers, the state-backed openTurns set), so the memo holds across the
  // unrelated frames that land mid-run (usage, phase, notices).
  const runningStatus = useMemo(() => turnStatus(view.phase, view.running), [view.phase, view.running]);
  const rows = useMemo(
    () => flowRows(state.blocks, {
      idle: view.idle,
      onStopJob: stopJob,
      cwd: view.rootDir,
      runningStatus,
      openTurns,
      onToggleTurn: toggleTurn,
      modelName: state.modelName,
      policy: transcript.policy,
    }),
    [state.blocks, view.idle, stopJob, view.rootDir, runningStatus, openTurns, toggleTurn, state.modelName, transcript.policy],
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
    <>
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
          currentFile={state.meta?.sessionFile ?? ''}
          collapsed={collapsed}
          width={width}
          autoCollapsed={auto}
          connection={connection}
          onReconnect={reconnect}
          send={send}
          settingsOpen={settingsOpen}
          onOpenSettings={() => { setSettingsOpen(true); }}
          onDeleteSession={(file) => { send({ type: 'delete_session', file }); }}
          onReloadSessions={requestSessions}
          onToggleCollapsed={layout.toggleSidebar}
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
                tabs={state.context !== null ? [...SESSION_TABS, CONTEXT_TAB] : SESSION_TABS}
                activeTabId={state.view}
                onSelectTab={(id) => { dispatch({ type: 'select_view', view: id === 'trace' ? 'trace' : id === 'context' ? 'context' : 'chat' }); }}
                // The corner seat, shown only while the right column is
                // collapsed: the harness's own seat for the right panel
                // (`ui-sidebar-right/shell/ExpandButton`) holds exactly ONE
                // control — a second, near-identical glyph beside it read as
                // "two sidebars", and the detail board is opened by its tool row.
                corner={!open
                  ? <RightbarOpenButton onOpen={() => { setRightbarOpen(true); }} />
                  : undefined}
              />
            )}
            hero={
              <HeroShell
                version={state.meta?.version}
              />
            }
            heroWorkspaceRow={
              <WorkspaceRow
                workspace={view.workspace}
                workspacePath={state.meta?.rootDir}
                recentWorkspaces={recentWorkspaces}
                onPickWorkspace={pickWorkspace}
                // No `list_directory` here: the dialog's own opening effect owns
                // the first ask (it gates on "no level, nothing pending"), so
                // sending one here put TWO identical frames on the socket for one
                // 打开文件夹 click and let the two answers race. One gesture, one
                // request, one owner.
                onBrowse={() => { pickNative('directory'); }}
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
                  /* Keyed by request id, same rule as the approval card: two
                     questions in a row are two cards, and without the key React
                     would reuse the instance — carrying the pager index, the
                     drafts and the answer lock over from the previous batch. */
                  <QuestionPanel
                    key={state.pendingQuestion.id}
                    request={state.pendingQuestion}
                    send={send}
                    connected={state.connected}
                  />
                )}
                <QueueDock items={state.queued} />
                {/* The plan rides the dock ABOVE the input bar (dsh's
                    `conversation.input.dock` seat), so it widens the composer
                    stack rather than covering the transcript. */}
                {/* The goal sits ABOVE the plan: it is the longer-lived
                    intention, and the plan is its current step. */}
                <GoalPanel goal={state.goal} send={send} />
                <TodoPanel todos={state.todos} />
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
                  // The `/goal` hint disambiguates on whether a goal is already
                  // stored (dsh's `hint.goal.active` rule): a complete one counts.
                  hasGoal={state.goal !== null}
                  fileItems={state.files?.items ?? []}
                  filesTruncated={state.files?.truncated ?? false}
                  filesPending={state.files?.pending ?? false}
                  // The `+` menu's 引用本地文件 opens the HOST's NATIVE file
                  // dialog first; a host without one falls back to the in-page
                  // browser (see the `picked` consumer above).
                  onReferenceFile={() => { pickNative('file'); }}
                  pickedFile={pickedFile}
                  onPickedFileConsumed={() => { setPickedFile(null); }}
                  variant={phase === 'hero' ? 'hero' : 'composer'}
                  /* The dock row rides the composer's own dock slot (inside
                     the bar's root): that is where the harness mounts both
                     readings — the stats pills and the context meter share
                     one centered line under the card. The meter renders
                     nothing before the first usage lands, and the pills
                     nothing before the first billed run, so a fresh session's
                     dock is empty and hides itself. */
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
        </>
      }
      rightbar={({ width, canShow }) => {
        // The column is guarded on its own: a panel that cannot draw must cost
        // the reader the panel, not the conversation beside it. `resetKey` is
        // what is on screen, so switching tab is itself the way out.
        const occupant = ((): JSX.Element | null => {
        if (!rightbarOpen) return null;
        return (
          <RightbarPanel
            width={width}
            canShow={canShow}
            fullscreen={layout.layout.rightbarFullscreen}
            onToggleFullscreen={toggleFullscreen}
            onClose={closeRightbarPanel}
            tabs={strip.tabs}
            tab={strip.front}
            onPickTab={pickStripTab}
            onOpenPage={openPageFromGuide}
            shells={state.shells}
            shellPick={shellPick}
            onDiscoverShells={discoverShells}
            onPickShell={pickTerminalShell}
            onAddGuide={addGuideTab}
            onCloseTab={closeStripTab}
            changes={changes}
            tree={state.tree}
            term={state.term}
            currentFile={sessionFile}
            rootDir={view.rootDir}
            connected={connection === 'open'}
            editor={state.editor}
            git={state.git}
            jobs={state.jobs}
            clonePending={state.clonePending}
            // The git setup card's 打开文件夹 is the hero's own gesture: the
            // native dialog first, the in-page browser on fallback.
            onOpenWorkspace={() => { pickNative('directory'); }}
            // The 变更 row's verb opens the file as ITS OWN TAB (the strip's
            // reveal-if-opened) — the read goes out through the same one
            // entrance every other opener uses.
            onOpenFileTab={openFileTab}
            dispatch={dispatch}
            send={send}
            // The tree row's `@` railing reuses the pickers' own intake — one
            // channel, so a file named from the tree and a file named from the
            // OS dialog land in the composer as the same card.
            onReferenceFile={(path) => { pickFile(path, basename(path)); }}
          />
        );
        })();
        return (
          <ErrorBoundary
            label={SHELL_COPY['error.label.rightbar']}
            resetKey={rightbarOpen ? `panel:${strip.front}` : 'closed'}
          >
            {occupant}
          </ErrorBoundary>
        );
      }}
    />
    {/* The settings dialog the sidebar foot's seat opens. The shell registers
       the sections this product really has — 通用设置 (permission, execution
       mode, appearance, font size), 模型 (the catalog behind the composer's
       seat), 插件管理 (the kernel's roster as grouped switch rows + the config
       file's path), Skill 中心 (the discovered skills with per-name switches),
       QQ 机器人 (the third-party channel's connection page) — and the writes
       go through the same frames the composer's seats use, so a pick here and
       a pick there are one fact. */}
    {settingsOpen && (
      <SettingsPanel
        title="设置"
        closeLabel={SETTINGS_COPY['settings.close']}
        onClose={() => { setSettingsOpen(false); }}
        sections={(() => {
          // Which pages this product HAS is derived from the LIVE plugin roster,
          // never from a fixed list: a page whose plugin the operator switched off
          // must leave the nav, or the page itself claims the plugin is still
          // there (the reported 「关掉 QQ BOT 后它仍在设置页显示」). `plugins` is a
          // flip's answer and `roster` the first-paint snapshot; both are absent
          // until one lands, and an unknown row must not hide a page — so only an
          // explicit `enabled: false` counts as off (the same `?? true` reading
          // `PluginRow` draws its switch from).
          const rows = state.plugins?.entries ?? state.roster?.entries ?? [];
          const off = (name: string): boolean =>
            rows.some((row) => row.name === name && row.enabled === false);
          // A switched-off plugin leaves no fiber, but it keeps its ROW in 插件管理
          // (from the kernel's manifest), so the switch that closed it is also the
          // way back on — one door, and never a one-way one.
          return [
            {
              id: 'general',
              label: SETTINGS_COPY['general.nav'],
              icon: <SettingsIcon />,
              content: (
                <GeneralSection
                  approvalMode={state.approvalMode}
                  preference={theme.preference}
                  fontSize={theme.fontSize}
                  transcriptView={transcript.mode}
                  // Only "no session at all" blocks the tier here: the tier is
                  // read fresh at the NEXT approval, so it stays adjustable
                  // mid-run — that was a real defect once (`!isIdle` froze it
                  // exactly when the operator needed it).
                  disabled={approvalControlLocked(state)}
                  onPickApproval={(mode) => { send({ type: 'set_approval_mode', mode }); }}
                  onPickPreference={theme.setPreference}
                  onPickFontSize={theme.setFontSize}
                  onPickTranscriptView={transcript.setMode}
                />
              ),
            },
            {
              id: 'models',
              label: SETTINGS_COPY['models.nav'],
              icon: <DataOutline16 />,
              content: (
                <>
                  {/* The BYOK half first, then the catalog it produces: an operator
                      with no endpoint configures one here, and the model list below
                      only becomes meaningful afterwards. */}
                  <ProviderSection
                    providers={state.providers}
                    probe={state.providerProbe}
                    send={send}
                  />
                  <ModelSection
                    model={state.model}
                    switching={state.modelSwitching}
                    catalog={state.catalog}
                    send={send}
                  />
                  <ModelConfigEditor
                    config={state.modelConfig}
                    writable={state.modelSwitching}
                    send={send}
                  />
                </>
              ),
            },
            {
              id: 'plugins',
              label: SETTINGS_COPY['plugins.nav'],
              icon: <PluginIcon />,
              content: (
                <PluginsSection
                  roster={state.roster}
                  plugins={state.plugins}
                  disabled={modeControlsLocked(state)}
                  manageError={state.manageError}
                  send={send}
                  onClose={() => { setSettingsOpen(false); }}
                />
              ),
            },
            {
              id: 'skills',
              label: SETTINGS_COPY['skills.nav'],
              icon: <BookIcon />,
              content: (
                <SkillsSection
                  skills={state.skills}
                  disabled={modeControlsLocked(state)}
                  manageError={state.manageError}
                  send={send}
                  onClose={() => { setSettingsOpen(false); }}
                />
              ),
            },
            // The QQ channel's own page, and the one section a plugin OWNS: with the
            // plugin switched off it is gone rather than merely locked, and the way
            // back on is its row's switch in 插件管理 (which is where it was closed).
            ...(off('qqbot')
              ? []
              : [{
                  id: 'qqbot',
                  label: SETTINGS_COPY['qqbot.nav'],
                  icon: <ChatBotIcon />,
                  content: (
                    <QqbotSection
                      snapshot={state.qqbot}
                      test={state.qqbotTest}
                      disabled={!state.connected}
                      manageError={state.manageError}
                      send={send}
                      onClearTest={() => { dispatch({ type: 'qqbot_test_clear' }); }}
                    />
                  ),
                }]),
          ];
        })()}
      />
    )}
    {/* The workspace picker's directory browser. A browser tab has no folder
       chooser, so picking a workspace means asking the host to enumerate: the
       dialog sends `list_directory` / `create_directory` and draws whatever
       level comes back. It opens over the hero chip's "打开文件夹…" row. */}
    {state.directory !== null && (
      <DirectoryBrowser
        level={state.directory.level}
        error={state.directory.error}
        pending={state.directory.pending}
        mode={state.directory.mode}
        onList={(dir, files) => {
          dispatch({ type: 'directory_ask' });
          send({
            type: 'list_directory',
            ...(dir === undefined ? {} : { dir }),
            ...(files === true ? { files: true } : {}),
          });
        }}
        onCreate={(dir, name) => {
          dispatch({ type: 'directory_ask' });
          send({ type: 'create_directory', dir, name });
        }}
        onOpen={(dir) => {
          dispatch({ type: 'directory_open', open: false });
          pickWorkspace(dir);
        }}
        onPickFile={(path, name) => {
          dispatch({ type: 'directory_open', open: false });
          pickFile(path, name);
        }}
        onClose={() => { dispatch({ type: 'directory_open', open: false }); }}
      />
    )}
    </>
  );
}