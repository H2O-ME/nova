/**
 * Tool call line builders (start / done / grouped). Budgets are display
 * columns; the ` · meta · Ns` tail always stays on the first row.
 */

import { sanitizeForDisplay, styledWidth } from '@nova-agent/tui';
import { clipToWidth, toolArgSummary } from './clip.js';
import { toolLabel } from './labels.js';
import type { Palette } from './palette.js';

export { toolArgSummary, toolLabel };
export type { Palette };

/** Tool block gutter: the failure └ row aligns under the content column. */
export const TOOL_GUTTER: { first: string; rest: string } = { first: '', rest: '      ' };

/** A nested subagent call the parent is waiting on (codex-style marker). */
export interface SubagentLiveView {
  label: string;
  /** Latest nested tool name invoked (undefined = still thinking). */
  lastTool?: string;
  /** Nested tool name → count, in first-seen order. */
  toolCounts: ReadonlyMap<string, number>;
  /** Nested provider request rounds so far. */
  turns: number;
  /** Nested prompt+completion tokens so far. */
  promptTokens: number;
  completionTokens: number;
  /** Detail (nested tool lines) is available — click expands. */
  expandable?: boolean;
  /** Current expand state (▸ collapsed / ▾ expanded affordance). */
  expanded?: boolean;
}

/**
 * Shared width budget for tool rows. wrapBlock folds at `cols-1-gutter`, so
 * row builders must clip into the same budget or the tail gets pushed onto
 * an orphan continuation row.
 */
export function toolBudget(cols: number): number {
  return cols - 1 - styledWidth(TOOL_GUTTER.rest);
}

/** Read-only explorer tools: calls join the live verb group row (读取 N 个文件…). */
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files']);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

/**
 * `    ⠙ 执行命令 pnpm test` — tool running. The bullet animates (braille
 * frames); with `cols` the arg summary absorbs the remaining width.
 */
export function toolStartLine(
  p: Palette,
  name: string,
  rawArgs: string,
  frame = '•',
  cols?: number,
): string {
  const label = toolLabel(name);
  const fixed = `    ${frame} ${label} `;
  const budget = cols === undefined ? 72 : Math.max(12, cols - 1 - styledWidth(fixed));
  return `    ${p.dim(frame)} ${p.bold(label)} ${p.cyan(toolArgSummary(name, rawArgs, budget))}`;
}

export function isFailureContent(content: string): boolean {
  return (
    content.startsWith('Error') ||
    content.startsWith('Permission denied') ||
    /(^|\n)exit: [1-9]/.test(content) ||
    content.includes('did not exit')
  );
}

/** Collapsed outcome, one row on success; failures hang the first error row. */
export function toolDoneLine(
  p: Palette,
  name: string,
  rawArgs: string,
  content: string,
  durationMs: number,
  cols?: number,
): string[] {
  const label = toolLabel(name);
  const secs = ` · ${(durationMs / 1000).toFixed(1)}s`;
  const summaryBudget = (fixedPlain: string): number =>
    cols === undefined ? 72 : Math.max(12, cols - 1 - styledWidth(fixedPlain));
  // Tool output is external content: converge escapes before they enter the
  // frame string (see packages/tui sanitize.ts) — a stray `\x1b[2K` would
  // otherwise execute on screen while the diff cache remembers stale text.
  const clean = sanitizeForDisplay(content);
  const flat = clean
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (isFailureContent(content)) {
    const head = `    ✗ ${label} `;
    const lines = [`    ${p.red('✗')} ${p.bold(label)} ${p.cyan(toolArgSummary(name, rawArgs, summaryBudget(head + secs)))}${p.dim(secs)}`];
    // bash results lead with bare `exit: N` / `stdout:` markers; surface the
    // first row carrying actual content instead.
    const first = flat.find((l) => !/^exit: \d+$/.test(l) && !/^(stdout|stderr):\s*$/.test(l) && l !== '(empty)');
    const inner = cols === undefined ? 100 : Math.max(12, cols - 1 - 8);
    if (first !== undefined) {
      lines.push(`      ${p.dim(`└ ${clipToWidth(first, inner)}`)}`);
    } else {
      const code = /exit: (\d+|null)/.exec(content)?.[1];
      lines.push(`      ${p.dim(`└ 命令无输出${code !== undefined ? `（退出码 ${code}）` : ''}`)}`);
    }
    return lines;
  }
  let meta = '';
  if (flat.length === 1) meta = ` · ${clipToWidth(flat[0] ?? '', 60)}`;
  // ▸ = 可点击三态展开的 affordance（与 reasoning 折叠头同一语言）。
  else if (flat.length > 1) meta = ` · ${flat.length} 行 ▸`;
  const head = `    ✓ ${label} ${meta}${secs}`;
  return [
    `    ${p.green('✓')} ${p.bold(label)} ${p.cyan(toolArgSummary(name, rawArgs, summaryBudget(head)))}${p.dim(meta)}${p.dim(secs)}`,
  ];
}

/**
 * Read-group verb/noun table (Grok `verb_group` port): members bucket by
 * tool name in first-appearance order; the whole label flips tense while any
 * member runs. Chinese carries aspect via the 正在 prefix, not conjugation.
 */
const VERB_GROUP: Record<string, { verb: string; noun: string }> = {
  read_file: { verb: '读取', noun: '文件' },
  list_dir: { verb: '列出', noun: '目录' },
  search_files: { verb: '搜索', noun: '模式' },
};

export interface ReadGroupView {
  /** Tool name of every member, still-running ones included (bucketed in first-appearance order). */
  names: string[];
  /** Members yet to return — >0 flips every segment to present aspect and the marker to `•`. */
  running: number;
  /** Members that completed with an error: red ` · N 失败` suffix, never a standalone row. */
  failed: number;
  durationMs: number;
  /** ▾ vs ▸ affordance for the click-expand member list. */
  expanded?: boolean;
}

/** `    ✓ 读取 2 个文件, 搜索 1 个模式 ▸ · 0.5s` — one run of reads folded into a verb line. */
export function readGroupLine(p: Palette, v: ReadGroupView, cols?: number): string {
  const counts = new Map<string, number>();
  for (const name of v.names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const aspect = v.running > 0 ? '正在' : '';
  const segments: string[] = [];
  for (const [name, count] of counts) {
    const kind = VERB_GROUP[name] ?? { verb: toolLabel(name), noun: '调用' };
    segments.push(`${aspect}${kind.verb} ${count} 个${kind.noun}`);
  }
  const marker = v.running > 0 ? '•' : '✓';
  const arrow = v.expanded === true ? ' ▾' : ' ▸';
  const fail = v.failed > 0 ? ` · ${v.failed} 失败` : '';
  const secs = ` · ${(v.durationMs / 1000).toFixed(1)}s`;
  const fixedPlain = `    ${marker} ${arrow}${fail}${secs}`;
  const budget = cols === undefined ? 80 : Math.max(12, cols - 1 - styledWidth(fixedPlain));
  const text = clipToWidth(segments.join(', '), budget);
  return `    ${v.running > 0 ? p.dim(marker) : p.green(marker)} ${p.bold(text)}${p.dim(arrow)}${v.failed > 0 ? p.red(fail) : ''}${p.dim(secs)}`;
}

export type StopKind = 'complete' | 'max_turns' | 'aborted';

const STOP_WORD: Record<StopKind, { word: string; paint: keyof Palette }> = {
  complete: { word: '✓ 完成', paint: 'green' },
  max_turns: { word: '! 已达最大轮数', paint: 'yellow' },
  aborted: { word: '■ 已中断', paint: 'yellow' },
};

/** Token counts in glanceable form (1.1k, 58k, 1.05M). */
export function humanTokens(n: number): string {
  const trim = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim((n / 1000).toFixed(1))}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${trim((n / 1_000_000).toFixed(2))}M`;
}

/** `  ✓ 完成 · 2 轮 · ↑2.9k ↓132 tok · 缓存 53% · 4.2s` — end-of-turn one-liner. */
export function statusLine(
  p: Palette,
  kind: StopKind,
  stats: { turns: number; promptTokens: number; completionTokens: number; cachedTokens: number },
  elapsedMs: number,
): string {
  const { word, paint } = STOP_WORD[kind];
  const hit = stats.promptTokens > 0 ? Math.round((stats.cachedTokens / stats.promptTokens) * 100) : 0;
  const body = p.dim(
    ` · ${stats.turns} 轮 · ↑${humanTokens(stats.promptTokens)} ↓${humanTokens(stats.completionTokens)} tok · 缓存 ${hit}% · ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  return `  ${p[paint](word)}${body}`;
}

/** Context-pressure bar: filled cells track estimate vs auto-compact limit. */
export function contextBar(ratio: number, cells = 8): string {
  const filled = Math.max(0, Math.min(cells, Math.round(ratio * cells)));
  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

/**
 * Live subagent row (single line, re-rendered per nested event): the agent
 * glyph `⧉` + label, the latest nested tool and the running totals. No
 * nested text is streamed — the transcript stays readable while the work
 * is provably progressing (dsh's "result, not intermediate steps" contract).
 */
export function subagentLiveLine(p: Palette, v: SubagentLiveView, frame: string): string {
  const tools = [...v.toolCounts.entries()].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join(' ');
  const toks = v.promptTokens + v.completionTokens;
  const parts = [tools.length > 0 ? tools : '思考中'];
  if (v.turns > 0) parts.push(`${v.turns} 轮`);
  if (toks > 0) parts.push(`${toks} tok`);
  const affordance = v.expandable === true ? ` ${p.dim(v.expanded ? '▾' : '▸')}` : '';
  return `    ${p.dim(frame)} ${p.bold('⧉ 子代理')} ${p.cyan(v.label)}${affordance} ${p.dim(`· ${parts.join(' · ')}`)}`;
}

/**
 * Expanded subagent detail rows (click body): one dim line per nested
 * moment, clipped to a single display row each. Memory-only — the nested
 * transcript is transient and never enters the session log, so expansion
 * (like reasoning) dies with the session.
 */
export function subagentDetailRows(p: Palette, entries: readonly string[], budget: number): string[] {
  return entries.map((entry) => clipToWidth(`  ${p.dim(entry)}`, Math.max(8, budget)));
}

/** Truncated 态预览行数（Grok 组件3 三态折叠：Collapsed→Truncated→Expanded）。 */
export const FOLD_PREVIEW_ROWS = 12;
/** 展开体内存护栏：core 侧已有 40KB 溢出落盘，这里再挡极端长单行为 TUI 内存兜底。 */
export const FOLD_MAX_ROWS = 400;

/** 三态折叠的行源（attach 时一次算全，点击只做数组拼接）。 */
export interface ToolFoldRows {
  /** Collapsed 行（工具完成头行原文）。 */
  base: string[];
  /** Truncated 正文：前 FOLD_PREVIEW_ROWS 行 +（若有）`└ … 还有 N 行` 尾行。 */
  preview: string[];
  /** Expanded 正文（≤FOLD_MAX_ROWS 行；正文 ≤K 行时与 preview 一致）。 */
  full: string[];
}

/**
 * 工具输出三态折叠的行源：<2 行内容不值得折叠（返回 undefined）。
 * 与 toolDoneLine 同一 sanitize  choke point——外部内容绝不带着 escape 进帧。
 */
export function buildToolFoldRows(
  p: Palette,
  base: string[],
  content: string,
  budget: number,
): ToolFoldRows | undefined {
  const rows = sanitizeForDisplay(content)
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (rows.length < 2) return undefined;
  const capped = rows.length > FOLD_MAX_ROWS ? rows.slice(0, FOLD_MAX_ROWS) : rows;
  const full = subagentDetailRows(p, capped, budget);
  const hidden = Math.max(0, rows.length - FOLD_MAX_ROWS);
  const body =
    hidden > 0 ? [...full, clipToWidth(`  ${p.dim(`└ … 另有 ${hidden} 行未载入（全文见会话缓存）`)}`, Math.max(8, budget))] : full;
  const previewBody = capped.slice(0, FOLD_PREVIEW_ROWS);
  const rest = capped.length - previewBody.length;
  const preview =
    rest > 0 || hidden > 0
      ? [
          ...subagentDetailRows(p, previewBody, budget),
          clipToWidth(
            `  ${p.dim(`└ … 还有 ${rest + hidden} 行 · 再点击展开全文`)}`,
            Math.max(8, budget),
          ),
        ]
      : body;
  return { base, preview, full: body };
}

export interface BgSubagentView {
  /** Short delegation label (without the [subagent: …] wrapper). */
  label: string;
  elapsedSecs: number;
  /** Latest nested activity ("N tools · last call"), if any. */
  progress?: string;
}

/**
 * Background-subagent live row: a detached delegation has no pending tool
 * line to take over, so it pins its own row and re-renders per tick —
 * elapsed seconds plus the latest nested activity, so "看不到子代理状态"
 * never happens for run_in_background dispatches.
 */
export function bgSubagentLine(p: Palette, v: BgSubagentView): string {
  const parts = [`${v.elapsedSecs}s`];
  if (v.progress !== undefined && v.progress.length > 0) parts.push(v.progress);
  return `    ${p.dim('…')} ${p.bold('⧉ 子代理')} ${p.cyan(v.label)} ${p.dim(`· ${parts.join(' · ')}`)}`;
}

const BG_SUBAGENT_STATUS_TEXT: Record<string, string> = {
  completed: '完成',
  failed: '失败',
  killed: '已停止',
};

/** Terminal row for a background subagent: status + the usage trailer. */
export function bgSubagentDoneLine(
  p: Palette,
  v: { label: string; status: string; detail?: string },
): string {
  const mark = v.status === 'completed' ? '✓' : '✗';
  const status = BG_SUBAGENT_STATUS_TEXT[v.status] ?? v.status;
  const parts = [status, ...(v.detail !== undefined && v.detail.length > 0 ? [v.detail] : [])];
  return `    ${p.dim(mark)} ${p.dim('⧉ 子代理')} ${p.dim(v.label)} ${p.dim(`· ${parts.join(' · ')}`)}`;
}
