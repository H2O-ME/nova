/**
 * 文件: the workspace tree docked beside the file it opens.
 *
 * The reference's headline shape (`dsh-better-sidebar` `EditorHost.tsx`), and
 * the answer to 「文件页面居然需要我再选择一遍工作区」: the tree's root is the
 * SESSION's workspace — the same `rootDir` every other panel reads — so this page
 * never asks the reader where they are, and a click opens the file BESIDE the
 * tree, in place, instead of on a separate page.
 *
 * The dock sits on the window's right edge with a 1px hairline on its left (the
 * reference's `editorTreeDock`, 240px default, 160–480 draggable, remembered per
 * browser) and drags LEFT to widen, because it owns the frame's edge and moving
 * its leading edge is the only direction that does not push the file away.
 *
 * Nothing here derives a fact of its own: the rows are `files-model.ts`, the
 * decorations are `git-marks.ts`, the documents are `editor-model.ts`, and every
 * verb is one frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientFrame } from '../types.js';
import type { Action, GitState } from '../state.js';
import { PreviewPane } from './PreviewPane.js';
import { TreeDock } from './TreeDock.js';
import { needsListing, type TreeState } from './files-model.js';
import type { EditorState } from './editor-model.js';
import { RIGHTBAR_COPY } from './copy.js';
import { SaveGlyph, TreeDockGlyph } from './panel-icons.js';
import { IconButton } from './kit.js';
import { cx } from '../composer/cx.js';
import css from './FilesView.module.css';

/** Where the docked tree's state lives (versioned: a future shape takes a new key). */
export const TREE_STORAGE_KEY = 'nova.rightbar.tree.v2';

/** The docked tree's width bounds (the drag clamps into them). */
export const TREE_WIDTH_MIN = 160;
export const TREE_WIDTH_MAX = 480;
const TREE_WIDTH_DEFAULT = 240;

/** What this window remembers about its dock. */
export interface TreePreference {
  open: boolean;
  width: number;
}

/**
 * The remembered dock, or the contract default.
 *
 * Anything unrecognized — a stale key, a hand-edited width — resolves to the
 * default instead of a broken pane; storage failure is not an error worth
 * surfacing (the window works without remembering).
 * @returns the dock state to open with.
 */
export function readTreePreference(): TreePreference {
  try {
    const raw = window.localStorage.getItem(TREE_STORAGE_KEY);
    if (raw === null) return { open: true, width: TREE_WIDTH_DEFAULT };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { open: true, width: TREE_WIDTH_DEFAULT };
    const candidate = parsed as { open?: unknown; width?: unknown };
    const open = typeof candidate.open === 'boolean' ? candidate.open : true;
    const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width)
      ? Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(candidate.width)))
      : TREE_WIDTH_DEFAULT;
    return { open, width };
  } catch {
    return { open: true, width: TREE_WIDTH_DEFAULT };
  }
}

/** Remember the dock state; a browser that refuses storage still gets a working window. */
export function writeTreePreference(preference: TreePreference): void {
  try {
    window.localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // See the header: the preference is a convenience, not a correctness need.
  }
}

export interface FilesViewProps {
  /** The session's workspace root; '' when there is none. */
  rootDir: string;
  tree: TreeState;
  editor: EditorState;
  /** The reducer's git slice — the tree's decorations, from the same answer 变更 draws. */
  git: GitState | null;
  /** Whether the WS is connected (an ask sent while disconnected is lost). */
  connected: boolean;
  send: (frame: ClientFrame) => void;
  /** The reducer's dispatch (the doc strip's activate / close; the slice is the reducer's). */
  dispatch: (action: Action) => void;
  /** Rail one reference into the composer draft (`@rel`); absent = no button. */
  onReferenceFile?: ((path: string) => void) | undefined;
}

export function FilesView({
  rootDir,
  tree,
  editor,
  git,
  connected,
  send,
  dispatch,
  onReferenceFile,
}: FilesViewProps): JSX.Element {
  const [preference, setPreference] = useState<TreePreference>(readTreePreference);
  useEffect(() => { writeTreePreference(preference); }, [preference]);

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

  const doc = editor.docs.find((candidate) => candidate.path === editor.active) ?? null;
  const save = useCallback((): void => {
    if (doc === null) return;
    send({ type: 'write_entry', path: doc.path, content: doc.text });
  }, [doc, send]);

  return (
    <div className={css.view}>
      <header className={css.header}>
        <span className={css.path} title={doc?.path ?? rootDir}>
          {doc !== null ? <span className={css.pathName}>{doc.path}</span> : <span className={css.pathDim}>{RIGHTBAR_COPY['files.workspace']}</span>}
        </span>
        {doc !== null && !doc.loading && doc.error === undefined && !doc.binary && !doc.truncated && (
          <>
            <span className={css.saveState} data-dirty={doc.dirty ? '' : undefined}>
              {doc.dirty ? RIGHTBAR_COPY['editor.dirty'] : RIGHTBAR_COPY['editor.saved']}
            </span>
            <IconButton label={RIGHTBAR_COPY['editor.save']} onClick={save} disabled={!doc.dirty}>
              <SaveGlyph />
            </IconButton>
          </>
        )}
        {doc !== null && (
          <IconButton
            label={preference.open ? RIGHTBAR_COPY['files.hideTree'] : RIGHTBAR_COPY['files.showTree']}
            active={preference.open}
            onClick={() => { setPreference((p) => ({ ...p, open: !p.open })); }}
          >
            <TreeDockGlyph />
          </IconButton>
        )}
      </header>
      {/* No document open: the tree IS the page (the reference's path-less home
          tab renders the standalone explorer, not a dock beside an empty pane) —
          docking beside a placeholder wastes the width the tree could use. */}
      <div
        className={css.body}
        {...(doc === null
          ? { 'data-tree-full': '' }
          : { 'data-dock': preference.open ? '' : undefined })}
      >
        {doc !== null && (
          <div className={css.main}>
            <PreviewPane editor={editor} dispatch={dispatch} send={send} />
          </div>
        )}
        {(doc === null || preference.open) && (
          <>
            {doc !== null && (
              <DockDivider
                width={preference.width}
                onWidth={(width) => { setPreference((p) => ({ ...p, width })); }}
              />
            )}
            <div className={css.dock} {...(doc === null ? {} : { style: { width: preference.width } })}>
              <TreeDock
                rootDir={rootDir}
                tree={tree}
                git={git}
                currentFile={doc?.path ?? null}
                connected={connected}
                send={send}
                {...(onReferenceFile !== undefined ? { onReferenceFile } : {})}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The dock's drag handle: pointer capture, rAF-throttled width reports against
 * the drag-start origin. The dock owns the frame's right edge, so the width
 * moves with the INVERSE of the pointer — dragging left widens it.
 */
function DockDivider({ width, onWidth }: { width: number; onWidth: (width: number) => void }): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null);
  const callbacks = useRef({ width, onWidth });
  callbacks.current = { width, onWidth };

  const endDrag = useCallback((): void => {
    const active = capture.current;
    if (active === null) return;
    capture.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    setDragging(false);
  }, []);
  useEffect(() => endDrag, [endDrag]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || capture.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    capture.current = { element: event.currentTarget, id: event.pointerId };
    origin.current = event.clientX;
    latest.current = event.clientX;
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (capture.current?.id !== event.pointerId) return;
    latest.current = event.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      const next = callbacks.current.width - (latest.current - origin.current);
      callbacks.current.onWidth(Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(next))));
    });
  }, []);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (capture.current?.id !== event.pointerId) return;
    endDrag();
  }, [endDrag]);

  return (
    <div
      className={cx(css.divider, dragging && css.dividerActive)}
      role="separator"
      aria-orientation="vertical"
      aria-label={RIGHTBAR_COPY['files.resizeTree']}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    />
  );
}
