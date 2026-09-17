/**
 * REPL 瞬态进度渲染单主（M9.5 阶段 F 出壳）：spinner 生命周期、推理流
 * 尾行、bash 实时输出尾行、嵌套子代理进度暗行——四者共享同一条契约：
 * 它们是「会被 `\r\x1b[2K` 原位擦除的一次性行」，写之前必须裁进单显示行
 * 预算（折行的垃圾不会被下一次 `\r` 擦掉），且无颜色/非 TTY 时整体跳过。
 *
 * 类不碰定时器也不碰 process.*：spinner/write/writeln/cols/paint 全部注入，
 * 行契约可用假 writer 直接测试。spinner.stop 的擦行序（`\r\x1b[0K`）留在
 * Spinner 本体——中断路径的既有观感以它为准，这里逐字沿用。
 */
import { styledWidth } from '@nova-agent/tui';
import type { SubagentProgress } from '@nova-agent/core';
import { fitTail, TOOL_TAIL_KEEP_CHARS, type Palette } from '@nova-agent/tui-view';

export interface ReplProgressDeps {
  /** 当前调色板（/theme 运行中可变——访问器而非值拷贝）。 */
  paint(): Palette;
  /** NO_COLOR / 非 TTY：瞬态行与子代理明细行整体跳过。 */
  useColor: boolean;
  spinner: { start(): void; stop(): void };
  /** 原位写（不产生换行）：瞬态行与流式正文。 */
  write(chunk: string): void;
  /** 落一行（自动换行）：重试提示、工具行、子代理进度。 */
  writeln(line: string): void;
  /** 终端列数（缺省回落由调用方给）。 */
  cols(): number;
}

export class ReplProgress {
  private reasoningTail = '';
  private reasoningLive = false;
  private progressTail = '';
  private progressLive = false;
  /**
   * 最近一次前台 `subagent` 父调用 id：只有它绑定期间子代理进度才成行
   * （其他父工具的嵌套调用——如 PTC run_code 派发 read_file——不得借道
   * 显形）。tool_call_start 钉上、tool_call_result 解除；标签会重复，
   * 调用 id 不会。
   */
  private subagentCallId: string | undefined;

  constructor(private readonly deps: ReplProgressDeps) {}

  startTurn(): void {
    this.deps.spinner.start();
  }

  /** 一轮用户请求开始前：清推理尾（与出壳前的复位点逐字同位）。 */
  resetReasoning(): void {
    this.reasoningTail = '';
  }

  /** 落任何永久行之前擦掉瞬态行尾（重试提示、错误行、done 行…）。 */
  beforeRow(): void {
    this.endReasoning();
    this.deps.spinner.stop();
  }

  onText(text: string): void {
    this.beforeRow();
    this.deps.write(text);
  }

  onReasoning(text: string): void {
    const { useColor, spinner, write, cols } = this.deps;
    if (!useColor) return;
    spinner.stop();
    // 单行暗色状态显示推理流尾（DeepSeek reasoner 式）：换行折成 ⏎，
    // 尾段裁进「一行减前缀」的列预算。
    const maxCols = Math.max(10, cols() - styledWidth('  ⋯ ') - 1);
    this.reasoningTail = fitTail(`${this.reasoningTail}${text}`.replaceAll('\n', ' ⏎ '), maxCols);
    write(`\r\x1b[2K\x1b[2m  ⋯ ${this.reasoningTail}`);
    this.reasoningLive = true;
  }

  /** 工具调用开始：擦推理行尾、停表、清输出尾、重绑子代理门闩。 */
  onToolCallStart(name: string, callId: string): void {
    this.beforeRow();
    this.progressTail = '';
    this.subagentCallId = name === 'subagent' ? callId : undefined;
  }

  /** bash 实时输出尾行：与推理行同一契约（单物理行、\r\x1b[2K 可擦）。 */
  onToolProgress(text: string): void {
    const { useColor, write, cols } = this.deps;
    if (!useColor) return;
    // 缓冲预算与 TUI 工具尾行同源 TOOL_TAIL_KEEP_CHARS（此前 repl 手滚
    // 2000 的第二套实现；显示仍被 fitTail 裁到单行，观感不变）。
    this.progressTail = (this.progressTail + text).slice(-TOOL_TAIL_KEEP_CHARS);
    const last = this.progressTail.slice(this.progressTail.lastIndexOf('\n') + 1).trimEnd();
    if (last.length === 0) return;
    const maxCols = Math.max(10, cols() - styledWidth('  └ ') - 1);
    write(`\r\x1b[2K\x1b[2m  └ ${fitTail(last, maxCols)}\x1b[0m`);
    this.progressLive = true;
  }

  /** 工具调用结束：擦输出尾行、解除子代理门闩。 */
  onToolCallEnd(): void {
    this.clearProgress();
    this.subagentCallId = undefined;
  }

  /** 嵌套子代理进度：一次生命周期一行暗色（门闩未绑定期整体静默）。 */
  onSubagentProgress(progress: SubagentProgress): void {
    const { useColor, paint, writeln } = this.deps;
    if (!useColor || this.subagentCallId === undefined) return;
    if (progress.type === 'start') {
      writeln(paint().dim(`    ⧉ 子代理 ${progress.label} 启动…`));
    } else if (progress.type === 'tool_call') {
      writeln(paint().dim(`    ⧉ ${progress.label} › ${progress.call.name}`));
    } else if (progress.type === 'done') {
      const u = progress.usage;
      writeln(
        paint().dim(`    ⧉ ${progress.label} 完成 · ${u.turns} 轮 · ${u.toolCalls} 工具 · ${u.promptTokens + u.completionTokens} tok · ${(u.elapsedMs / 1000).toFixed(1)}s`),
      );
    }
  }

  endReasoning(): void {
    if (this.reasoningLive) {
      this.deps.write('\x1b[0m\n');
      this.reasoningLive = false;
    }
  }

  /** 擦掉 `└ tail` 输出尾行，让下一次打印从干净行开始。 */
  clearProgress(): void {
    if (this.progressLive) {
      this.deps.write('\r\x1b[2K');
      this.progressLive = false;
    }
  }

  /** 轮正常收尾：瞬态行全部落定。 */
  endTurn(): void {
    this.endReasoning();
    this.clearProgress();
    this.deps.spinner.stop();
  }

  /** 出错/中断路径（出壳前 catch 块的 spinner.stop + clearProgress 原样）。 */
  onAbort(): void {
    this.deps.spinner.stop();
    this.clearProgress();
  }
}
