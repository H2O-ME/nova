/**
 * 压缩等待态状态机（阶段 E 出壳 tui-mode）：摘要请求是全会话最慢的单请求
 * （序列化整段 transcript），等待行每秒刷新已耗时——静默的暗行挂几分钟会被
 * 读成卡死；同时持有 Esc 可取消的 AbortController（REPL parity）。定时器由
 * 壳层注入（`every`），类本体不碰 setInterval——假时钟可直测。
 */
import type { Palette } from '@nova-agent/tui-view';
import type { CompactedSession } from '../compact.js';
import type { Block, TuiStore } from './store.js';

export interface CompactWaitDeps {
  store: TuiStore;
  paint(): Palette;
  now(): number;
  render(): void;
  /** 注册 ~500ms 周期回调，返回注销句柄（壳层真表；测试假时钟）。 */
  every(fn: () => void): () => void;
}

export class CompactWait {
  private aborter: AbortController | undefined;
  private cancelled = false;
  private block: Block | undefined;
  private startedAt = 0;
  private stopTick: (() => void) | undefined;

  constructor(private readonly deps: CompactWaitDeps) {}

  /** 开一个摘要请求的 abort 源（Esc/exitApp 可打；每次请求重置 cancelled）。 */
  beginRequest(): AbortController {
    this.aborter = new AbortController();
    this.cancelled = false;
    return this.aborter;
  }

  endRequest(): void {
    this.aborter = undefined;
  }

  /** 进行中的请求是否被用户取消（错误呈现按「已取消」而非失败收场）。 */
  wasCancelled(): boolean {
    return this.cancelled;
  }

  cancel(): void {
    this.cancelled = true;
    this.aborter?.abort();
  }

  /** 退出清理：打断路（不置 cancelled——那是用户取消语义）。 */
  abortActive(): void {
    this.aborter?.abort();
  }

  start(mid: string): void {
    const d = this.deps;
    this.startedAt = d.now();
    this.block = d.store.pushBlock([this.waitLine(mid)]);
    this.stopTick?.();
    this.stopTick = d.every(() => {
      // The summarizer streams like any LLM reply: the caller's `every`
      // implementation samples the tps ring on the same tick so a compacting
      // session shows live speed, not a frozen meter.
      const line = this.waitLine(mid);
      if (this.block !== undefined && this.block.lines[0] !== line) {
        d.store.replaceBlock(this.block, [line]);
      }
      d.render();
    });
  }

  /** 收场：停表并丢掉等待块引用（完成/失败行由调用方另推）。 */
  end(): void {
    this.stopTick?.();
    this.stopTick = undefined;
    this.block = undefined;
  }

  elapsedSecs(): number {
    return Math.max(1, Math.round((this.deps.now() - this.startedAt) / 1000));
  }

  doneLine(outcome: CompactedSession): string {
    const p = this.deps.paint();
    return `${p.green('  ✓ 已压缩')} ${p.dim(`· 摘要 ${outcome.summary.length} 字 · 保留 ${outcome.retained} 条最近消息 · ${this.elapsedSecs()}s`)}`;
  }

  private waitLine(mid: string): string {
    const p = this.deps.paint();
    return `${p.yellow(`  ⋯ ${mid}…`)} ${p.dim(`· ${this.elapsedSecs()}s`)}`;
  }
}
