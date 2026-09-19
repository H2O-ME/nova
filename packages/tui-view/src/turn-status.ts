/**
 * 跑动时的活体行（Grok `views/turn_status.rs` 的移植）：输入卡上方一行，左半是
 * 转轮 + 阶段词 + **本轮已耗时**，空闲时整块消失（Grok 的 `should_show()` 同义）。
 *
 * Nova 原先只在 composer 前缀转个轮、工具行各自报自己的秒数——一轮跑到第三十秒时，
 * "它还活着吗、已经多久了"这个问题在屏幕上没有答案。右半（Grok 的 `17s ⇣9.45k`）
 * 刻意**不放**：累计 context 与 tps 已经归状态栏，一行一件事。
 */

import type { GenPhase } from './composer-view.js';
import type { Palette } from './palette.js';
import { MARK_LEAD } from './layout.js';
import { SPINNER_FRAMES } from './tokens.js';

export interface TurnStatusView {
  phase: GenPhase;
  spinnerFrame: number;
  elapsedMs: number;
}

const PHASE_TEXT: Record<GenPhase, string> = {
  idle: '进行中',
  thinking: '思考中',
  writing: '回答中',
  tool: '执行工具',
};

/** Grok `format_duration`（`pager-render/src/util.rs:90-105`）：<10s 一位小数、<60s 整秒、更久 `m+s+`。 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}

export function turnStatus(p: Palette, v: TurnStatusView): string {
  const frame = SPINNER_FRAMES[v.spinnerFrame % SPINNER_FRAMES.length] ?? '·';
  return `${MARK_LEAD}${frame} ${p.bold(PHASE_TEXT[v.phase])}… ${p.dim(formatElapsed(v.elapsedMs))}`;
}
