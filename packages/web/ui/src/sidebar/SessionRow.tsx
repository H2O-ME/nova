/**
 * Session-list rows: one workspace header row and one session row.
 * Ported from deepseek-harness `ui-workspace/src/client/rows/Rows.tsx`
 * (`ProjectRowItem` / `SessionNodeItem`) + `Rows.module.css`
 * (c) 2026 DeepSeek — MIT License.
 *
 * Both are presentational: every fact arrives as a prop, and both are
 * `role=treeitem` elements inside the browser's `role=tree` list. The
 * reference's row menus (session rename/fork/archive, workspace
 * rename/delete), its hover cards, its drag wiring, and its status dots have
 * no data plane here and are not ported; the rows keep the reference's
 * keyboard-less markup plus a focus ring so a keyboard can still walk them.
 */
import { FolderClosedIcon, FolderOpenIcon, TriangleRightIcon } from '../icons.js';
import { stampLabel } from '../format.js';
import type { SessionListItem } from '../types.js';
import { cls, sessionTitle } from './view.js';
import css from './SessionRow.module.css';

/** One workspace (or the ungrouped bucket): 34px header row + its sessions. */
export function ProjectRow({
  label,
  path,
  expanded,
  containsCurrent,
  onToggle,
}: {
  label: string;
  /** Full workspace path for the row's tooltip; undefined for the bucket. */
  path: string | undefined;
  expanded: boolean;
  /** The open group holds the session the kernel is attached to. */
  containsCurrent: boolean;
  onToggle: () => void;
}): JSX.Element {
  const active = expanded && containsCurrent;
  return (
    <div
      className={css.projectRow}
      role="treeitem"
      aria-expanded={expanded}
      tabIndex={0}
      title={path}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onToggle();
      }}
    >
      {/* Folder by default, the expand arrow while the pointer is on the row. */}
      <span className={cls(css.slot, css.folder, active && css.folderActive)}>
        {expanded
          ? <FolderOpenIcon className={css.folderIcon} />
          : <FolderClosedIcon className={css.folderIcon} />}
      </span>
      <span className={cls(css.slot, css.chevron)}>
        <TriangleRightIcon className={cls(css.arrowIcon, css.arrow, expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
    </div>
  );
}

/** One 32px session row: status slot, title, and the right-hand stamp. */
export function SessionRow({
  item,
  selected,
  onOpen,
}: {
  item: SessionListItem;
  /** The log the kernel is attached to (row highlight, `aria-selected`). */
  selected: boolean;
  onOpen: () => void;
}): JSX.Element {
  const title = sessionTitle(item);
  return (
    <div
      className={cls(css.sessionRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      title={item.title.length > 0 ? item.title : item.file}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      {/* The status dot's 16px slot, empty: the reference's grouped tree always
          renders it, and this app's `sessions` frame carries no live state for
          a dot to read (no running/pending field per session). */}
      <span className={css.slot} aria-hidden="true" />
      <span className={css.title}>{title}</span>
      <span className={css.time}>{stampLabel(item.mtime)}</span>
    </div>
  );
}