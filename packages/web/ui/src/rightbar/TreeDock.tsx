/**
 * The docked workspace tree: search, rows, git ink, and the verbs.
 *
 * The rows are a fold over what the host has answered (`files-model.ts`) plus
 * the reader's expansion set — the browser cannot read a directory, so the tree
 * is exactly the levels that have been asked for. Row geometry and the selection
 * marker are the reference's (`dsh-better-sidebar` `FileTree.tsx`, MIT): 28px
 * rows, 22px per depth, the accent bar inset on the left of a selected row, and
 * a hover-revealed `@` pill at the row's right edge.
 *
 * Git ink comes from the SAME status answer the 变更 page draws (`git-marks.ts`
 * over the reducer's `git` slice), so the tree and that page cannot disagree
 * about whether a file is modified.
 *
 * The verbs are one menu per row (open / reference / copy / rename / reveal /
 * delete, plus the two create verbs on a directory) and one inline input at a
 * time — the reference's own shape, where a rename or a new entry is typed in
 * place rather than in a modal.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { MenuItem } from '../shell/Menu.js';
import { Menu } from '../shell/Menu.js';
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderClosedIcon, FolderOpenIcon, RefreshIcon } from '../icons.js';
import { MoreGlyph } from './panel-icons.js';
import type { ClientFrame } from '../types.js';
import type { GitState } from '../state.js';
import { baseName, parentDir } from './file-refs.js';
import { dirHasChanges, gitMarks, markFor, type GitMark } from './git-marks.js';
import {
  entryPaths, filterRows, needsListing, toggleExpanded, treeRows, type TreeRow, type TreeState,
} from './files-model.js';
import { RIGHTBAR_COPY } from './copy.js';
import { IconButton, Notice, StatusBadge, type StatusTone } from './kit.js';
import { clickSelection, emptySelection, isPicked, pruneSelection, selectionText, type TreeSelection } from './tree-selection.js';
import { cx } from '../composer/cx.js';
import css from './TreeDock.module.css';

/** One name being typed in place (a rename, or a new entry inside a directory). */
export interface InlineEdit {
  kind: 'rename' | 'new';
  /** rename: the row's path. new: the directory the entry is created in. */
  path: string;
  value: string;
  /** The create verb being typed (`new` only). */
  entry?: 'file' | 'dir';
}

/** The row a menu was opened from. */
interface MenuTarget {
  path: string;
  kind: 'file' | 'dir';
}

export interface TreeDockProps {
  /** The workspace root (the tree's only root — the session's own workspace). */
  rootDir: string;
  tree: TreeState;
  git: GitState | null;
  /** The document on screen (the row that reads as current). */
  currentFile: string | null;
  connected: boolean;
  send: (frame: ClientFrame) => void;
  onReferenceFile?: ((path: string) => void) | undefined;
}

export function TreeDock({
  rootDir,
  tree,
  git,
  currentFile,
  connected,
  send,
  onReferenceFile,
}: TreeDockProps): JSX.Element {
  const [expanded, setExpanded] = useState<readonly string[]>(() => (rootDir === '' ? [] : [rootDir]));
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<TreeSelection>(emptySelection);
  const [edit, setEdit] = useState<InlineEdit | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // A new root is a new tree: the previous expansion set names paths that are not
  // there any more, and keeping it would draw another workspace's tree.
  useEffect(() => {
    setExpanded(rootDir === '' ? [] : [rootDir]);
    setSelection(emptySelection);
    setEdit(null);
    setMenu(null);
  }, [rootDir]);

  // The git answer belongs to a workspace; decorations from another one would
  // color this tree's rows with another repo's status.
  const marks = useMemo(() => gitMarks(git !== null && git.root === rootDir ? git : null), [git, rootDir]);
  const open = useMemo(() => new Set(expanded), [expanded]);
  const rows = useMemo(() => treeRows(tree, rootDir, expanded), [tree, rootDir, expanded]);
  // Dot-led entries are the tree's own hidden files: listed by the host, shown
  // when the reader asks for them (a query that starts with a dot) — the same
  // rule the `@` menu uses, so one habit serves both.
  const showHidden = query.startsWith('.');
  const visible = useMemo(
    () => filterRows(rows, query).filter((row) => row.kind !== 'entry' || !row.entry.hidden || showHidden),
    [rows, query, showHidden],
  );
  const paths = useMemo(() => entryPaths(visible), [visible]);
  // A pick must describe rows the reader can still act on: a collapsed branch or
  // a filtered-out row leaves it here rather than at the batch bar.
  const picked = pruneSelection(selection, paths);

  const ask = (path: string): void => {
    if (path.length === 0 || !connected) return;
    send({ type: 'list_directory', dir: path, files: true });
  };

  const toggle = (path: string): void => {
    const opening = !open.has(path);
    setExpanded((current) => toggleExpanded(current, path));
    if (opening && needsListing(tree, path)) ask(path);
  };

  const openFile = (path: string): void => { send({ type: 'read_entry', path }); };

  const beginNew = (dir: string, entry: 'file' | 'dir'): void => {
    if (!open.has(dir)) { setExpanded((current) => toggleExpanded(current, dir)); ask(dir); }
    setEdit({ kind: 'new', path: dir, value: '', entry });
  };

  const submitEdit = (): void => {
    if (edit === null) return;
    const value = edit.value.trim();
    setEdit(null);
    if (value.length === 0) return;
    if (edit.kind === 'rename') {
      if (value === baseName(edit.path)) return;
      send({ type: 'rename_entry', path: edit.path, to: `${parentDir(edit.path)}/${value}` });
      return;
    }
    send({ type: 'new_entry', dir: edit.path, name: value, kind: edit.entry === 'dir' ? 'dir' : 'file' });
  };

  const runMenu = (id: string, target: MenuTarget): void => {
    setMenu(null);
    switch (id) {
      case 'open':
        openFile(target.path);
        break;
      case 'reference':
        onReferenceFile?.(target.path);
        break;
      case 'copyPath':
        copyText(target.path, target.path);
        break;
      case 'rename':
        setEdit({ kind: 'rename', path: target.path, value: baseName(target.path) });
        break;
      case 'newFile':
        beginNew(target.kind === 'dir' ? target.path : parentDir(target.path), 'file');
        break;
      case 'newFolder':
        beginNew(target.kind === 'dir' ? target.path : parentDir(target.path), 'dir');
        break;
      case 'reveal':
        send({ type: 'open_entry', path: target.path });
        break;
      case 'delete':
        if (!window.confirm(RIGHTBAR_COPY['files.delete.confirm'].replace('{name}', baseName(target.path)))) break;
        send({ type: 'remove_entry', path: target.path });
        break;
      default:
        break;
    }
  };

  const copyText = (text: string, key: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => { setCopied((current) => (current === key ? null : current)); }, 1200);
    }).catch(() => { setCopied(null); });
  };

  return (
    <div className={css.dock} data-tree-dock="">
      <div className={css.searchRow}>
        <input
          type="text"
          className={css.search}
          value={query}
          placeholder={RIGHTBAR_COPY['files.search.placeholder']}
          aria-label={RIGHTBAR_COPY['files.search.label']}
          spellCheck={false}
          onChange={(event) => { setQuery(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '') { event.stopPropagation(); setQuery(''); }
          }}
        />
        <IconButton
          label={RIGHTBAR_COPY['files.reload']}
          size="sm"
          disabled={!connected || rootDir === ''}
          onClick={() => { ask(rootDir); }}
        >
          <RefreshIcon />
        </IconButton>
      </div>
      <div className={css.rows} role="tree" aria-label={RIGHTBAR_COPY['files.workspace']}>
        {rootDir === '' ? <Notice kind="empty">{RIGHTBAR_COPY['files.noWorkspace']}</Notice> : (
          <>
            {/* The root row is the reference's path-less home: the session's own
                workspace, always present, and the one place a reader can put
                every branch away at once. */}
            <div className={css.rootRow}>
              <button
                type="button"
                className={css.rootPick}
                aria-expanded={open.has(rootDir)}
                title={rootDir}
                onClick={() => { toggle(rootDir); }}
              >
                <span className={css.chevron} data-open={open.has(rootDir) ? '' : undefined}>
                  {open.has(rootDir) ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </span>
                <span className={cx(css.rowIcon, css.rowIconDir)}>
                  {open.has(rootDir) ? <FolderOpenIcon /> : <FolderClosedIcon />}
                </span>
                <span className={css.rootName}>{baseName(rootDir)}</span>
              </button>
            </div>
            {visible.map((row) => {
              const key = row.kind === 'entry' ? row.entry.path : `note:${String(row.depth)}:${row.text}`;
              const dir = row.kind === 'entry' ? row.entry.path : '';
              const renaming = edit?.kind === 'rename' && dir === edit.path;
              const creating = edit?.kind === 'new' && dir === edit.path;
              return (
                <Fragment key={key}>
                  <TreeRow
                    row={row}
                    current={currentFile}
                    mark={row.kind === 'entry' ? markFor(marks, rootDir, row.entry.path) : undefined}
                    dirChanged={row.kind === 'entry' && row.entry.kind === 'dir' ? dirHasChanges(marks, rootDir, row.entry.path) : false}
                    picked={row.kind === 'entry' && isPicked(picked, row.entry.path)}
                    reference={onReferenceFile}
                    copied={copied}
                    renaming={renaming}
                    editValue={renaming ? edit.value : ''}
                    menuOpen={menu !== null && menu.path === dir}
                    onPick={(event) => {
                      if (row.kind !== 'entry') return;
                      const mods = { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
                      setSelection(clickSelection(selection, paths, row.entry.path, mods));
                      if (mods.ctrl || mods.shift) return;
                      if (row.entry.kind === 'dir') toggle(row.entry.path);
                      else openFile(row.entry.path);
                    }}
                    onReference={() => { if (row.kind === 'entry') onReferenceFile?.(row.entry.path); }}
                    onCopy={() => { if (row.kind === 'entry') copyText(row.entry.path, row.entry.path); }}
                    onMenuOpen={() => { if (row.kind === 'entry') setMenu({ path: row.entry.path, kind: row.entry.kind === 'dir' ? 'dir' : 'file' }); }}
                    onMenuClose={() => { setMenu(null); }}
                    onMenuSelect={(id) => { if (row.kind === 'entry') runMenu(id, { path: row.entry.path, kind: row.entry.kind === 'dir' ? 'dir' : 'file' }); }}
                    onEditChange={(value) => { setEdit((current) => (current === null ? current : { ...current, value })); }}
                    onSubmitEdit={submitEdit}
                    onCancelEdit={() => { setEdit(null); }}
                  />
                  {creating && edit !== null && (
                    <InlineRow
                      depth={(row.kind === 'entry' ? row.depth : 0) + 1}
                      value={edit.value}
                      label={edit.entry === 'dir' ? RIGHTBAR_COPY['files.newFolder'] : RIGHTBAR_COPY['files.newFile']}
                      onChange={(value) => { setEdit((current) => (current === null ? current : { ...current, value })); }}
                      onSubmit={submitEdit}
                      onCancel={() => { setEdit(null); }}
                    />
                  )}
                </Fragment>
              );
            })}
          </>
        )}
        {query !== '' && visible.length === 0 && <Notice kind="hint">{RIGHTBAR_COPY['files.search.empty']}</Notice>}
      </div>
      {picked.paths.length > 0 && (
        <div className={css.batchBar}>
          <span className={css.batchCount}>
            {RIGHTBAR_COPY['files.selected'].replace('{count}', String(picked.paths.length))}
          </span>
          <button type="button" className={css.batchVerb} onClick={() => { copyText(selectionText(picked), 'batch'); }}>
            {copied === 'batch' ? RIGHTBAR_COPY['files.copied'] : RIGHTBAR_COPY['files.copyPath']}
          </button>
          <button
            type="button"
            className={css.batchVerb}
            onClick={() => {
              const count = picked.paths.length;
              if (!window.confirm(RIGHTBAR_COPY['files.deleteSelected.confirm'].replace('{count}', String(count)))) return;
              for (const path of picked.paths) send({ type: 'remove_entry', path });
              setSelection(emptySelection);
            }}
          >
            {RIGHTBAR_COPY['files.deleteSelected']}
          </button>
          <button type="button" className={css.batchVerb} onClick={() => { setSelection(emptySelection); }}>
            {RIGHTBAR_COPY['files.clearSelection']}
          </button>
        </div>
      )}
    </div>
  );
}

/** The editing row: one input, Enter to commit, Escape to abandon. */
function InlineRow({
  depth,
  value,
  label,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number;
  value: string;
  label: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div className={css.rowEdit}>
      <input
        // Focus on mount: the reader just asked to name something, so the
        // keyboard belongs in the box (a menu pick cannot carry focus itself).
        autoFocus
        type="text"
        className={css.inlineInput}
        style={{ marginLeft: depth * 22 + 22 }}
        value={value}
        spellCheck={false}
        placeholder={RIGHTBAR_COPY['files.name.placeholder']}
        aria-label={label}
        onChange={(event) => { onChange(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onSubmit(); }
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
        }}
        onBlur={onCancel}
      />
    </div>
  );
}

interface TreeRowProps {
  row: TreeRow;
  current: string | null;
  mark: GitMark | undefined;
  dirChanged: boolean;
  picked: boolean;
  reference: ((path: string) => void) | undefined;
  copied: string | null;
  renaming: boolean;
  editValue: string;
  menuOpen: boolean;
  /** Mouse or keyboard on the row: the modifiers are all the pick reads. */
  onPick: (event: { readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean }) => void;
  onReference: () => void;
  onCopy: () => void;
  onMenuOpen: () => void;
  onMenuClose: () => void;
  onMenuSelect: (id: string) => void;
  onEditChange: (value: string) => void;
  onSubmitEdit: () => void;
  onCancelEdit: () => void;
}

/** One row of the tree: a directory, a file, or a level's own note. */
function TreeRow({
  row,
  current,
  mark,
  dirChanged,
  picked,
  reference,
  copied,
  renaming,
  editValue,
  menuOpen,
  onPick,
  onReference,
  onCopy,
  onMenuOpen,
  onMenuClose,
  onMenuSelect,
  onEditChange,
  onSubmitEdit,
  onCancelEdit,
}: TreeRowProps): JSX.Element {
  if (row.kind === 'note') {
    return (
      <div className={css.note} style={{ paddingLeft: row.depth * 22 + 26 }} data-tone={row.tone}>
        {row.text}
      </div>
    );
  }
  const entry = row.entry;
  const isDir = entry.kind !== 'file';
  if (renaming) {
    return (
      <InlineRow
        depth={row.depth}
        value={editValue}
        label={RIGHTBAR_COPY['files.rename']}
        onChange={onEditChange}
        onSubmit={onSubmitEdit}
        onCancel={onCancelEdit}
      />
    );
  }
  const items: MenuItem[] = isDir
    ? [
      { id: 'newFile', label: RIGHTBAR_COPY['files.newFile'] },
      { id: 'newFolder', label: RIGHTBAR_COPY['files.newFolder'] },
      { id: 'copyPath', label: RIGHTBAR_COPY['files.copyPath'] },
      { id: 'rename', label: RIGHTBAR_COPY['files.rename'] },
      { id: 'reveal', label: RIGHTBAR_COPY['files.reveal'] },
      { id: 'delete', label: RIGHTBAR_COPY['files.delete'] },
    ]
    : [
      { id: 'open', label: RIGHTBAR_COPY['files.open'] },
      ...(reference !== undefined ? [{ id: 'reference', label: RIGHTBAR_COPY['files.reference'] }] : []),
      { id: 'copyPath', label: RIGHTBAR_COPY['files.copyPath'] },
      { id: 'rename', label: RIGHTBAR_COPY['files.rename'] },
      { id: 'reveal', label: RIGHTBAR_COPY['files.reveal'] },
      { id: 'delete', label: RIGHTBAR_COPY['files.delete'] },
    ];
  // The row is ONE clickable surface (the reference's `explorerRow`): the name
  // owns the row's whole width at rest, and every verb sits behind it, revealed
  // only when the pointer or the keyboard is on the row. With the verbs always
  // in the layout, a dock at its 160px floor leaves the name one character wide
  // — the exact reading the user reported.
  return (
    <div
      className={css.row}
      role="button"
      tabIndex={0}
      style={{ paddingLeft: row.depth * 22 + 6 }}
      title={entry.path}
      aria-expanded={isDir ? row.expanded : undefined}
      data-picked={picked ? '' : undefined}
      data-current={entry.path === current ? '' : undefined}
      onClick={onPick}
      onKeyDown={(event) => {
        // Only the row's own keys: Enter on a focused verb is that verb's.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(event);
        }
      }}
    >
      <span className={css.chevron} data-open={isDir && row.expanded ? '' : undefined} data-leaf={isDir ? undefined : ''}>
        {isDir ? (row.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : null}
      </span>
      <span className={cx(css.rowIcon, isDir && css.rowIconDir)}>
        {isDir ? (row.expanded ? <FolderOpenIcon /> : <FolderClosedIcon />) : <FileIcon />}
      </span>
      <span
        className={css.rowName}
        data-git-tone={mark?.tone}
        data-dir-changed={dirChanged ? '' : undefined}
      >
        {entry.name}
      </span>
      {entry.hidden && <span className={css.hiddenMark}>{RIGHTBAR_COPY['files.hidden']}</span>}
      {mark !== undefined && <StatusBadge tone={toneOf(mark.tone)}>{mark.letter}</StatusBadge>}
      <span className={css.rowRail} data-open={menuOpen ? '' : undefined}>
        {reference !== undefined && !isDir && (
          <button
            type="button"
            className={css.refPill}
            aria-label={RIGHTBAR_COPY['files.reference']}
            title={RIGHTBAR_COPY['files.reference']}
            onClick={(event) => { event.stopPropagation(); onReference(); }}
          >
            @
          </button>
        )}
        <button
          type="button"
          className={css.copyPill}
          aria-label={RIGHTBAR_COPY['files.copyPath']}
          title={RIGHTBAR_COPY['files.copyPath']}
          onClick={(event) => { event.stopPropagation(); onCopy(); }}
        >
          {copied === entry.path ? RIGHTBAR_COPY['files.copied'] : RIGHTBAR_COPY['files.copyPath']}
        </button>
        <Menu
          open={menuOpen}
          label={RIGHTBAR_COPY['files.menu']}
          items={items}
          onSelect={onMenuSelect}
          onClose={onMenuClose}
          side="below"
          align="end"
          anchor={(
            <IconButton label={RIGHTBAR_COPY['files.menu']} size="sm" onClick={onMenuOpen}>
              <MoreGlyph />
            </IconButton>
          )}
        />
      </span>
    </div>
  );
}

/** The badge tone for a git letter (the reference's `StatusBadge` map). */
function toneOf(tone: GitMark['tone']): StatusTone {
  if (tone === 'changed') return 'modified';
  if (tone === 'untracked') return 'added';
  if (tone === 'conflict') return 'deleted';
  return 'renamed';
}
