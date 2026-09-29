/**
 * The 变更 tab's model: what this session changed, derived from the transcript.
 *
 * **Where the diffs come from.** The host resolves a render intent for every
 * tool call (`core/presentation.ts`) and ships it on the block, so a call that
 * mutates files arrives as `view.card === 'diff'` carrying `FileDiff[]`. This
 * model folds those cards — it never inspects a tool NAME, which is what keeps a
 * third-party editor tool that declares a diff view working here for free, and a
 * built-in one that stops declaring it disappearing from this tab for a reason.
 *
 * **What it is not.** These are the diffs the *session intended*, not a git
 * working-tree diff and not the files' current bytes: an edit applied by the
 * model and then reverted by hand still shows here, and a file changed outside
 * the session never does. The panel says so in its empty state, because a reader
 * who thinks this is `git status` will draw the wrong conclusion from its
 * silence.
 *
 * One entry per file: the LAST diff the session drew for it. A file edited five
 * times is one row whose body is the newest edit — the tab answers "what is this
 * session touching", and a five-hunk history is the transcript's job, not this
 * panel's.
 */
import { collapseContext, diffLines, diffStats, type DiffRow } from '../diff-lines.js';
import type { Block } from '../state.js';
import type { FileDiff } from '../types.js';

/** One changed file as the list draws it. */
export interface ChangedFile {
  /** The path exactly as the tool reported it (host-spelled, never re-joined). */
  path: string;
  /** Lines the last diff added. */
  added: number;
  /** Lines the last diff removed. */
  removed: number;
  /** The last diff's rows, long unchanged runs collapsed. */
  rows: readonly DiffRow[];
  /** How many mutating calls in this session touched the file. */
  calls: number;
  /** Whether the file had no prior content: a creation, not an edit. */
  created: boolean;
  /** The last call's verdict; undefined while it is still running. */
  ok: boolean | undefined;
}

/** What the 变更 tab holds (one value, folded by the pure functions below). */
export interface ChangesModel {
  /** Newest-touched first. */
  files: readonly ChangedFile[];
  added: number;
  removed: number;
  /** Mutating calls the session made (the count the header's note reports). */
  calls: number;
}

export const emptyChanges: ChangesModel = { files: [], added: 0, removed: 0, calls: 0 };

/**
 * Fold the transcript's tool blocks into the changed-file list.
 * @param blocks - the reducer's blocks, in transcript order.
 * @returns one entry per file the session drew a diff for.
 */
export function changesModel(blocks: readonly Block[]): ChangesModel {
  const byPath = new Map<string, ChangedFile>();
  let calls = 0;
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.view.card !== 'diff') continue;
    calls += 1;
    const ok = block.result !== undefined && block.result.card === 'diff' ? block.result.ok : undefined;
    for (const diff of block.view.diffs) {
      const previous = byPath.get(diff.path);
      // Delete before re-setting: a Map keeps an existing key's ORIGINAL
      // position, so a file edited twice would stay at its first edit's slot and
      // the reversed list would read oldest-first. Re-inserting moves it to the
      // end, which is what makes the reversal mean "newest touched first".
      if (previous !== undefined) byPath.delete(diff.path);
      byPath.set(diff.path, changedFile(diff, previous, ok));
    }
  }
  if (byPath.size === 0) return emptyChanges;
  let added = 0;
  let removed = 0;
  for (const file of byPath.values()) {
    added += file.added;
    removed += file.removed;
  }
  return { files: [...byPath.values()].reverse(), added, removed, calls };
}

/**
 * One file's newest state, carrying forward how often it was touched.
 *
 * The caller re-inserts an existing path so the map's order is touch order; this
 * function only owns the counts and the rows.
 */
function changedFile(diff: FileDiff, previous: ChangedFile | undefined, ok: boolean | undefined): ChangedFile {
  const ops = diffLines(diff.oldText, diff.newText);
  const stats = diffStats(ops);
  return {
    path: diff.path,
    added: stats.added,
    removed: stats.removed,
    rows: collapseContext(ops),
    calls: (previous?.calls ?? 0) + 1,
    created: diff.oldText === null,
    // The verdict belongs to the call whose diff is on screen: a newer call that
    // has not answered yet is 进行中, and inheriting the previous call's 已完成
    // would print a settled word over a diff that is still being written.
    ok,
  };
}

/** One file's summary line for the list (`+3 −1`), the harness's own template. */
export function fileSummary(file: ChangedFile): string {
  if (file.created) return `新文件 +${file.added}`;
  return `+${file.added} −${file.removed}`;
}
