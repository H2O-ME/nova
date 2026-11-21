/**
 * The right sidebar: the workspace directory and its file preview.
 *
 * One page, one strip: 文件 is the tree; opening a row adds a document tab and
 * the preview replaces the tree in the same body. That is the panel's whole
 * job — no 变更 / 任务 / 终端 / guide pages. The product is a general personal
 * agent, so the right column is a file browser, not an IDE workbench.
 *
 * The frame owns the column's geometry and passes the resolved width in; the
 * panel reports nothing back, because the shell (App) is what calls
 * `openRightbar`/`closeRight`. `fullscreen` and `takeover` are the frame's two
 * presentations and are drawn here (`data-rightbar`).
 */
import { PanelRightIcon } from '../icons.js';
import type { ClientFrame } from '../types.js';
import type { Action, GitState } from '../state.js';
import { FileTabView } from './FileTabView.js';
import { FilesView } from './FilesView.js';
import { RightbarStrip } from './RightbarStrip.js';
import { RIGHTBAR_COPY } from './copy.js';
import { docAt, type EditorState } from './editor-model.js';
import type { TreeState } from './files-model.js';
import { isFileTabId, filePathOf, type StripTabId } from './tabs.js';
import css from './RightbarPanel.module.css';

/** The reducer dispatch the panel shares (any of the union's actions). */
export type PanelDispatch = (action: Action) => void;

export interface RightbarPanelProps {
  /** Resolved normal panel width in px (AppFrame's rightbar slot parameter). */
  width: number;
  /** The column has a track for the panel; false = the panel covers the centre. */
  canShow: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** The tabs the reader has OPEN, in strip order (文件 is always first). */
  tabs: readonly StripTabId[];
  /** The tab in front. */
  tab: StripTabId;
  onPickTab: (tab: StripTabId) => void;
  /** Close one file tab. */
  onCloseTab: (tab: StripTabId) => void;
  tree: TreeState;
  editor: EditorState;
  rootDir: string;
  connected: boolean;
  git: GitState | null;
  /** Open a tree row as its own tab. */
  onOpenFileTab: (path: string) => void;
  /** The reducer dispatch (page-local actions). */
  dispatch: PanelDispatch;
  send: (frame: ClientFrame) => void;
  /** Rail a tree row into the composer draft (`@rel`); absent = no per-row button. */
  onReferenceFile?: ((path: string) => void) | undefined;
}

export function RightbarPanel(props: RightbarPanelProps): JSX.Element {
  const presentation = props.fullscreen ? 'fullscreen' : props.canShow ? 'push' : 'takeover';
  const frontDoc = isFileTabId(props.tab) ? docAt(props.editor, filePathOf(props.tab)) : null;
  return (
    <aside
      className={css.panel}
      data-rightbar={presentation}
      aria-label={RIGHTBAR_COPY['panel.label']}
    >
      <RightbarStrip
        tabs={props.tabs}
        tab={props.tab}
        onPickTab={props.onPickTab}
        onCloseTab={props.onCloseTab}
        fullscreen={props.fullscreen}
        onToggleFullscreen={props.onToggleFullscreen}
        onClose={props.onClose}
      />
      <div className={css.body}>
        {/* The 文件 page stays mounted while a document is in front: the tree's
            level cache lives in the reducer, but its scroll position and dock
            width are local state that a switch would otherwise tear down. */}
        <div className={css.page} data-active={!isFileTabId(props.tab) || undefined}>
          <FilesView
            rootDir={props.rootDir}
            tree={props.tree}
            git={props.git}
            connected={props.connected}
            send={props.send}
            onOpenFileTab={props.onOpenFileTab}
            {...(props.onReferenceFile !== undefined ? { onReferenceFile: props.onReferenceFile } : {})}
          />
        </div>
        {/* A file tab in front IS the body: one read-only viewer for that path
            (the strip's tab is the tab bar; the page never grows its own). */}
        {isFileTabId(props.tab) && (
          <div className={css.page} data-active>
            {frontDoc !== null && <FileTabView doc={frontDoc} send={props.send} />}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * The way back in when the panel is closed.
 *
 * The glyph is its own drawing (`PanelRightIcon` — right divider plus content
 * lines), because mirroring the sidebar's collapse control reads as the same
 * control twice. Exported for whichever seat the shell gives it.
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
      <PanelRightIcon className={css.openGlyph} />
    </button>
  );
}
