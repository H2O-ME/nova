/**
 * The 变更 tab's body: the files this session changed, and the selected file's
 * diff.
 *
 * Layout follows deepseek-harness `ui-sidebar-right`'s changes-review tab (MIT)
 * where this surface has the data for it: a file list above, the chosen diff
 * below, each row carrying its own add/remove counts. What it does NOT copy is
 * the harness's side-by-side/wrap toolbar — that tab reads a git-recorded
 * snapshot per turn with a host route behind it, while this one renders the
 * diffs the transcript already holds (see `changes-model.ts`), and a split view
 * of a body that small is a control with nothing to control.
 *
 * The list is drawn even when a file is selected: the tab answers "what changed",
 * and the answer's shape is a list, not one file at a time.
 */
import { RIGHTBAR_COPY } from './copy.js';
import { fileSummary, type ChangedFile, type ChangesModel } from './changes-model.js';
import css from './RightbarPanel.module.css';

export interface ChangesPanelProps {
  model: ChangesModel;
  /** The file whose diff is open, or null (the list alone). */
  selected: string | null;
  onSelect: (path: string) => void;
}

export function ChangesPanel({ model, selected, onSelect }: ChangesPanelProps): JSX.Element {
  if (model.files.length === 0) {
    return (
      <div className={css.empty}>
        <p className={css.emptyTitle}>{RIGHTBAR_COPY['changes.empty']}</p>
        <p className={css.emptyNote}>{RIGHTBAR_COPY['changes.empty.note']}</p>
      </div>
    );
  }
  // A selection that is no longer in the list (the session moved on) opens the
  // newest file rather than nothing: the tab always shows a diff when it has one.
  const current = model.files.find((file) => file.path === selected) ?? (model.files[0] as ChangedFile);
  return (
    <div className={css.changes}>
      <p className={css.summary}>
        {RIGHTBAR_COPY['changes.summary']
          .replace('{files}', String(model.files.length))
          .replace('{added}', String(model.added))
          .replace('{removed}', String(model.removed))}
      </p>
      <ul className={css.fileList} aria-label={RIGHTBAR_COPY['changes.list.label']}>
        {model.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={css.fileRow}
              aria-pressed={file.path === current.path}
              title={file.path}
              onClick={() => { onSelect(file.path); }}
            >
              <span className={css.filePath}>{file.path}</span>
              <span className={css.fileStats} data-verdict={verdictOf(file)}>
                {fileSummary(file)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className={css.diff} role="figure" aria-label={current.path}>
        <div className={css.diffHead}>
          <span className={css.diffPath} title={current.path}>{current.path}</span>
          <span className={css.diffVerdict}>{verdictWord(current)}</span>
        </div>
        <div className={css.diffBody}>
          {current.rows.map((row, index) => (
            // The row index is the only stable identity a diff row has: two
            // identical context lines are two rows, and keying by text would
            // collapse them into one.
            <div key={index} className={css.diffLine} data-op={row.t}>
              <span className={css.diffMark}>{markOf(row.t)}</span>
              <span className={css.diffText}>{row.t === 'skip' ? skipText(row.n) : row.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The verdict a list row's counts are painted with. */
function verdictOf(file: ChangedFile): string {
  if (file.ok === undefined) return 'running';
  return file.ok ? 'ok' : 'fail';
}

/** The verdict word on the open file's head. */
function verdictWord(file: ChangedFile): string {
  if (file.ok === undefined) return RIGHTBAR_COPY['changes.running'];
  return file.ok ? RIGHTBAR_COPY['changes.done'] : RIGHTBAR_COPY['changes.failed'];
}

/** The gutter mark a diff row carries (`+`, `−`, or nothing for context). */
function markOf(op: 'ctx' | 'del' | 'add' | 'skip'): string {
  if (op === 'add') return '+';
  if (op === 'del') return '−';
  return '';
}

/** A collapsed context run's own line. */
function skipText(count: number): string {
  return RIGHTBAR_COPY['changes.cut'].replace('{n}', String(count));
}
