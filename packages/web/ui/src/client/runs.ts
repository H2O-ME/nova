/**
 * The run domain: kernel events that touch run state — phase, model, queue,
 * todos/goal, compaction, notices, failures, usage and per-run stats. The
 * transcript half lives in `./messages.ts`, the blocking cards in
 * `./approvals.ts`; this module is the run's own bookkeeping.
 */
import { addRun } from '@nova-agent/core/totals';
import type { KernelEvent } from '../types.js';
import type { UiState } from '../state.js';
import { closeStreaming, hint, push } from './messages.js';
import { isApprovalEvent, reduceApprovalEvent } from './approvals.js';
import { applySessionTitle } from './sessions.js';

/** Events that only touch run state (phase, model, queue, notices, usage, totals).
 *
 *  A whitelist mirroring `isRunStateEvent` in state-events.ts, NOT an Exclude:
 *  a new kernel event must be classified explicitly (the classifier's
 *  `assertNever` forces it), and a whitelist keeps this switch's coverage
 *  exactly as wide as what can actually reach it.
 */
export type RunStateEvent = Extract<
  KernelEvent,
  {
    type:
      | 'turn_start'
      | 'phase'
      | 'session_titled'
      | 'todo'
      | 'goal'
      | 'compaction'
      | 'notice'
      | 'run_failed'
      | 'usage'
      | 'run_stats'
      | 'queue_update'
      | 'model'
      | 'approval_request'
      | 'approval_resolved'
      | 'question_request'
      | 'question_resolved';
  }
>;

/** A notice code without an entry below still renders (its `text` is the fallback). */
type NoticeCode = Extract<KernelEvent, { type: 'notice' }>['code'];

/**
 * The notice channel's labels. The kernel ships a stable `code` plus a
 * renderable `text`; the code decides the tone and the one-word label (which
 * notices are operational failures is a kernel fact, not a styling choice) and
 * the text stays the body. Exhaustive on purpose: a new code in core forces a
 * decision here instead of sliding through as "info".
 */
export const NOTICE_LABELS: Record<NoticeCode, { label: string; tone: 'info' | 'warn' }> = {
  compacted: { label: '压缩', tone: 'info' },
  compact_fused: { label: '压缩熔断', tone: 'warn' },
  compact_alias_broken: { label: '压缩停用', tone: 'warn' },
  compact_failed: { label: '压缩失败', tone: 'warn' },
  surface_lagged: { label: '界面滞后', tone: 'warn' },
  listener_failed: { label: '监听异常', tone: 'warn' },
};

export function reduceRunState(state: UiState, event: RunStateEvent): UiState {
  // The blocking cards are their own slice (`./approvals.ts`); everything else
  // here is the run's own state.
  if (isApprovalEvent(event)) return reduceApprovalEvent(state, event);
  switch (event.type) {
    case 'turn_start':
      return { ...state, turnCount: state.turnCount + 1 };
    case 'phase':
      return { ...state, phase: event.phase };
    case 'usage':
      // The gauge's numerator is CONSUMPTION (prompt tokens of the last
      // request), not the cumulative session total.
      return { ...state, usedTokens: event.usage.promptTokens };
    case 'queue_update':
      return { ...state, queued: event.items };
    case 'model':
      // A switch is a session-level fact, so the event (not the picker's own
      // optimism) is what moves the label: a pick the endpoint refuses leaves
      // the seat showing the model actually in force.
      return {
        ...state,
        model: event.model,
        // An unreported name or window CLEARS rather than keeping the previous
        // model's: a stale label or denominator would describe a model that is
        // no longer in force.
        modelName: event.name ?? null,
        contextWindow: event.contextWindow ?? null,
      };
    case 'session_titled':
      // The sidebar row for THIS session updates in place — the rule lives in
      // the sessions domain (`./sessions.ts`).
      return applySessionTitle(state, event.title);
    case 'todo':
      // Wholesale replacement, never a merge: `todo_write` is last-write-wins,
      // so accumulating would keep items the model has already dropped.
      return { ...state, todos: event.todos };
    case 'goal':
      // Same rule as `todo` above: the event carries the WHOLE goal (or null when
      // cleared), so the surface replaces rather than merges. There is no
      // "unchanged" case to preserve.
      return { ...state, goal: event.goal };
    case 'compaction': {
      const { state: step, trigger, retained, error } = event.progress;
      const how = trigger === 'manual' ? '手动' : '自动';
      if (step === 'start') return hint(state, `上下文压缩中（${how}）…`, 'info');
      if (step === 'done') return hint(state, `${how}压缩完成 — 保留最近 ${retained ?? 0} 条消息`, 'info');
      return hint(state, `${how}压缩失败：${error ?? '未知原因'}`, 'warn');
    }
    case 'notice': {
      // `Object.hasOwn`, not a bare lookup: `NOTICE_LABELS['constructor']` would
      // return `Object` from the prototype chain, so the `undefined` check below
      // would pass and the hint would render "undefined · <text>". Only a code
      // that is genuinely a key of this table gets a label; everything else falls
      // back to the kernel's own text.
      const meta = Object.hasOwn(NOTICE_LABELS, event.code)
        ? NOTICE_LABELS[event.code]
        : undefined;
      return meta === undefined ? hint(state, event.text, 'info') : hint(state, `${meta.label} · ${event.text}`, meta.tone);
    }
    case 'run_failed': {
      // The turn is over either way: a still-open stream would leave the typing
      // cursor blinking on partial text that will never grow.
      const settled = { ...state, blocks: closeStreaming(state.blocks) };
      return hint(settled, event.aborted ? '已中断' : `出错：${event.message}`, 'warn');
    }
    case 'run_stats':
      // Two records of the same numbers: the turn's own meta row (where it
      // happened) and the running session totals (the stats bar).
      return { ...push(state, { kind: 'meta', stats: event.stats }), totals: addRun(state.totals, event.stats) };
  }
}
