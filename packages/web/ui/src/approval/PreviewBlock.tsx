/**
 * The approval card's effect preview: the diff a `write_file` / `edit_file`
 * approval WOULD apply, drawn with the tool group's diff block values
 * (deepseek-harness `ui-primitives` DiffBlock) so an approval preview and the
 * transcript's applied diff read as the same object.
 *
 * The copy button and the fold toggle are deliberately absent: the card body is
 * the scrollport (the approval reference caps it at
 * `--dsh-composer-text-max-height`), and the kernel already bounds a preview
 * (`plugins/builtin/fs.ts` cuts it at 17 lines). Nothing here decides anything
 * — `preview-model.ts` classifies the lines, this file projects them.
 */
import { previewRows, previewStats } from './preview-model.js';
import type { PreviewRow } from './preview-model.js';
import css from './PreviewBlock.module.css';

/** The dim chrome a row kind may carry (diff meaning lives in the stylesheet). */
const ROW_CLASS: Record<PreviewRow['kind'], string | undefined> = {
  path: css.path,
  del: css.del,
  add: css.add,
  dim: css.dim,
};

/** One row's classes: the shared line metrics plus its kind's tone. */
function rowClass(kind: PreviewRow['kind']): string | undefined {
  const tone = ROW_CLASS[kind];
  return tone === undefined ? css.line : `${css.line} ${tone}`;
}

/**
 * Render a preview as a diff block, or nothing when the tool sent none.
 * @param props.preview - the request's post-args effect preview lines.
 * @returns The block, or null.
 */
export function PreviewBlock({ preview }: { preview: readonly string[] }): JSX.Element | null {
  const rows = previewRows(preview);
  if (rows.length === 0) return null;
  const { added, removed } = previewStats(rows);
  return (
    <div className={css.block} data-preview="">
      <div className={css.body}>
        {rows.map((row, index) => (
          <div key={index} className={rowClass(row.kind)}>{row.text}</div>
        ))}
      </div>
      {/* A preview with no +/- lines (write_file's summary) prints no totals —
          `└ +0 -0` would be a number the reader has to decode into "nothing". */}
      {added + removed > 0 && <div className={css.footer}>└ +{added} -{removed}</div>}
    </div>
  );
}