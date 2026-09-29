/**
 * The workspace picker's directory browser.
 *
 * dsh gets a folder chooser from Electron (`ui-directory-picker-native`) and
 * falls back to an in-page browser (`ui-directory-picker-browse`). A browser
 * tab has neither: `showDirectoryPicker()` does exist on a loopback origin, but
 * the handle it resolves carries no path (no `File.path` off Electron), and a
 * workspace is adopted BY ABSOLUTE PATH — the kernel re-roots bash, search and
 * the fs tools at it. So this surface has exactly one route: ask the host to
 * enumerate a level and draw it.
 *
 * Shape follows the reference's browse occupant: a title, a breadcrumb chain
 * the user can click, a path-edit box, the level's OWN child directories (files
 * are not offered: the job is choosing a folder), and a "new folder"
 * affordance so a workspace can be created where none exists yet. Navigation is
 * by adoption, not by editing: a row selects it, Open enters the selection, and
 * the footer states where Open will land.
 *
 * Two affordances exist because the home subtree is not the whole filesystem:
 * a **roots row** (the host's drive list — without it a `D:` disk is
 * unreachable, since a drive letter is a dead end for `dirname` and home lives
 * on one drive only) and the reference's **path-edit box**, which is the
 * general escape for any location the chain cannot express.
 *
 * It is presentational. Every request goes out through `onList` / `onCreate`
 * and every answer comes back as state — the dialog owns no subscription, which
 * is what lets the whole flow be driven from a reducer.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import { ChevronRightIcon, FolderOpenIcon, PencilIcon } from '../icons.js';
import { FileTypeIcon } from '../composer/FileTypeIcon.js';
import type { WireDirectoryLevel } from '../types.js';
import css from './DirectoryBrowser.module.css';

export interface DirectoryBrowserProps {
  /** The level on screen, or null before the first answer lands. */
  level: WireDirectoryLevel | null;
  /** Why the last request failed, or null. */
  error: string | null;
  /** A request is in flight. */
  pending: boolean;
  /** Ask the host for one level (absent = the host's home directory). */
  onList: (dir?: string, files?: boolean) => void;
  /** Create one folder inside `dir` and move into it. */
  onCreate: (dir: string, name: string) => void;
  /** Adopt a directory as the session's workspace root. */
  onOpen: (dir: string) => void;
  /**
   * List files as well as folders, and make every row SELECT rather than
   * navigate — the attachment picker.
   *
   * The two jobs want opposite rows: a folder picker's rows are places to go, a
   * file picker's are things to take. Sharing the chrome is right (the host
   * enumeration is the same call); sharing the ROW BEHAVIOUR would make a file
   * row a dead end that navigates into nothing.
   */
  mode?: 'directory' | 'file';
  /** One picked file's absolute path (file mode only). */
  onPickFile?: (path: string, name: string) => void;
  /** Dismiss without picking. */
  onClose: () => void;
}

/** What the host's home directory is named in the breadcrumb chain. */
const HOME_LABEL = '主目录';

/** What the footer's Open button will adopt, and how to word it. */
function openTarget(level: WireDirectoryLevel | null): string | null {
  if (level === null) return null;
  // Open adopts the level itself: the rows navigate, they do not select a
  // pending target. That is the reference's rule ("falling back to the listed
  // level") and it is also the only wording a one-line footer can state.
  return level.path;
}

/**
 * The platform's separator, read off the host's own home path.
 *
 * The browser must not guess: on Windows `/` and `\` both separate, while on
 * POSIX a backslash is a legal character in a name. The host already stamps
 * `home`, so that path — not typed text, not an entry's path — is the one place
 * the fact is trustworthy.
 */
function separatorOf(level: WireDirectoryLevel | null): string {
  return level !== null && level.home.includes('\\') ? '\\' : '/';
}

export function DirectoryBrowser({
  level,
  error,
  pending,
  onList,
  onCreate,
  onOpen,
  mode = 'directory',
  onPickFile,
  onClose,
}: DirectoryBrowserProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalLayer(panelRef, true, onClose);
  return createPortal(
    <DirectoryBrowserDialog
      level={level}
      error={error}
      pending={pending}
      onList={onList}
      onCreate={onCreate}
      onOpen={onOpen}
      mode={mode}
      {...(onPickFile !== undefined ? { onPickFile } : {})}
      onClose={onClose}
      panelRef={panelRef}
    />,
    document.body,
  );
}

/** The dialog's ref seat, supplied by the portaled wrapper (absent in the static lane). */
export interface DirectoryBrowserDialogProps extends DirectoryBrowserProps {
  /** The panel element, for the modal layer's focus and Escape ownership. */
  panelRef?: MutableRefObject<HTMLDivElement | null> | undefined;
}

/**
 * The dialog markup, portal-free so the static lane can walk it without a
 * document.
 * @param props - see {@link DirectoryBrowserDialogProps}.
 * @returns the dialog element tree.
 */
export function DirectoryBrowserDialog({
  level,
  error,
  pending,
  onList,
  onCreate,
  onOpen,
  mode = 'directory',
  onPickFile,
  onClose,
  panelRef,
}: DirectoryBrowserDialogProps): JSX.Element {
  const titleId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const pickingFiles = mode === 'file';

  // The first answer is the dialog's opening move: nothing has been asked for
  // until it mounts, so asking here (not in the caller) keeps every other
  // caller from having to remember the order.
  useEffect(() => {
    if (level === null && !pending && error === null) onList(undefined, pickingFiles);
  }, [level, pending, error, onList, pickingFiles]);

  const target = openTarget(level);
  const submitDraft = (base: string): void => {
    const name = (draft ?? '').trim();
    setDraft(null);
    if (name !== '') onCreate(base, name);
  };
  const submitPath = (): void => {
    const typed = (pathDraft ?? '').trim();
    setPathDraft(null);
    // A blank submission is a cancel, not a request for the home directory:
    // `onList()` with no argument would silently jump the user home.
    if (typed !== '') onList(typed);
  };

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={css.header}>
          {/* The title names the JOB, not the widget: the same enumeration
              serves "adopt this folder as the workspace" and "name this file as
              an `@` reference", and those two want different things from a row
              (a place to go vs. a thing to take). A single title told the reader
              nothing about which one they were in. */}
          <div className={css.title} id={titleId}>
            {pickingFiles ? '选择要引用的文件' : '选择工作区文件夹'}
          </div>
          {/* Reading a slow level is stated in words, not a spinner: this icon
              set has no spinner, and a status line is what the rest of this
              surface uses for the same fact. */}
          {pending && <span className={css.status} role="status">正在读取…</span>}
        </div>

        {/* Breadcrumbs: the chain the host reported. Inside the home subtree it
            starts at Home (a chain from the drive root is several useless
            clicks), which is the trimming the host already did. The pencil at
            the right edge opens the path box — the reference's `.crumbEditZone`
            — which is how a location outside that subtree is reached at all. */}
        <nav className={css.crumbs} aria-label="路径">
          {pathDraft !== null ? (
            <input
              className={css.pathInput}
              value={pathDraft}
              autoFocus
              aria-label="输入文件夹路径"
              placeholder="输入绝对路径，例如 D:\\code"
              /* Claims Escape while focused (and the handler below acts on it). */
              data-modal-escape-owner
              onChange={(e) => { setPathDraft(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitPath(); }
                // Escape inside a text field belongs to the field (the shell's
                // standing rule), so it closes the box, not the dialog.
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPathDraft(null); }
              }}
            />
          ) : (
            <>
              {(level?.crumbs ?? []).map((crumb, index, all) => (
                <span className={css.crumbSeg} key={crumb.path}>
                  <button
                    type="button"
                    className={index === all.length - 1 ? `${css.crumb} ${css.crumbCurrent}` : css.crumb}
                    aria-current={index === all.length - 1 ? 'true' : undefined}
                    title={crumb.path}
                    onClick={() => { onList(crumb.path); }}
                  >
                    {/* The home directory is named, not spelled: its own basename is
                        the account name, which reads as a folder like any other. */}
                    {crumb.path === level?.home ? HOME_LABEL : (crumb.name === '' ? crumb.path : crumb.name)}
                  </button>
                  {index < all.length - 1 && (
                    <span className={css.crumbSep} aria-hidden="true"><ChevronRightIcon /></span>
                  )}
                </span>
              ))}
              <button
                type="button"
                className={css.crumbEdit}
                aria-label="输入文件夹路径"
                title="输入文件夹路径"
                onClick={() => {
                  // Seeded with the level on screen so typing continues into a
                  // child name; nothing to seed from when no level landed yet
                  // (the box is also the recovery path for a failed listing).
                  setPathDraft(level === null ? '' : level.path + separatorOf(level));
                }}
              >
                {/* The zone fills the bar's remainder rather than hugging the
                    glyph: dsh's `.crumbEditZone` makes the whole empty stretch
                    the way into typing a path, and a reader who has to find a
                    14px pencil at the right edge is the confusion this fixes. */}
                <PencilIcon />
              </button>
            </>
          )}
        </nav>

        {/* The host's volumes. On Windows this is the only way off the drive
            the home directory sits on — the crumb chain can never contain
            another one. On POSIX it collapses to the single `/`. The label is
            visible, not only the group's accessible name: a bare run of `C:\`
            `D:\` chips gives a reader no way to know these are disks rather
            than folders in the level below. */}
        {(level?.roots.length ?? 0) > 0 && (
          <div className={css.rootsRow}>
            <span className={css.rootsLabel}>磁盘</span>
            <div className={css.roots} role="group" aria-label="磁盘">
              {level?.roots.map((root) => (
                <button
                  key={root.path}
                  type="button"
                  className={css.root}
                  title={root.path}
                  aria-current={level.path === root.path ? 'true' : undefined}
                  onClick={() => { onList(root.path); }}
                >
                  {root.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {error !== null && <div className={css.error} role="alert">{error}</div>}

        <div className={css.body}>
          {/* File mode changes what every row DOES, so the rule is stated once
              above the rows rather than only in the footer: a file row selects
              instead of navigating, and a reader who only sees the rows has no
              way to tell that from a folder picker that looks identical. */}
          {pickingFiles && (
            <div className={css.modeNote}>点一行文件即可引用（不会复制）；点文件夹进入下一级。</div>
          )}
          {level === null ? (
            // Nothing has been listed, so there is no folder to describe. Two
            // facts land here and they are not the same one: a request still in
            // flight, and a request that failed with no earlier level to fall
            // back on (the error's own line above carries the reason). Neither
            // is "this folder is empty" — saying that would attribute the
            // failure to the folder.
            <div className={css.empty} data-body-state={pending ? 'loading' : 'unavailable'}>
              {pending ? '正在读取…' : '没有列出任何内容，可在上方输入绝对路径。'}
            </div>
          ) : (
            <>
              {level.parent !== undefined && (
                <button
                  type="button"
                  className={css.row}
                  data-modal-autofocus=""
                  onClick={() => { onList(level.parent, pickingFiles); }}
                >
                  <span className={css.rowIcon} aria-hidden="true"><FolderOpenIcon /></span>
                  <span className={css.rowLabel}>..</span>
                </button>
              )}
              {/* The level listed fine and holds nothing. This is a real answer
                  about the folder, so it is stated as one — and it is stated
                  whether or not a `..` row precedes it: an empty subfolder used
                  to render that lone row with no explanation, which reads as a
                  still-loading list. The name of the thing follows the mode:
                  file mode lists files too, so calling them all "subfolders"
                  would be a false report about what was enumerated. */}
              {level.entries.length === 0 && (
                <div className={css.empty} data-body-state="empty">
                  {pickingFiles ? '这个文件夹里没有文件。' : '这个文件夹没有子文件夹。'}
                </div>
              )}
              {level.entries.map((entry) => {
                // In file mode a file row is a thing to TAKE, not a place to go:
                // navigating into it would be a dead end, so it selects instead.
                // A row with no `kind` is a directory (the host omits the field
                // in a folder-only listing), so the two modes cannot disagree.
                const isFile = entry.kind === 'file';
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={css.row}
                    onClick={() => {
                      if (isFile && pickingFiles) onPickFile?.(entry.path, entry.name);
                      else onList(entry.path, pickingFiles);
                    }}
                  >
                    <span className={css.rowIcon} aria-hidden="true">
                      {isFile ? <FileTypeIcon path={entry.path} /> : <FolderOpenIcon />}
                    </span>
                    <span className={css.rowLabel}>{entry.name}</span>
                  </button>
                );
              })}
              {/* Truncation is stated, not silent: "没有更多" and "没查完" are
                  two different facts, and a cut level that looked complete
                  would send the reader away from entries that do exist. */}
              {level.truncated && (
                <div className={css.note}>
                  仅显示前 {level.entries.length} 个{pickingFiles ? '条目' : '文件夹'}。
                </div>
              )}
            </>
          )}
        </div>

        {draft !== null && level !== null && (
          <div className={css.draftRow}>
            <input
              className={css.draftInput}
              value={draft}
              autoFocus
              placeholder="新文件夹名称"
              aria-label="新文件夹名称"
              /* Claims Escape while focused (and the handler below acts on it). */
              data-modal-escape-owner
              onChange={(e) => { setDraft(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitDraft(level.path); }
                // Escape inside a text field belongs to the field (the shell's
                // standing rule), so it closes the draft, not the dialog.
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); }
              }}
            />
            <button type="button" className={css.draftConfirm} onClick={() => { submitDraft(level.path); }}>
              创建
            </button>
          </div>
        )}

        <div className={css.footer}>
          {/* The target is stated, not implied: the button adopts the level on
              screen, and a user who navigated three levels deep deserves to see
              which one that is before clicking. File mode has no Open button —
              every row is the selection — so the seat names the folder being
              browsed instead; the rule itself is stated above the rows, where
              the reader meets it before the first file. */}
          <div className={css.target} title={pickingFiles ? (level?.path ?? undefined) : (target ?? undefined)}>
            {pickingFiles ? (level?.path ?? '') : (target ?? '')}
          </div>
          <div className={css.actions}>
            {/* No folder creation while picking files: the row that matters is a
                file, and a stray new folder in the tree is not what was asked
                for. */}
            {!pickingFiles && (
              <button
                type="button"
                className={css.secondary}
                disabled={level === null || pending}
                onClick={() => { setDraft(''); }}
              >
                新建文件夹
              </button>
            )}
            <button type="button" className={css.secondary} onClick={onClose}>取消</button>
            {!pickingFiles && (
              <button
                type="button"
                className={css.primary}
                disabled={target === null || pending}
                onClick={() => { if (target !== null) onOpen(target); }}
              >
                打开
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
