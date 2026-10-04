/**
 * CLI 行渲染：内核事件 → 终端上可读的一行，只服务 readline REPL 与 exec 的
 * 人读输出。观感归 surface——这一层是 REPL 的全部呈现，浏览器面的呈现是
 * `web/ui`（同一内核事件流的另一家消费者）。
 *
 * 宽度测量走 ./term-text.js（CJK 计 2 列）；文案/颜色/标签在这里定义
 * （core 只拥有 presentation 形状——见 core/presentation.ts）。
 */
import { detectCaps, stringWidth } from './term-text.js';
import {
  DEFAULT_MAX_TURNS,
  isFailureContent,
  toolCallKind,
  type ToolCall,
  type UsageStats,
} from '@nova-agent/core';

export type StopKind = 'complete' | 'max_turns' | 'aborted';

export interface Paint {
  cyan(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  green(text: string): string;
  gray(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
  /** `\r` + erase-line / erase-to-EOL / SGR reset — '' for the plain档. */
  clearLine(): string;
  clearRight(): string;
  reset(): string;
}

const NOOP = (text: string): string => text;
const empty = (): string => '';

/** dark/light 的 ANSI-16 档（truecolor 属于批4 的主题层，过渡期不区分）。 */
function ansiPaint(color: boolean): Paint {
  if (!color) {
    return {
      cyan: NOOP,
      yellow: NOOP,
      red: NOOP,
      green: NOOP,
      gray: NOOP,
      dim: NOOP,
      bold: NOOP,
      clearLine: empty,
      clearRight: empty,
      reset: empty,
    };
  }
  const code = (open: string, text: string): string => `\x1b[${open}m${text}\x1b[0m`;
  return {
    cyan: (t) => code('36', t),
    yellow: (t) => code('33', t),
    red: (t) => code('31', t),
    green: (t) => code('32', t),
    gray: (t) => code('90', t),
    dim: (t) => code('2', t),
    bold: (t) => code('1', t),
    clearLine: () => '\r\x1b[2K',
    clearRight: () => '\x1b[0K',
    reset: () => '\x1b[0m',
  };
}

/** 调色板装配单源：尊重 ui.theme 与 NO_COLOR/TERM=dumb；测试用 plainPaint。 */
export function resolvePaint(theme: 'dark' | 'light' | 'plain' | undefined): Paint {
  const caps = detectCaps();
  if (!caps.color || theme === 'plain') return ansiPaint(false);
  return ansiPaint(true);
}

export const plainPaint: Paint = ansiPaint(false);

/** 工具的中文标签（surface 文案；精简表）。 */
const TOOL_LABELS: Record<string, string> = {
  bash: '命令',
  read_file: '读取',
  write_file: '写入',
  edit_file: '编辑',
  search_files: '搜索',
  list_dir: '列目录',
  run_code: '执行代码',
  todo_write: '计划',
  jobs: '任务',
  subagent: '子代理',
  skill: '技能',
  get_time: '时间',
  workspace: '切换工作区',
};

/** `Object.hasOwn` because the name is model output: a bare index would resolve `constructor` to an inherited member. */
export function toolLabel(name: string): string {
  return Object.hasOwn(TOOL_LABELS, name) ? TOOL_LABELS[name] as string : toolCallKind(name);
}

/** 按显示列数截尾（保留开头；CJK 计 2 列， ANSI 码忽略）。 */
export function clipToCols(text: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  if (stringWidth(text) <= maxCols) return text;
  let out = '';
  for (const char of text) {
    if (stringWidth(out + char) > maxCols - 1) return `${out}…`;
    out += char;
  }
  return out;
}

/** 参数摘要：压平空白后按显示列数截断。 */
export function toolArgSummary(rawArgs: string, maxCols: number): string {
  const flat = rawArgs.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  return clipToCols(flat, maxCols);
}

/**
 * 一行终端文本的卫生：控制码点变成可见转义，绝不原样落到终端上。
 *
 * 转义而不是丢弃：`\r` 与 `\u001b` 是**注入**，不是排版——原样输出就能用回车覆盖掉
 * 前面已经打印的字，或用 ANSI 序列把终端的颜色/标题/光标状态改掉。而丢弃会让「为什么」
 * 少一截，读的人以为原因本来就是那样。所以 `\n` → `\\n`、`\t` → `\\t`、ESC 与其余
 * C0 / DEL / C1 控制码 → `\\xNN`，全是**可读文本**，一个字都不生效。
 *
 * 实现**只有一份，住在 core**（`core/src/text.ts` 的 `oneLineText`）：把它留在这里等于
 * 让内核的日志出口（`core/plugin/context.ts` 的 defaultLog，每个 surface 都经它写
 * stderr）要么看不见它、要么在 core 里再抄一份。依赖方向是 `cli → core`，所以本文件
 * **再导出**而不是自己实现——**对外 API 不变**（`oneLineText` 的名字与签名原样），
 * 本包所有调用点（`command-core.ts` / `plugin-report.ts`）以及第三方 surface 的导入
 * 一句都不用改。
 *
 * 这些字来自插件界面的数据（模块加载错误、config 校验错误：名字与内容都不由宿主决定），
 * 所以每一个把它们画进终端行的调用点都必须先过这里，而不是指望上游「大概是干净的」。
 */
export { oneLineText } from '@nova-agent/core';

/** 工具开始行：`  ⠙ 命令 git status`（运行帧由调用方给）。 */
export function toolStartLine(p: Paint, call: ToolCall, budget = 72): string {
  const label = p.bold(toolLabel(call.name));
  return `  ${p.cyan('⠙')} ${label} ${p.cyan(toolArgSummary(call.rawArgs, budget))}`;
}

/** 工具完成行（多行）：成功一行；失败附首行错误（红色）。 */
export function toolDoneLines(
  p: Paint,
  call: ToolCall,
  content: string,
  durationMs: number,
  budget = 72,
): string[] {
  const failed = isFailureContent(content);
  const mark = failed ? p.red('✗') : p.green('✓');
  const head = `  ${mark} ${p.bold(toolLabel(call.name))} ${toolArgSummary(call.rawArgs, budget)}${p.gray(` · ${(durationMs / 1000).toFixed(1)}s`)}`;
  if (!failed) return [head];
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? '';
  return [head, `  ${p.red('▌')} ${p.red(firstLine)}`];
}

// 文案表（观感归 surface）：只留 readline/exec 需要的最小集。

/** /approvals 的固定循环序。 */
export const APPROVAL_ORDER = ['read-only', 'auto-edit', 'full'] as const;

const APPROVAL_LABELS: Record<string, string> = {
  'read-only': '只读',
  'auto-edit': '自动编辑',
  full: '全部放行',
};

export function approvalLabel(mode: string): string {
  return Object.hasOwn(APPROVAL_LABELS, mode) ? APPROVAL_LABELS[mode] as string : mode;
}

const PERMISSION_LABELS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

export function permissionLabel(kind: string): string {
  return Object.hasOwn(PERMISSION_LABELS, kind) ? PERMISSION_LABELS[kind] as string : kind;
}

/** Pad to display width (CJK counts 2); overlong input passes through. */
export function padDisplay(text: string, width: number): string {
  const pad = Math.max(0, width - stringWidth(text));
  return text + ' '.repeat(pad);
}

/** Bash 实时输出尾行缓冲预算。 */
export const TOOL_TAIL_KEEP_CHARS = 8000;

/** 尾对齐截断：保留末尾 maxCols 个显示列（转轮尾行从旧文本长出新文本）。 */
export function fitTail(text: string, maxCols: number): string {
  const chars = [...text];
  let total = 0;
  let start = chars.length;
  while (start > 0) {
    const w = stringWidth(chars[start - 1] ?? '');
    if (total + w > maxCols) break;
    total += w;
    start -= 1;
  }
  return chars.slice(start).join('');
}

/** 转轮帧与动词（90ms 帧周期）。 */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const SPINNER_VERBS = ['思考中', '推敲中', '酝酿中', '翻找中', '梳理中', '盘算中'];
export const SPINNER_TICK_MS = 90;

/** 审批提问行正文（repl 行内 y/a/n；always 记忆语义的尾注同此单源）。 */
export function approvalPromptText(
  kind: string,
  tool: string,
  argsPreview: string,
): { prompt: string; alwaysScopeNote: string } {
  return {
    prompt: `允许${permissionLabel(kind)} · ${tool} ${argsPreview} [y] 本次允许 / [a] 总是允许 / [n] 拒绝：`,
    alwaysScopeNote:
      kind === 'execute'
        ? '（always 按命令程序前缀记忆，如 git status → 放行后续 git …；含 &&/;/| 的复合命令只按整条放行）'
        : '',
  };
}

/** 上游断流重试与空补全提示（旧 runner-loop 文案，收进 surface 层）。 */
export function retryNotice(error: string, attempt: number, maxRetries: number): string {
  return `上游流中断（${error}），自动重试 ${attempt}/${maxRetries}…`;
}

export function emptyCompletionNotice(finishReason: string, attempt: number, maxRetries: number): string {
  return `空回复（finish=${finishReason}，输出疑似全部进入思考流），自动重试 ${attempt}/${maxRetries}…`;
}

export function maxTurnsHint(maxTurns: number | undefined): string {
  return `  已达 maxTurns 上限（当前 ${maxTurns ?? DEFAULT_MAX_TURNS}，可在 ~/.nova/config.json 调大后继续）`;
}

/** 工具调用计时（tool_call_start → tool_call_result 的显示耗时）。 */
export class ToolTiming {
  private readonly starts = new Map<string, number>();

  start(callId: string): void {
    this.starts.set(callId, Date.now());
  }

  /** Elapsed ms since start; 0 when the start was never seen. Unknown-safe. */
  finish(callId: string): number {
    const started = this.starts.get(callId) ?? 0;
    this.starts.delete(callId);
    return Math.max(0, started === 0 ? 0 : Date.now() - started);
  }
}

/** Token 数的人读缩写：`2900 → 2.9k`、`128000 → 128k`、`1500000 → 1.5M`. */
export function humanTokens(n: number): string {
  const trim = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim((n / 1000).toFixed(1))}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${trim((n / 1_000_000).toFixed(2))}M`;
}

/** Minimal brand header (REPL；浏览器界面有自己的开屏页). */
export function banner(
  p: Paint,
  info: { model: string; approval: string; plugins: string; sessionFile: string; rootDir: string; version: string },
): void {
  console.log();
  console.log(`  ${p.cyan(p.bold('Nova'))} ${p.dim(`v${info.version} — 本地编码助手`)}`);
  console.log(p.dim(`  模型 ${info.model} · 审批 ${info.approval} · 插件 ${info.plugins}`));
  console.log(p.dim(`  工作区 ${info.rootDir} · 会话 ${info.sessionFile}`));
  console.log(p.dim('  输入 /help 查看命令 · Ctrl+C 中断当前轮（空闲时退出）'));
  console.log();
}

/** 结束状态行（完成行带 tok/缓存命中摘要；异常停只给一行短句）。 */
export function statusLine(p: Paint, kind: StopKind, stats: UsageStats, elapsedMs: number): string {
  const seconds = Math.max(0.1, elapsedMs / 1000);
  if (kind === 'aborted') return p.yellow('已中断');
  if (kind === 'max_turns') return p.yellow('已达 maxTurns 上限');
  const hit = stats.promptTokens > 0 ? Math.round((stats.cachedTokens / stats.promptTokens) * 100) : 0;
  return p.green(
    `完成 · ${stats.turns} 轮 · ↑${humanTokens(stats.promptTokens)} ↓${humanTokens(stats.completionTokens)} tok · 缓存 ${hit}% · ${seconds.toFixed(1)}s`,
  );
}
