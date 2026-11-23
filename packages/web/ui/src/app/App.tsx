/**
 * The root: state holding and routing, nothing else. The frame's geometry is
 * `app/AppShell.tsx`, the main column's occupants are `app/routes/`, the
 * settings dialog is `app/SettingsOverlay.tsx`. What lives HERE is the state
 * whose lifetime spans surfaces — the open dialogs, the right panel's strip,
 * the per-session turn-collapse set, the browser's workspace memory — and the
 * one gesture table that ties them together (a file opened from ANYWHERE takes
 * the same one entrance; an Escape closes one layer per press, topmost first).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StripTabId } from '../rightbar/tabs.js';
import { isFileTabId, filePathOf } from '../rightbar/tabs.js';
import { closeTab, focusTab, FILES_TAB, initialStrip, openFileTab as revealFileTab, type StripState } from '../rightbar/strip-state.js';
import { docAt } from '../rightbar/editor-model.js';
import { readRecentWorkspaces, rememberWorkspace } from '../shell/workspaces.js';
import { useEscapeToClose } from '../shell/use-escape.js';
import { useLayout } from '../shell/use-layout.js';
import { WindowControls } from '../shell/WindowControls.js';
import { RIGHTBAR_COLLAPSE_BELOW_CONVERSATION } from '../shell/columns.js';
import { useNativePick } from '../shell/native-pick.js';
import { DocumentTitle } from '../shell/DocumentTitle.js';
import { loadBootGraph } from '../plugins/client-loader.js';
import { chromeView } from '../chrome-view.js';
import { DirectoryBrowser } from '../conversation/DirectoryBrowser.js';
import { basename } from '../composer/file-type.js';
import { SETTINGS_COPY } from '../settings/copy.js';
import { useAgent } from '../client.js';
import { A2uiActionProvider } from '../a2ui/action-context.js';
import { AppShell } from './AppShell.js';
import { SettingsOverlay } from './SettingsOverlay.js';
import { PluginCenterRoute } from './routes/PluginCenterRoute.js';
import { SessionRoute } from './routes/SessionRoute.js';

export function App(): JSX.Element {
  const { state, dispatch, send, connection, reconnect } = useAgent();
  /** Turn headers the reader opened; a settled turn starts collapsed without one. */
  const [openTurns, setOpenTurns] = useState<ReadonlySet<string>>(new Set());
  /** The settings dialog: the shell owns the panel, the sidebar foot the seat. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The plugin center owning the main column. It sits on the sidebar beside
   * 新会话 rather than in the settings dialog, so the shell holds it here and
   * the column shows either a session or this page — never both.
   */
  const [pluginsOpen, setPluginsOpen] = useState(false);
  // Sections holding unsaved edits (a plugin page's field drafts). The panel
  // reads this to ask before a switch discards them; the sections REPORT it,
  // because only a section knows what its draft means.
  const [dirtySections, setDirtySections] = useState<ReadonlySet<string>>(new Set());
  const markSectionDirty = useCallback((id: string, dirty: boolean): void => {
    setDirtySections((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // One stable reporter per section id: PluginPageSection re-reports when the
  // callback identity changes, so a fresh closure per render would re-report
  // (harmlessly, but on every keystroke). The map keeps identity per id.
  const dirtyReportersRef = useRef(new Map<string, (dirty: boolean) => void>());
  const dirtyReporter = useCallback((id: string): ((dirty: boolean) => void) => {
    let report = dirtyReportersRef.current.get(id);
    if (report === undefined) {
      report = (dirty) => { markSectionDirty(id, dirty); };
      dirtyReportersRef.current.set(id, report);
    }
    return report;
  }, [markSectionDirty]);
  /** The right panel: the workspace directory and a file preview. Closed on
   *  launch — it opens on demand from the header's corner button. */
  const [rightbarOpen, setRightbarOpen] = useState(false);
  // The right panel's OPEN tabs and the one in front. 文件 is always first and
  // never closes; file tabs come and go. The rules are the pure functions in
  // `rightbar/strip-state.ts`; this is only the binding.
  const [strip, setStrip] = useState<StripState>(initialStrip);
  const editor = state.editor;
  const pickStripTab = useCallback((tab: StripTabId): void => {
    setStrip((state) => focusTab(state, tab));
  }, []);
  const closeStripTab = useCallback((tab: StripTabId): void => {
    setStrip((state) => closeTab(state, tab));
    // A closed FILE tab takes its document with it: the strip owns what is on
    // screen, and a doc the strip no longer names is a dead cache (and would
    // re-render as its own pane if a later tab ever read `editor.docs`).
    if (isFileTabId(tab)) dispatch({ type: 'editor_close', path: filePathOf(tab) });
  }, [dispatch]);
  // One entrance for every "open the right panel" gesture (the header's corner
  // button, a file opened from the tree). The reference opens its side pane
  // from concrete user actions only, and Nova agrees: the panel is closed on
  // launch, a file named anywhere opens it. The FILES fallback is the expand
  // guarantee: the front tab's document may be gone (a removed file closed its
  // doc, a tab closed under us), and a panel whose body renders blank is
  // worse than one that opens on the directory.
  const openRightbarPanel = useCallback((): void => {
    setRightbarOpen(true);
    setStrip((state) =>
      isFileTabId(state.front) && docAt(editor, filePathOf(state.front)) === null
        ? focusTab(state, FILES_TAB)
        : state,
    );
  }, [editor]);
  // A file opened from the tree takes one entrance: the read goes out (the
  // `sent` reduction places the doc), the strip reveals-or-opens its tab, and
  // the panel opens to receive it (the reference's side pane opens on the
  // action that names its content — not on a hunt for a corner button).
  const openFileTab = useCallback((path: string): void => {
    send({ type: 'read_entry', path });
    setStrip((state) => revealFileTab(state, path));
    openRightbarPanel();
  }, [send, openRightbarPanel]);
  const layout = useLayout();
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
  // answer travels, so a switch never blanks the panel.
  const requestSessions = useCallback((): void => {
    if (state.sessionsPending) return;
    send({ type: 'list_sessions' });
  }, [send, state.sessionsPending]);
  useEffect(() => {
    if (connection === 'open' && state.sessionsStale) requestSessions();
  }, [connection, state.sessionsStale, requestSessions]);

  // A plugin's BROWSER half is a script served from `/plugins/<name>/…` and
  // declared on its own roster row (`clientBundle`). This is the ONLY caller of
  // the boot graph: without it the whole seam is a capability nobody invokes.
  // The roster that `ready` already carries is walked once per attach.
  //
  // Failures stay local to their row: `loadBootGraph` reports per entry instead
  // of throwing, a broken bundle is remembered as failed and never retried, and
  // it cannot hold up the others — the same rule the kernel side follows (a
  // plugin's failure is data, not a broken host).
  const rosterEntries = state.roster?.entries;
  useEffect(() => {
    if (connection !== 'open' || rosterEntries === undefined) return;
    void loadBootGraph(rosterEntries).then((reports) => {
      for (const report of reports) {
        if ('error' in report) console.error(`client plugin '${report.name}' failed to load`, report.error);
      }
    });
  }, [connection, rosterEntries]);

  // The workspace shortlist the picker offers: what this browser has been in,
  // newest first. The live root is recorded as it arrives, so the menu always
  // contains the workspace in force even on a first visit.
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
  // dialog's answer belongs to whoever opened it.
  const [pickedFile, setPickedFile] = useState<{ path: string; name: string; seq: number } | null>(null);
  const pickFile = useCallback((path: string, name: string): void => {
    setPickedFile((current) => ({ path, name, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  // The native dialog is the FIRST move for both pickers (the `+` menu's
  // 引用本地文件 and the hero's 打开文件夹): the host opens the OS chooser and
  // answers with `picked`. A host without a dialog falls back to the in-page
  // browser. See `shell/native-pick.ts`.
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
  // narrow frame's sidebar expansion counts as the outermost layer.
  useEscapeToClose([
    ...(rightbarOpen ? [closeRightbarPanel] : []),
    ...(layout.narrow && !layout.collapsed ? [layout.toggleSidebar] : []),
  ]);

  // The right column is a track, not a box: a shown panel RESERVES its track,
  // so the centre makes room and the shell is three columns.
  useEffect(() => {
    if (!rightbarOpen) closeRightbar();
    else openRightbar(layout.layout.rightbarFullscreen);
  }, [rightbarOpen, openRightbar, closeRightbar, layout.layout.rightbarFullscreen]);

  /**
   * The right panel's own auto-collapse (the reference's
   * `CONVERSATION_AUTO_COLLAPSE_SIDE_PANE_WIDTH_PX` = 480,
   * `WorkspaceShellLayout.tsx:153, 940-953`): once the conversation column is
   * narrower than the panel it is standing beside, the panel closes itself
   * rather than shrinking the transcript to a strip. It is a CLOSE, not a
   * takeover — a panel that covers the column costs the reader what they were
   * reading.
   *
   * The reference runs this only off a window resize and deliberately skips
   * its own ResizeObserver, so a panel the reader opened is never closed by
   * policy a moment later. Nova keeps that rule in `use-layout`: the measured
   * width lands once the frame settles, never per drag frame. The panel is
   * fullscreen-exempt, like the reference's full view.
   */
  useEffect(() => {
    if (!rightbarOpen || layout.layout.rightbarFullscreen) return;
    if (layout.layout.conversationWidth <= 0) return;
    if (layout.layout.conversationWidth >= RIGHTBAR_COLLAPSE_BELOW_CONVERSATION) return;
    setRightbarOpen(false);
  }, [rightbarOpen, layout.layout.conversationWidth, layout.layout.rightbarFullscreen]);

  // The New Task row's advertised shortcut, made real: Ctrl/Cmd+N starts a
  // session (leaving the plugin center first, like every session gesture).
  // Without this binding the row's hint would be a lie, and a hint for a key
  // that does nothing is worse than no hint. A new session also COLLAPSES the
  // right panel (the reference's new task collapses its side pane): a fresh
  // conversation wants the whole centre, and the files it previewed belong to
  // the session it replaced.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      setPluginsOpen(false);
      setRightbarOpen(false);
      send({ type: 'new_session' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [send]);

  const toggleFullscreen = useCallback(
    (): void => openRightbar(!layout.layout.rightbarFullscreen),
    [openRightbar, layout.layout.rightbarFullscreen],
  );

  const view = chromeView(state);

  const center = pluginsOpen ? (
    <PluginCenterRoute
      state={state}
      send={send}
      {...(!rightbarOpen ? { corner: <WindowControls /> } : {})}
    />
  ) : (
    <SessionRoute
      state={state}
      send={send}
      dispatch={dispatch}
      openTurns={openTurns}
      onToggleTurn={toggleTurn}
      recentWorkspaces={recentWorkspaces}
      onPickWorkspace={pickWorkspace}
      onBrowse={() => { pickNative('directory'); }}
      pickedFile={pickedFile}
      onPickedFileConsumed={() => { setPickedFile(null); }}
      onReferenceFile={() => { pickNative('file'); }}
      rightbarOpen={rightbarOpen}
      onOpenRightbar={openRightbarPanel}
    />
  );

  return (
    <A2uiActionProvider send={send}>
    <>
      <DocumentTitle title={pluginsOpen ? SETTINGS_COPY['plugins.title'] : view.title} />
      <AppShell
        state={state}
        send={send}
        dispatch={dispatch}
        connection={connection}
        reconnect={reconnect}
        layout={layout}
        center={center}
        settingsOpen={settingsOpen}
        onOpenSettings={() => { setSettingsOpen(true); }}
        pluginsOpen={pluginsOpen}
        onOpenPlugins={() => { setPluginsOpen(true); }}
        onLeavePlugins={() => { setPluginsOpen(false); }}
        onReloadSessions={requestSessions}
        rightbarOpen={rightbarOpen}
        strip={strip}
        onPickStripTab={pickStripTab}
        onCloseStripTab={closeStripTab}
        onOpenFileTab={openFileTab}
        onReferenceFile={(path) => { pickFile(path, basename(path)); }}
        onToggleFullscreen={toggleFullscreen}
        onCloseRightbar={closeRightbarPanel}
        onOpenRightbar={openRightbarPanel}
      />
      {settingsOpen && (
        <SettingsOverlay
          state={state}
          send={send}
          dispatch={dispatch}
          dirtySections={dirtySections}
          dirtyReporter={dirtyReporter}
          onClose={() => { setSettingsOpen(false); }}
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
    </A2uiActionProvider>
  );
}
