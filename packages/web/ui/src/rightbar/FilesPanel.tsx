/**
 * The 文件 tab's body: the workspace tree, and the session logs beside it.
 *
 * Ported in shape from deepseek-harness `ui-sidebar-files` (MIT): the root's
 * absolute path heads the tree, a directory row toggles expansion (its children
 * are listed on first open), files come after directories, and a level the host
 * truncated says so instead of looking complete. The panel adds the second
 * section the harness keeps in its own session browser — the session logs — so
 * the tab answers the whole question "what files belong to this work": the
 * workspace the session runs in, and the logs of the session itself.
 *
 * Two deliberate absences, both because there is nothing behind them here:
 *   - **No file preview.** The harness opens a file into a preview tab; this
 *     build has no document previewer, so a file row offers the one thing it can
 *     actually do — put the path on the clipboard (the composer takes `@path`).
 *     A row that opened an empty pane would be worse than a row that says what
 *     it does.
 *   - **No auto-refresh watcher.** The workspace is re-read when asked, not
 *     watched: the host exposes no directory watch, and a polling tree would
 *     spend the socket on a panel nobody is looking at.
 */
import { useEffect, useState } from 'react';
import { writeClipboard } from '../clipboard.js';
import { FolderClosedIcon, FolderOpenIcon, RefreshIcon } from '../icons.js';
import type { ClientFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import { needsListing, sessionFileRows, toggleExpanded, treeRows, type TreeState } from './files-model.js';
import type { SessionListItem } from '../types.js';
import css from './RightbarPanel.module.css';

export interface FilesPanelProps {
  /** The workspace root; '' when the session has none. */
  rootDir: string;
  tree: TreeState;
  sessions: readonly SessionListItem[] | null;
  /** The log the kernel is attached to (the highlighted session row). */
  currentFile: string;
  send: (frame: ClientFrame) => void;
}

export function FilesPanel({ rootDir, tree, sessions, currentFile, send }: FilesPanelProps): JSX.Element {
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const now = Date.now();

  // Opening the tab reads the root; a reconnect (which drops the levels with the
  // baseline) reads it again, and so does every level the reader had expanded —
  // otherwise a reattached panel would draw an expanded directory with no
  // children and no way to tell that from an empty one. A level already asked
  // for is held as `loading`, so this cannot ask twice for the same one.
  useEffect(() => {
    if (rootDir.length === 0) return;
    for (const path of [rootDir, ...expanded]) {
      if (needsListing(tree, path)) send({ type: 'list_directory', dir: path, files: true });
    }
  }, [rootDir, expanded, tree, send]);
  /** Open a directory: ask the host the first time, then just fold. */
  const openDirectory = (path: string): void => {
    const opening = !expanded.includes(path);
    setExpanded(toggleExpanded(expanded, path));
    if (opening && needsListing(tree, path)) {
      send({ type: 'list_directory', dir: path, files: true });
    }
  };
  // The refresh control re-reads what is on screen — the root and every opened
  // level — rather than only the root: a tree whose branches are a session old is
  // exactly what the control is for.
  const reload = (): void => {
    for (const path of [rootDir, ...expanded]) {
      if (path.length > 0) send({ type: 'list_directory', dir: path, files: true });
    }
  };
  const copyPath = (path: string): void => {
    void writeClipboard(path).then((ok) => { setCopied(ok ? path : null); });
  };

  const rows = rootDir.length > 0 ? treeRows(tree, rootDir, expanded) : [];
  const sessionRows = sessionFileRows(sessions, currentFile, now);

  return (
    <div className={css.files}>
      <section className={css.section}>
        <header className={css.sectionHead}>
          <span className={css.sectionLabel}>{RIGHTBAR_COPY['files.workspace']}</span>
          <button
            type="button"
            className={css.iconButton}
            aria-label={RIGHTBAR_COPY['files.reload']}
            title={RIGHTBAR_COPY['files.reload']}
            onClick={reload}
          >
            <RefreshIcon />
          </button>
        </header>
        <p className={css.pathLine} title={rootDir}>
          {rootDir.length > 0 ? rootDir : RIGHTBAR_COPY['files.noWorkspace']}
        </p>
        {rootDir.length > 0 && (
          <ul className={css.tree} aria-label={RIGHTBAR_COPY['files.workspace']}>
            {rows.map((row, index) => (
              // Rows are positional: the same path can appear twice only if the
              // expansion set is inconsistent, and a keyed list would then throw
              // instead of drawing what the reader asked for.
              <li
                key={index}
                className={css.treeRow}
                data-depth={row.depth}
                data-kind={row.kind}
                style={{ paddingLeft: row.depth * 12 }}
              >
                {row.kind === 'note' ? (
                  <span className={css.treeNote} data-tone={row.tone}>{row.text}</span>
                ) : (
                  <button
                    type="button"
                    className={css.treeButton}
                    title={row.entry.path}
                    aria-expanded={row.entry.kind === 'file' ? undefined : row.expanded}
                    data-current={row.entry.kind === 'file' && copied === row.entry.path ? '' : undefined}
                    onClick={() => {
                      if (row.entry.kind === 'file') copyPath(row.entry.path);
                      else openDirectory(row.entry.path);
                    }}
                  >
                    {row.entry.kind === 'file' ? null : row.expanded
                      ? <FolderOpenIcon className={css.treeIcon} />
                      : <FolderClosedIcon className={css.treeIcon} />}
                    <span className={css.treeName}>{row.entry.name}</span>
                    {copied === row.entry.path && (
                      <span className={css.treeHint}>{RIGHTBAR_COPY['files.copied']}</span>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={css.section}>
        <header className={css.sectionHead}>
          <span className={css.sectionLabel}>{RIGHTBAR_COPY['files.sessions']}</span>
        </header>
        {sessionRows.length === 0 ? (
          <p className={css.emptyNote}>{RIGHTBAR_COPY['files.sessions.empty']}</p>
        ) : (
          <ul className={css.tree} aria-label={RIGHTBAR_COPY['files.sessions']}>
            {sessionRows.map((row) => (
              <li key={row.file} className={css.treeRow}>
                <button
                  type="button"
                  className={css.sessionRow}
                  aria-current={row.current ? 'true' : undefined}
                  title={row.file}
                  onClick={() => { if (!row.current) send({ type: 'resume', file: row.file }); }}
                >
                  <span className={css.treeName}>{row.title}</span>
                  {row.current && <span className={css.treeHint}>{RIGHTBAR_COPY['files.sessions.current']}</span>}
                  <span className={css.sessionStamp}>{row.stamp}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
