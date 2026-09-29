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
 * The title marquee and the relative trailing stamp ARE ported: both are
 * readable from the list this host already sends (`title`, `mtime`).
 */
import { useRef } from 'react';
import { FolderClosedIcon, FolderOpenIcon, TrashIcon, TriangleRightIcon } from '../icons.js';
import type { SessionListItem } from '../types.js';
import { cls, sessionTitle } from './view.js';
import { relativeStamp } from './relative-time.js';
import { useTitleMarquee } from './use-title-marquee.js';
import css from './SessionRow.module.css';

/** One workspace (or the ungrouped bucket): 34px header row + its sessions. */
export function ProjectRow({
  label,
  path,
  rowKey,
  expanded,
  containsCurrent,
  onToggle,
}: {
  label: string;
  /** Full workspace path for the row's tooltip; undefined for the bucket. */
  path: string | undefined;
  /** Stable identity for the row animation (see `AnimatedRows`). */
  rowKey: string;
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
      // The FLIP overlay's identity for this row: `AnimatedRows` reads these in
      // DOM order to decide what moved, entered, or left.
      data-row-key={rowKey}
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
  now,
  onOpen,
  onDelete,
}: {
  item: SessionListItem;
  /** The log the kernel is attached to (row highlight, `aria-selected`). */
  selected: boolean;
  /**
   * Current epoch ms, injected by the list. The stamp is a relative age, so the
   * row cannot read the clock itself and stay a pure function of its props.
   */
  now: number;
  onOpen: () => void;
  /** Ask to delete this session log (the shell owns the confirmation). */
  onDelete: () => void;
}): JSX.Element {
  const title = sessionTitle(item);
  const titleRef = useRef<HTMLSpanElement>(null);
  const marquee = useTitleMarquee(titleRef);
  return (
    <div
      className={cls(css.sessionRow, selected && css.selected)}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      title={item.title.length > 0 ? item.title : item.file}
      data-row-key={item.file}
      onClick={onOpen}
      onPointerEnter={marquee.enter}
      onPointerLeave={marquee.leave}
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
      {/* The row's clipping lane. Its `data-scrolled` / `data-clipped` hooks are
          what the sheet's fade masks read while the marquee travels (the
          reference's `placeTitle`). */}
      <span ref={titleRef} className={css.title}>{title}</span>
      <span className={css.time}>{relativeStamp(item.mtime, now)}</span>
      {/* Hover swaps the stamp for the row's actions, the reference's own rule
          (its `.rowActions` takes the `.time` cell). Always in the DOM so a
          keyboard can reach it — the sheet is what shows it on hover/focus. */}
      <span className={css.rowActions}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={`删除会话：${title}`}
          title="删除"
          onClick={(event) => {
            // A delete is not an open: the row's own click would switch to the
            // session being removed.
            event.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon className={css.actionIcon} />
        </button>
      </span>
    </div>
  );
}