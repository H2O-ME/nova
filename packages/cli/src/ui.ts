/** 终端渲染辅助：配色、汉化标签、状态指示、工具块与状态行。 */

import { styledWidth } from '@nova-agent/tui';

export interface Palette {
  dim(text: string): string;
  cyan(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  blue(text: string): string;
  magenta(text: string): string;
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
  blue: ansi('34'),
  magenta: ansi('35'),
  bold: ansi('1'),
};

/** 非 TTY 输出的无样式配色。 */
export const plainPalette: Palette = {
  dim: (text) => text,
  cyan: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  red: (text) => text,
  blue: (text) => text,
  magenta: (text) => text,
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
  search_files: '搜索工作区',
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
      (name === 'search_files' ? str('content_regex') ?? str('name_glob') : undefined) ??
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
const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'search_files']);

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

/**
 * Token 数可读化：小数值留一位小数（1.1k），整千去掉 `.0`（1k），
 * 万级取整（58k），百万级用 M（1050000 → 1.05M，128000 → 128k）。
 * 旧实现 `1050.0k` 这种四位带小数的写法在状态栏里既长又难扫读。
 */
export function humanTokens(n: number): string {
  const trim = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim((n / 1000).toFixed(1))}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${trim((n / 1_000_000).toFixed(2))}M`;
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

// ---- 上下文窗口结构进度条（纯计算，无 ANSI）------------------------------

/** 一个结构段（提示词/工具/注入/技能/消息）的 token 数与颜色。 */
export interface ContextSegment {
  label: string;
  tokens: number;
  color: 'cyan' | 'green' | 'yellow' | 'blue' | 'magenta';
}

/**
 * 把 `cells` 个格子按 largest-remainder 分给各权重（token 数），保证：
 * 格子总数恒等于 cells（含最后的空闲段）、非负权重不产生负格子、
 * 零权重段不占格。返回与 weights 等长的整数数组。
 */
export function allocateCells(weights: number[], cells: number): number[] {
  if (cells <= 0) return weights.map(() => 0);
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = clean.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return clean.map(() => 0);
  const exact = clean.map((w) => (w / total) * cells);
  const base = exact.map((v) => Math.floor(v));
  let left = cells - base.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ rem: v - Math.floor(v), i }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}

/**
 * 结构段列表 → 渲染描述：每段得到的格子数 + 剩余空闲格子。
 * 严格按整窗比例分摊：每段格子 ≈ tokens/capacity × cells，空闲容量作为
 * 最后一项参与同一轮 largest-remainder。不做"非零段至少 1 格"的借位——
 * 1.2k 工具在 1M 窗口里按真实比例就是 0 格，强行画一格会让条的已用填充
 * 与旁边的 `used/capacity · pct%` 数字打架（2.4k 用量被画成两成满）。
 * 微量占比如实画成空格，比例由格子数本身说话。
 */
export function planContextSegments(
  segments: ContextSegment[],
  capacity: number,
  cells: number,
): { counts: number[]; freeCells: number; ratio: number; over: boolean } {
  const weights = segments.map((s) => Math.max(0, s.tokens));
  const used = weights.reduce((sum, w) => sum + w, 0);
  const over = capacity > 0 && used > capacity;
  const ratio = capacity > 0 ? used / capacity : 0;
  const counts = over
    ? allocateCells(weights, cells)
    : allocateCells([...weights, Math.max(0, capacity - used)], cells).slice(0, segments.length);
  const painted = counts.reduce((sum, c) => sum + c, 0);
  return { counts, freeCells: Math.max(0, cells - painted), ratio, over };
}

/**
 * 渲染分段上下文条：每段用 '█' 按 `planContextSegments` 分到的格子数上色
 * （cyan/green/blue/magenta/yellow），尾部补 dim '░' 空闲格。超窗（`over`）
 * 时最后一段用红——消息永远是先膨胀的那一段，红线即"你正在逼近窗口上限"。
 */
export function segmentBar(
  p: Palette,
  segments: ContextSegment[],
  counts: number[],
  freeCells: number,
  over: boolean,
): string {
  let bar = '';
  for (let i = 0; i < segments.length; i++) {
    const n = counts[i] ?? 0;
    if (n <= 0) continue;
    const fill = '█'.repeat(n);
    const last = i === segments.length - 1;
    bar += over && last ? p.red(fill) : p[segments[i]!.color](fill);
  }
  if (freeCells > 0) bar += p.dim('░'.repeat(freeCells));
  return bar;
}

/**
 * 结构段图例：每段标签用该段条上的同色标注（"提示词 1.1k · 工具 1.2k ·
 * 技能 84 · 消息 22"），色块与文字一眼对上；plainPalette 下退化为纯文本。
 */
export function contextLegend(p: Palette, segments: ContextSegment[]): string {
  return segments.map((s) => `${p[s.color](s.label)} ${humanTokens(s.tokens)}`).join(' · ');
}

// ---- 状态栏降级形态（单行三档：T0 全量 / T1 去冗 / T2 最简）-----------------

/** 状态栏字段的降级层级：0 全量 → 2 最简（整字段降档，不做词中截断）。 */
export type StatusTier = 0 | 1 | 2;

const APPROVAL_SHORT: Record<string, string> = {
  'read-only': '读',
  'auto-edit': '编',
  full: '全',
};

/** 审批档位的风险色：越放权越暖，与上下文百分比的红黄绿同一语义轴。 */
const APPROVAL_RISK: Record<string, 'green' | 'yellow' | 'red'> = {
  'read-only': 'green',
  'auto-edit': 'yellow',
  full: 'red',
};

/**
 * 审批档位芯片：T0 `审批 自动编辑` → T1 去前缀（值词本身可辨）按风险着色
 * → T2 单字（读/编/全）。窄屏下"审批"前缀占 6 列却最可推断，最先砍。
 */
export function approvalChip(p: Palette, mode: string, tier: StatusTier): string {
  if (tier === 0) return `审批 ${approvalLabel(mode)}`;
  const word = tier === 1 ? approvalLabel(mode) : (APPROVAL_SHORT[mode] ?? approvalLabel(mode));
  const risk = APPROVAL_RISK[mode];
  return risk ? p[risk](word) : word;
}

/** 模型短名：供应商前缀（`anthropic/…`）去掉，尾段即身份。 */
export function modelTail(model: string): string {
  const tail = model.split('/').at(-1) ?? model;
  return tail.length > 0 ? tail : model;
}

export interface ContextGaugeView {
  segments: ContextSegment[];
  used: number;
  capacity: number | undefined;
  /** autoCompactTokenLimit；缺省不显示压缩段。 */
  compact: number | undefined;
}

/**
 * 一次分解产出三档上下文仪表，供状态栏按剩余空间选档：
 * - T0 `上下文 [条] 已用/总量 · 百分比 · 压缩 %`
 * - T1 同上，但压缩% 只在 ≥50% 时出现（17% 的压缩进度是噪音，不是信息）
 * - T2 `[条] 百分比`——label 与绝对数去掉（/session 有明细），仅压缩 ≥70%
 *   即临发时保留警告；条格子收窄。
 * 百分比定宽（padStart 2）——9%→10% 这类位数跳变不再挪动分隔符。
 */
export function contextGaugeForms(
  p: Palette,
  v: ContextGaugeView,
  cols: number,
): [string, string, string] {
  const r = v.compact !== undefined && v.compact > 0 ? v.used / v.compact : undefined;
  const compactTag = (show: boolean): string =>
    r === undefined || !show
      ? ''
      : ` · ${r >= 1 ? p.red(`压缩 ${Math.round(r * 100)}%`) : r >= 0.7 ? p.yellow(`压缩 ${Math.round(r * 100)}%`) : p.dim(`压缩 ${Math.round(r * 100)}%`)}`;
  if (v.capacity === undefined || v.capacity <= 0) {
    const head = `  ${p.dim('上下文')} ${p.bold(humanTokens(v.used))}${p.dim(' tok · 窗口未知')}`;
    return [`${head}${compactTag(true)}`, `${head}${compactTag(r !== undefined && r >= 0.5)}`, head];
  }
  const capacity = v.capacity;
  const form = (tier: StatusTier): string => {
    const cells =
      tier === 2
        ? Math.max(6, Math.min(16, cols - 70))
        : Math.max(8, Math.min(24, cols - 118));
    const { counts, freeCells, ratio, over } = planContextSegments(v.segments, capacity, cells);
    const bar = segmentBar(p, v.segments, counts, freeCells, over);
    const pct = Math.round(ratio * 100).toString().padStart(2, ' ');
    const pctColor = over || ratio >= 1 ? p.red : ratio >= 0.7 ? p.yellow : p.green;
    const pctTag = ` · ${pctColor(`${pct}%`)}`;
    if (tier === 2) return `  ${bar}${pctTag}${compactTag(r !== undefined && r >= 0.7)}`;
    const nums = p.bold(`${humanTokens(v.used)}/${humanTokens(capacity)}`);
    const line = `  ${p.dim('上下文')} ${bar} ${nums}${pctTag}`;
    return tier === 0 ? `${line}${compactTag(true)}` : `${line}${compactTag(r !== undefined && r >= 0.5)}`;
  };
  return [form(0), form(1), form(2)];
}

// ---- 极简仪表（借鉴"可观察的 Agent 状态"设计）---------------------------

const SPARK_CELLS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** 数值序列 → sparkline（▁▂▄█）：按序列最大值归一，0 画最低格。 */
export function sparkline(samples: number[]): string {
  const max = Math.max(1, ...samples);
  return samples
    .map((v) => {
      if (v <= 0) return SPARK_CELLS[0]!;
      const idx = Math.min(
        SPARK_CELLS.length - 1,
        Math.round((v / max) * (SPARK_CELLS.length - 1)),
      );
      return SPARK_CELLS[idx]!;
    })
    .join('');
}

/**
 * `left …… right` 的右贴边布局：right 钉在行尾（第 width 列前），空间不足
 * 时退化成一个空格分隔（调用侧仍有 clip 兜底）。ctx 行的"已用/总量 · 百分比"
 * 与 cache 率都靠这个钉在右缘——左端稳定字段因此永不被右侧变化推着走。
 */
export function padBetween(left: string, right: string, width: number): string {
  const gap = width - styledWidth(left) - styledWidth(right);
  return gap > 1 ? `${left}${' '.repeat(gap)}${right}` : `${left} ${right}`;
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
