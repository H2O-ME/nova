/**
 * Tool call line builders (start / done / grouped). Budgets are display
 * columns; the ` · meta · Ns` tail always stays on the first row.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipPath, clipToWidth, toolArgSummary } from './clip.js';
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

/** Read-only explorer tools: completed calls fold into one "查看" group row. */
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
  const flat = content
    .replaceAll('\r', '')
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
  else if (flat.length > 1) meta = ` · ${flat.length} 行`;
  const head = `    ✓ ${label} ${meta}${secs}`;
  return [
    `    ${p.green('✓')} ${p.bold(label)} ${p.cyan(toolArgSummary(name, rawArgs, summaryBudget(head)))}${p.dim(meta)}${p.dim(secs)}`,
  ];
}

function fitGroupNames(entries: string[], budget: number): string {
  const joined = entries.join(', ');
  if (styledWidth(joined) <= budget) return joined;
  let prefix = '';
  let pathSep = '/';
  let items = entries;
  if (entries.length > 1) {
    const parts = entries.map((e) => e.split(/[\\/]/));
    pathSep = entries[0]?.includes('\\') === true ? '\\' : '/';
    let common = 0;
    while (
      common < (parts[0]?.length ?? 0) - 1 &&
      parts.every((p) => p.length > common && p[common] === parts[0]?.[common])
    ) {
      common += 1;
    }
    if (common > 0) {
      prefix = `${parts[0]?.slice(0, common).join(pathSep) ?? ''}${pathSep}`;
      items = entries.map((e) => (e.startsWith(prefix) ? e.slice(prefix.length) : e));
    }
  }
  const render = (names: string[]): string => `${prefix}${names.join(', ')}`;
  let out = render(items);
  if (styledWidth(out) <= budget) return out;
  if (prefix.length > 0) {
    const clipped = clipPath(prefix.slice(0, -pathSep.length), Math.max(4, Math.floor(budget / 4)));
    prefix = `${clipped}${pathSep}`;
    out = render(items);
    if (styledWidth(out) <= budget) return out;
  }
  const kept: string[] = [];
  let width = styledWidth(prefix);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] ?? '';
    const w = styledWidth(item) + (kept.length > 0 ? 2 : 0);
    if (width + w + 4 > budget) break; // room for the leading `…, ` (2+1+1 cols)
    kept.unshift(item);
    width += w;
  }
  if (kept.length === 0) return clipPath(items[items.length - 1] ?? '', budget);
  return render(kept.length < items.length ? ['…', ...kept] : kept);
}

/** `    ✓ 查看 a.ts, b.ts · 3 次 · 0.5s` — consecutive reads fold into one row. */
export function toolGroupLine(p: Palette, entries: string[], durationMs: number, cols?: number): string {
  const suffix = ` · ${entries.length} 次 · ${(durationMs / 1000).toFixed(1)}s`;
  const fixed = `    ✓ 查看 ${suffix}`;
  const budget = cols === undefined ? 80 : Math.max(12, cols - 1 - styledWidth(fixed));
  return `    ${p.green('✓')} ${p.bold('查看')} ${p.cyan(fitGroupNames(entries, budget))}${p.dim(suffix)}`;
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
