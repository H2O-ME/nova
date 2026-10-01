/**
 * The Context pane's activity reading: what CHANGED the window, and what the run
 * did to the files.
 *
 * Split from `context-model.ts` because these two lists answer the same kind of
 * question — a log of things that happened, newest first, read row by row —
 * while the composition and trend cards answer "what is in it / how it grew".
 */
import type { ContextEventRecord, FileOpRecord } from '../types.js';

/** One readable line for an event row. */
export function eventRow(record: ContextEventRecord): { label: string; detail: string } {
  switch (record.kind) {
    case 'compaction':
      return {
        label: '压缩',
        detail: record.freed !== undefined ? `回收约 ${record.freed} tokens` : '上下文被压缩',
      };
    case 'workspace':
      return { label: '切换工作区', detail: record.detail ?? '' };
    case 'goal':
      return { label: '目标', detail: record.detail ?? '已清除' };
    default:
      return { label: record.kind, detail: record.detail ?? '' };
  }
}

/** How one event kind is drawn: its glyph and its filter chip's label. */
export const EVENT_META: Record<ContextEventRecord['kind'], { glyph: string; chip: string }> = {
  compaction: { glyph: '✂', chip: '压缩' },
  workspace: { glyph: '⌂', chip: '工作区' },
  goal: { glyph: '◎', chip: '目标' },
};

/** One filter chip's tallies: the kind, its drawn label, and how many it holds. */
export interface EventChip {
  kind: ContextEventRecord['kind'];
  glyph: string;
  label: string;
  count: number;
}

/**
 * The event list's filter chips, in reading order, zeros included so the row's
 * shape does not move as events arrive; `全部` is the component's own chip.
 */
export function eventChips(events: readonly ContextEventRecord[]): EventChip[] {
  return (Object.keys(EVENT_META) as ContextEventRecord['kind'][]).map((kind) => ({
    kind,
    glyph: EVENT_META[kind].glyph,
    label: EVENT_META[kind].chip,
    count: events.filter((event) => event.kind === kind).length,
  }));
}

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
