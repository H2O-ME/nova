/**
 * The right sidebar: one panel, its open tabs, and a start page between them.
 *
 * Rebuilt from the reference (dsh-better-sidebar, MIT) rather than patched: the
 * strip is a TAB STRIP over the pages the reader has OPEN ({@link RightbarStrip},
 * its own sheet), and while no tab is in front the body is the reference's guide
 * page ({@link StartView}): a muted compass over entry capsules, a doorway rather
 * than a page that stays open. Closing the front tab lands back on the start page,
 * which is how the panel is emptied without closing the column.
 *
 * This file answers one question — how the panel mounts its pages and presents
 * itself in the frame. How the strip is drawn is the strip's own answer.
 *
 * The frame owns the column's geometry and passes the resolved width in; the
 * panel reports nothing back, because the shell (App) is what calls
 * `openRightbar`/`closeRight`. `fullscreen` and `takeover` are the frame's
 * two presentations and are drawn here (`data-rightbar`).
 */
import { PanelIcon } from '../icons.js';
import type { ClientFrame, WireJobRow, WireShell } from '../types.js';
import type { Action, GitState } from '../state.js';
import { ChangesView, type ChangesLens } from './ChangesView.js';
import { FileTabView } from './FileTabView.js';
import { FilesView } from './FilesView.js';
import { TasksView } from './TasksView.js';
import { TerminalView } from './TerminalView.js';
import { RightbarStrip } from './RightbarStrip.js';
import { StartView } from './StartView.js';
import { RIGHTBAR_COPY } from './copy.js';
import type { ChangesModel } from './changes-model.js';
import { docAt, type EditorState } from './editor-model.js';
import type { TreeState } from './files-model.js';
import type { TermState } from './terminal-model.js';
import { GUIDE_TAB, isFileTabId, filePathOf, type RightbarTabId, type StripTabId } from './tabs.js';
import css from './RightbarPanel.module.css';

/** The reducer dispatch the panels share (any of the union's actions). */
export type PanelDispatch = (action: Action) => void;

export interface RightbarPanelProps {
  /** Resolved normal panel width in px (AppFrame's rightbar slot parameter). */
  width: number;
  /** The column has a track for the panel; false = the panel covers the centre. */
  canShow: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** The tabs the reader has OPEN, in strip order (the start page is one of them). */
  tabs: readonly StripTabId[];
  /** The tab in front. */
  tab: StripTabId;
  onPickTab: (tab: StripTabId) => void;
  /** Pick an entry from the start page: it REPLACES that tab with the page. */
  onOpenPage: (page: RightbarTabId) => void;
  /** Open the start page as a new tab (the strip's `+`). */
  onAddGuide: () => void;
  /** Close one tab. */
  onCloseTab: (tab: StripTabId) => void;
  /** Everything the pages read — one prop per fact, no re-derivation. */
  changes: ChangesModel;
  tree: TreeState;
  term: TermState;
  /** The host's discovered shells (the terminal picker's rows); null until asked. */
  shells: { items: readonly WireShell[]; current: string } | null;
  /** Bumped when the reader picks a shell on the start page (the respawn trigger). */
  shellPick: number;
  /** Ask the host for its shell inventory (the start-page menu's open gesture). */
  onDiscoverShells: () => void;
  /** Remember a shell picked on the start page and (re)aim the terminal at it. */
  onPickShell: (path: string) => void;
  currentFile: string;
  rootDir: string;
  connected: boolean;
  editor: EditorState;
  git: GitState | null;
  jobs: readonly WireJobRow[] | null;
  /** A `git_clone` is in flight (the setup card's button says so). */
  clonePending?: boolean | undefined;
  /** Open the workspace picker (the git setup card's 打开文件夹). */
  onOpenWorkspace?: (() => void) | undefined;
  /** Open a changed file as its own tab (the 变更 row's verb). */
  onOpenFileTab: (path: string) => void;
  /** The reducer dispatch (page-local actions). */
  dispatch: PanelDispatch;
  send: (frame: ClientFrame) => void;
  /** Rail a tree row into the composer draft (`@rel`); absent = no per-row button. */
  onReferenceFile?: ((path: string) => void) | undefined;
  /** The 变更 page's lens; uncontrolled (remembered by that page) when omitted. */
  changesLens?: ChangesLens | undefined;
  onPickChangesLens?: ((lens: ChangesLens) => void) | undefined;
}

export function RightbarPanel(props: RightbarPanelProps): JSX.Element {
  const presentation = props.fullscreen ? 'fullscreen' : props.canShow ? 'push' : 'takeover';
  return (
    <aside
      className={css.panel}
      data-rightbar={presentation}
      style={presentation === 'push' ? { width: props.width } : undefined}
      aria-label={RIGHTBAR_COPY['panel.label']}
    >
      <RightbarStrip
        tabs={props.tabs}
        tab={props.tab}
        onPickTab={props.onPickTab}
        onCloseTab={props.onCloseTab}
        onAddGuide={props.onAddGuide}
        fullscreen={props.fullscreen}
        onToggleFullscreen={props.onToggleFullscreen}
        onClose={props.onClose}
      />
      <div className={css.body}>
        {/* Open pages stay mounted while another is in front (`display: none`):
            the tree's level cache, the editor's documents and the terminal's
            owed output batch all live in the reducer (the emulator's own screen
            is its own local state — it never unmounts), but a page's own local
            state (scroll position, the dock width) would still be torn down by
            a switch. The start page is a TAB of its own (the reference's
            `GUIDE_KIND`), drawn while it is the one in front; it holds no state,
            so it needs no mount to survive a switch. */}
        {props.tab === GUIDE_TAB && (
          <StartView
            onOpen={props.onOpenPage}
            shells={props.shells}
            onDiscoverShells={props.onDiscoverShells}
            onPickShell={props.onPickShell}
          />
        )}
        {/* A file tab in front IS the body: one read-only viewer for that path
            (the strip's tab is the tab bar; the page never grows its own). */}
        {isFileTabId(props.tab) && (() => {
          const doc = docAt(props.editor, filePathOf(props.tab));
          return doc !== null ? <div className={css.page} data-active><FileTabView doc={doc} send={props.send} /></div> : null;
        })()}
        {props.tabs.map((id) => (id === GUIDE_TAB || isFileTabId(id) ? null : (
          <div key={id} className={css.page} data-active={id === props.tab || undefined}>
            {id === 'changes' && (
              <ChangesView
                model={props.changes}
                git={props.git}
                connected={props.connected}
                send={props.send}
                onOpenFileTab={props.onOpenFileTab}
                {...(props.clonePending !== undefined ? { clonePending: props.clonePending } : {})}
                {...(props.onOpenWorkspace !== undefined ? { onOpenWorkspace: props.onOpenWorkspace } : {})}
                {...(props.changesLens !== undefined ? { lens: props.changesLens } : {})}
                {...(props.onPickChangesLens !== undefined ? { onPickChangesLens: props.onPickChangesLens } : {})}
              />
            )}
            {id === 'files' && (
              <FilesView
                rootDir={props.rootDir}
                tree={props.tree}
                git={props.git}
                connected={props.connected}
                send={props.send}
                onOpenFileTab={props.onOpenFileTab}
                {...(props.onReferenceFile !== undefined ? { onReferenceFile: props.onReferenceFile } : {})}
              />
            )}
            {id === 'tasks' && <TasksView jobs={props.jobs} connected={props.connected} send={props.send} />}
            {id === 'terminal' && (
              <TerminalView
                term={props.term}
                rootDir={props.rootDir}
                connected={props.connected}
                send={props.send}
                shells={props.shells}
                pick={props.shellPick}
              />
            )}
          </div>
        )))}
      </div>
    </aside>
  );
}

/**
 * The way back in when the panel is closed.
 *
 * The reference puts its expand button in the conversation header's corner seat
 * and mirrors the sidebar's own collapse glyph (`transform: scaleX(-1)`), so
 * open and close read as one control seen from two sides. This is that button,
 * exported for whichever seat the shell gives it.
 */
export function RightbarOpenButton({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={css.openButton}
      aria-label={RIGHTBAR_COPY['panel.open']}
      title={RIGHTBAR_COPY['panel.open']}
      onClick={onOpen}
    >
      <PanelIcon className={css.openGlyph} />
    </button>
  );
}
