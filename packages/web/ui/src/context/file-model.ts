/**
 * The Context pane's file reading: what the run did to the files.
 *
 * The pane's event log was removed by decision (2026-10-01) — the compaction /
 * workspace / goal history is still in the fold's reading (`ContextTimeline.
 * events`), but the pane shows the two questions a reader acts on (what is in
 * the window, what it touched) instead of narrating its own history.
 */
import type { FileOpRecord } from '../types.js';

/** One purpose badge of a file row (read / write / search). */
export interface FileBadge {
  kind: 'read' | 'write' | 'search';
  label: string;
  count: number;
}

/** One file-activity row: what the run did to a path. */
export interface FileRow {
  path: string;
  /** Last log position that touched it — the fold's sort key, kept for the row key. */
  seq: number;
  /** Total operations, the "most active first" reading of the row. */
  ops: number;
  /** The purposes exercised, in read → write → search order, zeros dropped. */
  badges: FileBadge[];
  /** Lines added / removed by writes (both zero when no write carried a delta). */
  added: number;
  removed: number;
}

/**
 * Fold the file records into rows, newest-touched first.
 *
 * The badges are the row's whole summary: an earlier shape returned one prose
 * sentence ("读取 4 次") chosen by a dominance rule, which silently hid the
 * other purposes a file was used for. Every non-zero purpose gets its badge.
 * @param files - the fold's per-path records.
 * @returns the rows, in the order given (the fold sorts by recency).
 */
export function fileRows(files: readonly FileOpRecord[]): FileRow[] {
  return files.map((file) => ({
    path: file.path,
    seq: file.seq,
    ops: file.reads + file.writes + file.searches,
    badges: (
      [
        { kind: 'read', label: '读取', count: file.reads },
        { kind: 'write', label: '写入', count: file.writes },
        { kind: 'search', label: '搜索', count: file.searches },
      ] as const
    ).filter((badge) => badge.count > 0),
    added: file.added,
    removed: file.removed,
  }));
}
