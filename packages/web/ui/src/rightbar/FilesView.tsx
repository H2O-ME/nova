/**
 * 文件: the workspace tree, full page.
 *
 * The reference's own shape (dsh `ui-sidebar-files`): a single-click on a file
 * opens it as ITS OWN TAB in the strip (`openFileTab`, reveal-if-opened) — not
 * docked beside the tree, not on a second page. The old in-page dock (draggable
 * width, hide/show, a preview pane living beside the rows) is gone: the tree is
 * the page, and every open file is a tab, which is where the reference keeps
 * open documents.
 *
 * Nothing here derives a fact of its own: the rows are `files-model.ts`, the
 * decorations are `git-marks.ts`, and every verb is one frame.
 */
import { useEffect } from 'react';
import type { ClientFrame } from '../types.js';
import type { GitState } from '../state.js';
import { TreeDock } from './TreeDock.js';
import { needsListing, type TreeState } from './files-model.js';
import css from './FilesView.module.css';

export interface FilesViewProps {
  /** The session's workspace root; '' when there is none. */
  rootDir: string;
  tree: TreeState;
  /** The reducer's git slice — the tree's decorations, from the same answer 变更 draws. */
  git: GitState | null;
  /** Whether the WS is connected (an ask sent while disconnected is lost). */
  connected: boolean;
  send: (frame: ClientFrame) => void;
  /** Open one file as its own tab (the strip's reveal-if-opened). */
  onOpenFileTab: (path: string) => void;
  /** Rail one reference into the composer draft (`@rel`); absent = no button. */
  onReferenceFile?: ((path: string) => void) | undefined;
}

export function FilesView({
  rootDir,
  tree,
  git,
  connected,
  send,
  onOpenFileTab,
  onReferenceFile,
}: FilesViewProps): JSX.Element {
  // The root level is asked for by THIS window, so opening the page is enough to
  // draw a tree — the reader never has to click a folder to see anything. A root
  // that changed (a session switch moved the workspace) is a new level by key.
  useEffect(() => {
    if (!connected || rootDir === '') return;
    if (needsListing(tree, rootDir)) send({ type: 'list_directory', dir: rootDir, files: true });
  }, [connected, rootDir, tree, send]);

  // The decorations come from the same `git_status` answer the 变更 page draws,
  // and this window may well be the FIRST page a reader opens — without this ask
  // the tree would be colorless until they happened to visit 变更. The reading is
  // stamped with the root it answered for, so a moved workspace re-asks instead
  // of coloring this tree from another repository's status.
  useEffect(() => {
    if (connected && (git === null || git.root !== rootDir)) send({ type: 'git_status' });
  }, [connected, git, rootDir, send]);

  return (
    <div className={css.view} data-tree-full="">
      <div className={css.dock}>
        <TreeDock
          rootDir={rootDir}
          tree={tree}
          git={git}
          currentFile={null}
          connected={connected}
          send={send}
          onOpenFile={onOpenFileTab}
          {...(onReferenceFile !== undefined ? { onReferenceFile } : {})}
        />
      </div>
    </div>
  );
}
