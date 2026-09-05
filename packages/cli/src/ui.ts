/** 终端渲染辅助：配色、汉化标签、状态指示、工具块与状态行。 */

import { styledWidth } from '@nova-agent/tui';

export interface Palette {
  dim(text: string): string;
  cyan(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  bold(text: string): string;
}

const ansi =
  (code: string) =>
  (text: string): string =>
    `\x1b[${code}m${text}\x1b[0m`;

export const palette: Palette = {
  dim: ansi('2'),
  cyan: ansi('36'),
  green: ansi('32'),
  yellow: ansi('33'),
  red: ansi('31'),
  bold: ansi('1'),
};

/** 非 TTY 输出的无样式配色。 */
export const plainPalette: Palette = {
  dim: (text) => text,
  cyan: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  red: (text) => text,
  bold: (text) => text,
};

export type ApprovalModeLabel = string;

/** 循环切换审批档位时的固定顺序（/approvals）。 */
export const APPROVAL_ORDER = ['read-only', 'auto-edit', 'full'] as const;

const APPROVAL_LABELS: Record<string, string> = {
  'read-only': '只读',
  'auto-edit': '自动编辑',
  full: '全部放行',
};

export function approvalLabel(mode: string): string {
  return APPROVAL_LABELS[mode] ?? mode;
}

const TOOL_LABELS: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  list_dir: '列出目录',
  jobs: '后台任务',
  todo_write: '更新待办',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `调用 ${name}`;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

export function permissionLabel(kind: string): string {
  return PERMISSION_LABELS[kind] ?? kind;
}

export const SPINNER_VERBS = ['思考中', '推敲中', '酝酿中', '翻找中', '梳理中', '盘算中'];
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Last part of `text` that fits maxWidth display columns (CJK counts 2). The
 * REPL reasoning tail is rewritten in place with `\r\x1b[2K`, which clears
 * exactly ONE physical row — an overlong tail would wrap and leave stale
 * garbage above, so it must be width-trimmed before writing.
 */
export function fitTail(text: string, maxWidth: number): string {
  const chars = [...text];
  let total = 0;
  let start = chars.length;
  while (start > 0) {
    const w = styledWidth(chars[start - 1] ?? '');
    if (total + w > maxWidth) break;
    total += w;
    start -= 1;
  }
  return chars.slice(start).join('');
}

/** codex 同款状态指示文本：`思考中 (3.2s · Esc 中断)`。 */
export function statusIndicator(streaming: boolean, elapsedMs: number, verbIndex: number): string {
  if (!streaming) return '输入';
  const verb = SPINNER_VERBS[Math.floor(verbIndex / SPINNER_FRAMES.length) % SPINNER_VERBS.length] ?? '思考中';
  const secs = (elapsedMs / 1000).toFixed(1);
  return `${verb} (${secs}s · Esc 中断)`;
}

export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private frame = 0;

  constructor(private readonly enabled: boolean) {}

  start(): void {
    if (!this.enabled) return;
    this.stop();
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      this.frame += 1;
      const frame = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      const verb = SPINNER_VERBS[Math.floor(this.frame / SPINNER_FRAMES.length) % SPINNER_VERBS.length] ?? '思考中';
      const secs = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      process.stdout.write(`\r\x1b[2m${frame} ${verb}… ${secs}s\x1b[0m\x1b[0K`);
    }, 90);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    process.stdout.write('\r\x1b[0K');
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * One-glance summary of a tool call's key argument: the file path for fs
 * tools, the command line for bash, action+id for jobs — never raw JSON.
 */
export function toolArgSummary(name: string, rawArgs: string, max = 72): string {
  let args: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>;
  } catch {
    // fall through to the raw clip
  }
  if (args !== undefined) {
    const str = (key: string): string | undefined => {
      const v = args?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const keyed =
      str('path') ??
      str('command') ??
      str('name') ??
      (name === 'jobs'
        ? [str('action'), str('id')].filter((s) => s !== undefined).join(' ') || undefined
        : undefined) ??
      (name === 'todo_write' && Array.isArray(args['todos']) ? `${args['todos'].length} 项待办` : undefined) ??
      Object.values(args).find((v): v is string => typeof v === 'string' && v.length > 0);
    if (keyed !== undefined && keyed.length > 0) return clip(keyed, max);
  }
  return clip(rawArgs, max);
}

/** 只读探索类工具：完成的调用按 codex "Explored" 语义折叠成分组行。 */
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir']);

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

/**
 * `    ⠙ 执行命令 pnpm test` —— 工具运行中。圆点可动画（braille 帧），
 * 动词粗体、对象高亮，与 codex 的 "Running/Explored" 行同构。
 */
export function toolStartLine(p: Palette, name: string, rawArgs: string, frame = '•'): string {
  return `    ${p.dim(frame)} ${p.bold(toolLabel(name))} ${p.cyan(toolArgSummary(name, rawArgs))}`;
}

export function isFailureContent(content: string): boolean {
  return (
    content.startsWith('Error') ||
    content.startsWith('Permission denied') ||
    /(^|\n)exit: [1-9]/.test(content) ||
    content.includes('did not exit')
  );
}

/**
 * Collapsed tool outcome, one line on success:
 * `    ✓ 读取文件 src/a.ts · 42 行 · 0.1s`
 * Failures hang the first error line off a dim tree prefix.
 */
export function toolDoneLine(p: Palette, name: string, rawArgs: string, content: string, durationMs: number): string[] {
  const label = `${p.bold(toolLabel(name))} ${p.cyan(toolArgSummary(name, rawArgs))}`;
  const secs = p.dim(` · ${(durationMs / 1000).toFixed(1)}s`);
  const flat = content
    .replaceAll('\r', '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (isFailureContent(content)) {
    const lines = [`    ${p.red('✗')} ${label}${secs}`];
    // bash results lead with bare `exit: N` / `stdout:` markers; the
    // informative error line is the first one carrying actual content. The
    // `(empty)` stdout placeholder is not information — when a command fails
    // with no output at all, surface the exit code instead.
    const first = flat.find((l) => !/^exit: \d+$/.test(l) && !/^(stdout|stderr):\s*$/.test(l) && l !== '(empty)');
    if (first !== undefined) {
      lines.push(`      ${p.dim(`└ ${clip(first, 100)}`)}`);
    } else {
      const code = /exit: (\d+|null)/.exec(content)?.[1];
      lines.push(`      ${p.dim(`└ 命令无输出${code !== undefined ? `（退出码 ${code}）` : ''}`)}`);
    }
    return lines;
  }
  let meta = '';
  if (flat.length === 1) meta = ` · ${clip(flat[0] ?? '', 60)}`;
  else if (flat.length > 1) meta = ` · ${flat.length} 行`;
  return [`    ${p.green('✓')} ${label}${p.dim(meta)}${secs}`];
}

/**
 * `    ✓ 查看 a.ts, b.ts · 3 次 · 0.5s` —— codex "Explored" 式分组行：连续的
 * 只读调用折叠为一行，名字列表超宽时截断。
 */
export function toolGroupLine(p: Palette, entries: string[], durationMs: number): string {
  let names = entries.join(', ');
  if (names.length > 80) names = `${names.slice(0, 80)}…`;
  const secs = p.dim(` · ${entries.length} 次 · ${(durationMs / 1000).toFixed(1)}s`);
  return `    ${p.green('✓')} ${p.bold('查看')} ${p.cyan(names)}${secs}`;
}

export type StopKind = 'complete' | 'max_turns' | 'aborted';

const STOP_WORD: Record<StopKind, { word: string; paint: keyof Palette }> = {
  complete: { word: '✓ 完成', paint: 'green' },
  max_turns: { word: '! 已达最大轮数', paint: 'yellow' },
  aborted: { word: '■ 已中断', paint: 'yellow' },
};

export function humanTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** `  ✓ 完成 · 2 轮 · ↑2.9k ↓132 tok · 缓存 53% · 4.2s` —— 一轮结束后的单行小结。 */
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

/**
 * Context-pressure bar for the status line: filled cells show how close the
 * next-prompt estimate is to the auto-compact limit.
 */
export function contextBar(ratio: number, cells = 8): string {
  const filled = Math.max(0, Math.min(cells, Math.round(ratio * cells)));
  return '█'.repeat(filled) + '░'.repeat(cells - filled);
}

/** 彩色极简欢迎头（不用制表框，避免中英混排对不齐）。 */
export function banner(
  p: Palette,
  info: { model: string; approval: string; plugins: string; sessionFile: string; rootDir: string },
): void {
  const relSession = sessionRelPath(info.rootDir, info.sessionFile);
  console.log();
  console.log(`  ${p.cyan(p.bold('Nova'))} ${p.dim('v0.1.0 — 本地编码助手')}`);
  console.log(p.dim(`  模型 ${info.model} · 审批 ${approvalLabel(info.approval)} · 插件 ${info.plugins}`));
  console.log(p.dim(`  工作区 ${info.rootDir} · 会话 ${relSession}`));
  console.log(p.dim(`  输入 / 唤起命令面板 · Ctrl+C 中断当前轮（空闲时退出）`));
  console.log();
}

function sessionRelPath(rootDir: string, file: string): string {
  const normalizedRoot = rootDir.replaceAll('\\', '/');
  const normalizedFile = file.replaceAll('\\', '/');
  return normalizedFile.startsWith(`${normalizedRoot}/`) ? normalizedFile.slice(normalizedRoot.length + 1) : file;
}

// ---- 多行 composer 布局（纯函数，无 ANSI；输入已被粘贴清洗过）--------------

export interface ComposerWrap {
  /** 软换行后的所有显示行。 */
  rows: string[];
  /** 光标所在行号。 */
  caretRow: number;
  /** 光标左侧在该行内占用的显示列数。 */
  caretCol: number;
  /** 每行首字符在 input 中的 UTF-16 偏移（跨行移动光标时换算用）。 */
  rowStart: number[];
}

/**
 * 按「显式换行 + 宽度软换行」把输入拆成显示行，并同步定位光标。单趟
 * O(n)：旧实现的横向窗口每帧都要对光标前的整段文本重算宽度（O(n²)），
 * 一次大粘贴就能把 UI 卡死。
 */
export function wrapComposer(input: string, cursorPos: number, width: number): ComposerWrap {
  const w = Math.max(1, width);
  const rows: string[] = [];
  const rowStart: number[] = [];
  let cur = '';
  let curW = 0;
  let curStart = 0;
  let units = 0; // 已消费的 UTF-16 单元数
  let caretRow = 0;
  let caretCol = 0;
  let caretSeen = false;
  const closeRow = (): void => {
    rows.push(cur);
    rowStart.push(curStart);
    cur = '';
    curW = 0;
  };
  for (const ch of input) {
    // 光标停在某个字符之前；units 恰好等于 cursorPos 时即为该处。
    if (!caretSeen && units >= cursorPos) {
      caretRow = rows.length;
      caretCol = curW;
      caretSeen = true;
    }
    if (ch === '\n') {
      closeRow();
      units += 1;
      curStart = units;
      continue;
    }
    const cw = styledWidth(ch);
    if (curW > 0 && curW + cw > w) {
      closeRow();
      curStart = units;
    }
    cur += ch;
    curW += cw;
    units += ch.length;
  }
  if (!caretSeen) {
    caretRow = rows.length;
    caretCol = curW;
  }
  closeRow(); // 末行即使为空也要落盘（空输入 → 一行空行 + 行首光标）
  return { rows, caretRow, caretCol, rowStart };
}

export interface ComposerRow {
  text: string;
  /** 光标在该行文本内的 UTF-16 偏移；-1 表示光标不在这一行。 */
  caretIdx: number;
}

export interface ComposerLayout {
  rows: ComposerRow[];
  /** 光标行在 `rows`（可见窗口）中的下标。 */
  cursorRow: number;
  /** 光标左侧列数（不含 composer 前缀）。 */
  cursorCol: number;
  totalRows: number;
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * 在 wrapComposer 之上取「光标附近最多 maxRows 行」的可见窗口；光标行永远
 * 在窗口内，上下溢出行数以 hiddenAbove/Below 报给调用方渲染提示行。
 */
export function layoutComposer(input: string, cursorPos: number, width: number, maxRows: number): ComposerLayout {
  const wrap = wrapComposer(input, cursorPos, width);
  const total = wrap.rows.length;
  const max = Math.max(1, maxRows);
  const start = total <= max ? 0 : Math.max(0, Math.min(wrap.caretRow - (max - 1), total - max));
  const slice = wrap.rows.slice(start, start + max);
  const rows: ComposerRow[] = slice.map((text) => ({ text, caretIdx: -1 }));
  if (wrap.caretRow >= start && wrap.caretRow < start + slice.length) {
    rows[wrap.caretRow - start] = { text: slice[wrap.caretRow - start] ?? '', caretIdx: caretIdxInRow(slice[wrap.caretRow - start] ?? '', wrap.caretCol) };
  }
  return {
    rows,
    cursorRow: Math.max(0, Math.min(slice.length - 1, wrap.caretRow - start)),
    cursorCol: wrap.caretCol,
    totalRows: total,
    hiddenAbove: start,
    hiddenBelow: Math.max(0, total - (start + slice.length)),
  };
}

/** 显示列数 → 该行内 UTF-16 偏移；超过行宽时返回行尾。 */
function caretIdxInRow(text: string, caretCol: number): number {
  let acc = 0;
  let units = 0;
  for (const ch of text) {
    if (acc >= caretCol) return units;
    acc += styledWidth(ch);
    units += ch.length;
  }
  return text.length;
}

/**
 * 多行输入下 ↑/↓ 的光标移动：保持可视列位置，目标行更短则落到行尾
 * （换行符之前）。单行输入不应调用（会绕过历史导航）。
 */
export function cursorAfterVerticalMove(input: string, cursorPos: number, width: number, delta: number): number {
  const wrap = wrapComposer(input, cursorPos, width);
  const target = Math.max(0, Math.min(wrap.rows.length - 1, wrap.caretRow + delta));
  if (target === wrap.caretRow) return cursorPos;
  const idx = caretIdxInRow(wrap.rows[target] ?? '', wrap.caretCol);
  return (wrap.rowStart[target] ?? 0) + idx;
}
