/**
 * Verb-phrase tool grouping (M11 批4), ported from grok's `verb_group`.
 *
 * Thirty `read_file` calls in a row should not be thirty rows. Consecutive
 * *collapsed, groupable* tool rows fold into one header — `◈ 读取 2 个文件, 搜索 1
 * 个模式 ▸` — and which verb a row contributes is a property of the tool, not a
 * decision for the renderer.
 *
 * Three rules carried over verbatim:
 *  - **One running member makes the whole bucket present-tense** (`正在读取`),
 *    because the header is a claim about now, not an average over the past.
 *  - **Buckets keep first-appearance order**, so the header reads left to right
 *    in the order the work happened instead of being sorted by kind.
 *  - **Execute-style calls never join a run** (grok's `Execute` is not
 *    groupable): a shell command is a thing the user asked for and must stay
 *    legible on its own row. Only reads, listings and searches fold.
 */
import type { ToolCallKind } from '@nova-agent/core';

export type VerbKind = 'file' | 'dir' | 'search' | 'subagent' | 'plan';

interface VerbWords {
  verb: string;
  /** Present-tense form, used when any member is still running. */
  running: string;
  /** One unit of the counted noun (Chinese has no plural). */
  noun: string;
}

const WORDS: Record<VerbKind, VerbWords> = {
  file: { verb: '读取', running: '正在读取', noun: '个文件' },
  dir: { verb: '列出', running: '正在列出', noun: '个目录' },
  search: { verb: '搜索', running: '正在搜索', noun: '处匹配' },
  subagent: { verb: '派出', running: '正在派出', noun: '个子代理' },
  plan: { verb: '更新', running: '正在更新', noun: '次计划' },
};

/** Which tool kinds can join a run at all (`undefined` = never folds). */
export function verbKindOf(kind: ToolCallKind): VerbKind | undefined {
  switch (kind) {
    case 'read':
      return 'file';
    case 'search':
      return 'search';
    case 'job':
      return 'plan';
    default:
      return undefined;
  }
}

/** One candidate row in the transcript, as the run scanner sees it. */
export interface RunStep {
  /** The verb this row contributes, or `undefined` when it cannot join a run. */
  verb: VerbKind | undefined;
  /** Manually expanded by the user: keeps its own rows, but does not split a run. */
  expanded: boolean;
  running: boolean;
  failed: boolean;
}

export interface VerbBucket {
  kind: VerbKind;
  count: number;
  running: boolean;
  failed: number;
}

export interface VerbRun {
  /** Indices of the steps this run claims. */
  members: readonly number[];
  buckets: readonly VerbBucket[];
}

export type RunSpan = { kind: 'run'; run: VerbRun } | { kind: 'single'; index: number };

/**
 * Partition the transcript's steps into runs and singles. A run is a maximal
 * span of adjacent steps that each contribute a verb; an expanded member keeps
 * its own rows (it is not claimed) but still does not break the span, which is
 * how a user who opened one call mid-sequence sees the rest still grouped.
 */
export function partitionRuns(steps: readonly RunStep[]): RunSpan[] {
  const spans: RunSpan[] = [];
  let current: number[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const buckets = bucketsOf(current.map((index) => steps[index]!));
    // A span with no claimable member is not a run — nothing would fold.
    if (buckets.length === 0) {
      for (const index of current) spans.push({ kind: 'single', index });
    } else {
      spans.push({ kind: 'run', run: { members: current, buckets } });
    }
    current = [];
  };
  steps.forEach((step, index) => {
    if (step.verb === undefined) {
      flush();
      spans.push({ kind: 'single', index });
      return;
    }
    current.push(index);
  });
  flush();
  return spans;
}

/** Bucket a run's members in first-appearance order. */
export function bucketsOf(members: readonly RunStep[]): VerbBucket[] {
  const buckets: VerbBucket[] = [];
  for (const member of members) {
    if (member.verb === undefined || member.expanded) continue; // expanded rows are not counted
    let bucket = buckets.find((b) => b.kind === member.verb);
    if (bucket === undefined) {
      bucket = { kind: member.verb, count: 0, running: false, failed: 0 };
      buckets.push(bucket);
    }
    bucket.count += 1;
    if (member.running) bucket.running = true;
    if (member.failed) bucket.failed += 1;
  }
  return buckets;
}

/** `读取 2 个文件, 搜索 1 处匹配 · 1 失败` */
export function verbLabel(buckets: readonly VerbBucket[]): string {
  const parts = buckets.map((bucket) => {
    const words = WORDS[bucket.kind];
    const verb = bucket.running ? words.running : words.verb;
    return `${verb} ${bucket.count} ${words.noun}`;
  });
  const failed = buckets.reduce((sum, bucket) => sum + bucket.failed, 0);
  return failed > 0 ? `${parts.join(', ')} · ${failed} 失败` : parts.join(', ');
}

/** Is this run still doing something? (Drives the animated header marker.) */
export function runRunning(buckets: readonly VerbBucket[]): boolean {
  return buckets.some((bucket) => bucket.running);
}