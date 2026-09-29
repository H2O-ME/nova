/**
 * Block → display lines (M11 批4). The other half of the presentation
 * contract: `view.card` says *what* the call is, and this file decides how a
 * terminal says it.
 *
 * Six result cards and four call cards, with no tool name ever compared. A
 * card this build has never heard of still renders, because every branch
 * either matches a card or falls through to the card's own fields.
 *
 * Three-state folding (grok's Collapsed / Truncated / Expanded) lives here as
 * a line count: a collapsed tool row is its headline, and the body appears
 * only when the user expands it — the preview tier is what keeps a 400-line
 * test failure from burying the answer.
 */
import { isFailureContent, type FileDiff, type ToolCallView } from '@nova-agent/core';
import { CONTENT_COL, MARK_COL } from './layout.js';
import { BG_BASE, blend, paint, waveBrightness, type Palette } from './theme.js';
import type { Block } from './blocks.js';

/** Body rows shown for a collapsed call in the truncated tier. */
export const TRUNCATED_ROWS = 8;
/** Body rows shown when expanded. */
export const EXPANDED_ROWS = 400;
/** Markers, one per row kind, all landing in the same mark column. */
export const MARKS = { user: '❯', answer: '•', running: '⠙', ok: '✓', fail: '✗', rail: '▌', subagent: '◈', job: '▤', chip: '▤' } as const;

const AIR = ' '.repeat(Math.max(1, CONTENT_COL - MARK_COL - 1));

/** Prefix a row with the mark column: `  ✓ content`. */
function row(marker: string, color: string, content: string, palette: Palette): string {
  return `${' '.repeat(MARK_COL)}${paint(palette, color, marker)}${AIR}${content}`;
}

/** Body rows hang off the rail, one column in from the mark. */
function railed(content: string, palette: Palette, color: string, tick: number, index: number): string {
  // The wave fades toward the theme's background, so a light terminal fades a
  // lit rail into white instead of into GrokNight's black.
  const phase = blend(palette.bg === '' ? BG_BASE : palette.bg, color === '' ? '#6c6c6c' : color, waveBrightness(tick, index));
  return `${' '.repeat(MARK_COL)}${paint(palette, phase, MARKS.rail)}${AIR}${content}`;
}

export interface PaintOpts {
  tick: number;
  idle: boolean;
}

export function paintBlock(block: Block, palette: Palette, opts: PaintOpts): string[] {
  switch (block.kind) {
    case 'user':
      return [row(MARKS.user, palette.accent, paint(palette, palette.text, block.text), palette)];
    case 'text':
      return markdown(block.text, palette, block.streaming ? opts.tick : undefined);
    case 'reasoning':
      return reasoningLines(block.text, palette, block.streaming);
    case 'hint':
      return hintLines(block.text, palette, block.tone === 'live' ? { tick: opts.tick, index: 0 } : undefined);
    case 'tool':
      return toolLines(block, palette, opts);
  }
}

// ---------------------------------------------------------------- tool cards

export function toolLines(block: Extract<Block, { kind: 'tool' }>, palette: Palette, opts: PaintOpts): string[] {
  const failed = block.failed;
  const running = block.result === undefined && !opts.idle;
  const stale = block.result === undefined && opts.idle;
  const mark = running ? MARKS.running : stale ? '·' : failed ? MARKS.fail : MARKS.ok;
  const markColor = failed ? palette.accentError : running ? palette.accentRunning : stale ? palette.grayDim : palette.accentSuccess;
  const head = `${headlineOf(block.view, palette)} ${paint(palette, palette.gray, elapsedOf(block))}`.trimEnd();
  const lines = [row(mark, markColor, head, palette)];
  if (block.tail !== undefined && running) lines.push(railed(paint(palette, palette.gray, block.tail), palette, palette.accentRunning, opts.tick, 0));
  const body = bodyOf(block, palette);
  if (body.length > 0) {
    const budget = block.expanded ? EXPANDED_ROWS : TRUNCATED_ROWS;
    const shown = body.slice(0, budget);
    for (const [index, line] of shown.entries()) lines.push(railed(line, palette, failed ? palette.accentError : palette.accentRunning, opts.tick, index + 1));
    if (body.length > shown.length) {
      const hidden = body.length - shown.length;
      lines.push(railed(paint(palette, palette.gray, `…还有 ${hidden} 行（点击展开）`), palette, palette.gray, opts.tick, shown.length + 1));
    }
    if (!block.expanded) lines.push(railed(paint(palette, palette.gray, `▸ 展开（${body.length} 行）`), palette, palette.gray, opts.tick, shown.length + 2));
  }
  return lines;
}

/** The call's headline, per call card (what was asked for). */
function headlineOf(call: ToolCallView, palette: Palette): string {
  switch (call.card) {
    case 'terminal':
      return paint(palette, palette.text, `$ ${call.command}`);
    case 'diff':
      return paint(palette, palette.text, diffTitle(call.diffs));
    case 'search':
      return `${paint(palette, palette.gray, call.mode === 'content' ? '搜索内容' : '搜索文件名')} ${paint(palette, palette.text, call.query)}`;
    case 'generic': {
      // The verdict belongs to the result; the call supplies the subject.
      const subtitle = call.subtitle ?? kindWord(call.kind);
      const head = paint(palette, palette.text, call.title);
      return subtitle === '' ? head : `${head} ${paint(palette, palette.gray, subtitle)}`;
    }
  }
}

function kindWord(kind: string): string {
  switch (kind) {
    case 'read':
      return '读取';
    case 'search':
      return '搜索';
    case 'edit':
      return '编辑';
    case 'write':
      return '写入';
    case 'execute':
      return '执行';
    case 'job':
      return '后台';
    case 'plan':
      return '计划';
    default:
      return '';
  }
}

/** The result's own rows, per result card. */
function bodyOf(block: Extract<Block, { kind: 'tool' }>, palette: Palette): string[] {
  const result = block.result;
  if (result === undefined) return [];
  switch (result.card) {
    case 'generic':
      return result.ok && result.text.length === 0 ? [] : result.text.split('\n').map((line) => paint(palette, result.ok ? palette.textSecondary : palette.accentError, line));
    case 'terminal': {
      const body = result.output.length === 0 ? ['(无输出)'] : result.output.split('\n');
      const note = exitNote(result.exitCode, result.droppedBytes);
      return [...body.map((line) => paint(palette, palette.textSecondary, line)), paint(palette, result.exitCode === 0 ? palette.gray : palette.accentError, note)];
    }
    case 'diff':
      return result.diffs.flatMap((diff) => diffLines(diff, palette));
    case 'search':
      return result.matches.length === 0
        ? [paint(palette, palette.gray, '无匹配')]
        : [
            ...result.matches.map((match) => `${paint(palette, palette.text, match.path)}${match.line === undefined ? '' : paint(palette, palette.gray, `:${match.line}`)}`),
            ...(result.truncated ? [paint(palette, palette.warning, '…结果被截断')] : []),
          ];
    case 'read':
      return [paint(palette, palette.gray, `${result.path} · ${result.lineCount} 行${result.truncated ? ' · 仅片段' : ''}`)];
    case 'plan':
      return result.items.map((item) => {
        const glyph = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '▸' : '·';
        const color = item.status === 'completed' ? palette.gray : item.status === 'in_progress' ? palette.accent : palette.grayDim;
        return `${paint(palette, color, glyph)} ${paint(palette, palette.textSecondary, item.text)}`;
      });
  }
}

function diffLines(diff: FileDiff, palette: Palette): string[] {
  const lines = [paint(palette, palette.path, diff.path)];
  if (diff.oldText !== null) for (const line of diff.oldText.split('\n')) lines.push(paint(palette, palette.diffDeleteFg, `- ${line}`));
  for (const line of diff.newText.split('\n')) lines.push(paint(palette, palette.diffInsertFg, `+ ${line}`));
  return lines;
}

function diffTitle(diffs: readonly FileDiff[]): string {
  const first = diffs[0];
  if (first === undefined) return '文件改动';
  return diffs.length === 1 ? first.path : `${first.path} 等 ${diffs.length} 个文件`;
}

function exitNote(exitCode: number | null, droppedBytes: number | undefined): string {
  const exit = exitCode === null ? '未退出（中断/超时）' : `退出码 ${exitCode}`;
  return droppedBytes !== undefined && droppedBytes > 0 ? `${exit} · 省略 ${humanBytes(droppedBytes)}` : exit;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Elapsed time of a finished call, grey and small (`· 0.4s`). */
function elapsedOf(block: Extract<Block, { kind: 'tool' }>): string {
  if (block.endedAt === undefined) return '';
  return `· ${((block.endedAt - block.startedAt) / 1000).toFixed(1)}s`;
}

// ------------------------------------------------------------- prose blocks

/**
 * Streaming-aware markdown, minimally: ATX headings, list bullets, fenced
 * code, and inline `code` spots. Deliberately not a full parser — a terminal
 * transcript needs the *shape* of the text (indentation, emphasis) far more
 * than it needs spec coverage, and the web surface owns the full renderer.
 */
export function markdown(text: string, palette: Palette, tick: number | undefined): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(row(' ', '', paint(palette, palette.mdCode, line), palette));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length;
      const color = level <= 1 ? palette.mdHeading1 : level === 2 ? palette.mdHeading2 : palette.mdHeading3;
      out.push(row(MARKS.answer, palette.accentAssistant, paint(palette, `${palette.bold}${color}`, heading[2]!), palette));
      continue;
    }
    const bullet = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    const content =
      bullet === null
        ? inline(line, palette)
        : `${paint(palette, palette.gray, bullet[1] === '' ? '·' : `${bullet[1]}·`)} ${inline(bullet[3]!, palette)}`;
    out.push(row(MARKS.answer, palette.accentAssistant, content, palette));
  }
  if (out.length === 0) out.push(row(MARKS.answer, palette.accentAssistant, '', palette));
  if (tick !== undefined) out[out.length - 1] = `${out[out.length - 1]}${paint(palette, palette.accentRunning, '▌')}`;
  return out;
}

/** Inline `code` and **bold** — the two that change how text reads. */
function inline(text: string, palette: Palette): string {
  return paint(palette, palette.text, text)
    .replace(/`([^`]+)`/g, (_match, code: string) => paint(palette, palette.mdCode, code))
    .replace(/\*\*([^*]+)\*\*/g, (_match, bold: string) => paint(palette, `${palette.bold}${palette.text}`, bold));
}

/** Thinking: dim, and only the tail while it streams (grok's live window). */
export function reasoningLines(text: string, palette: Palette, streaming: boolean): string[] {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  if (!streaming) return [row('▸', palette.gray, paint(palette, palette.gray, `已思考 ${lines.length} 行`), palette)];
  const tail = lines.slice(-2);
  return tail.map((line, index) =>
    row(index === 0 ? '▸' : ' ', palette.accentThinking, paint(palette, palette.gray, line), palette),
  );
}

function hintLines(text: string, palette: Palette, wave: { tick: number; index: number } | undefined): string[] {
  const color = wave === undefined ? palette.gray : blend('#141414', palette.accentRunning, waveBrightness(wave.tick, 0));
  return [row(wave === undefined ? '⟳' : MARKS.subagent, color, paint(palette, palette.gray, text), palette)];
}

/** Shared with the surface: a tool row's verdict is the result's to state. */
export function toolFailed(content: string): boolean {
  return isFailureContent(content);
}