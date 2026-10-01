/**
 * The Context pane's file activity: every path the run touched, newest first,
 * with a badge per purpose and the line delta of its writes.
 *
 * The badges are the row's summary — an earlier shape chose ONE prose sentence
 * by a dominance rule and silently hid the other purposes a file was read for
 * AND written to. The delta is the write-arguments' own estimate (`+3/−1 行`),
 * never a re-read of the file.
 */
import type { FileOpRecord } from '../types.js';
import { cx } from '../composer/cx.js';
import { fileRows } from './activity-model.js';
import css from './ContextView.module.css';

/** One tint per purpose, read through the sheet's own binding. */
const BADGE = { read: css.badgeRead, write: css.badgeWrite, search: css.badgeSearch } as const;

export function FilesCard({ files }: { files: readonly FileOpRecord[] }): JSX.Element {
  const rows = fileRows(files);
  return (
    <section className={css.card} data-context-files="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>文件活动</h3>
        {rows.length > 0 && <span className={css.trailing}>{rows.length} 个文件</span>}
      </header>
      {rows.length === 0 ? (
        <p className={css.empty}>还没有文件操作。</p>
      ) : (
        <ul className={css.fileList}>
          {rows.map((row) => (
            <li key={`${row.seq}-${row.path}`} className={css.fileRow}>
              <span className={css.filePath} title={row.path}>{row.path}</span>
              {row.badges.map((badge) => (
                <span key={badge.kind} className={cx(css.fileBadge, BADGE[badge.kind])}>
                  {badge.label}
                  <b className={css.badgeCount}>{badge.count}</b>
                </span>
              ))}
              {(row.added > 0 || row.removed > 0) && (
                <span className={css.fileDelta}>
                  {row.added > 0 && <span className={css.deltaUp}>+{row.added}</span>}
                  {row.removed > 0 && <span className={css.deltaDown}>−{row.removed}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
