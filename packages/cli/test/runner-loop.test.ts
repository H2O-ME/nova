import { describe, expect, it } from 'vitest';
import type { AgentEvent, Session } from '@nova-agent/core';
import { emptyStats } from '@nova-agent/core';
import {
  createRunnerBookkeeping,
  createTurnNotifier,
  createUsageAnchors,
  resetUsageAnchors,
} from '../src/runner-loop.js';

/** 事件消费簿记（runner-loop）是四 runner 共享契约——断言钉住追加与锚点护栏。 */
function fakeSession(): { session: Session; appended: unknown[] } {
  const appended: unknown[] = [];
  const session = {
    append: async (msg: unknown) => {
      appended.push(msg);
    },
  } as unknown as Session;
  return { session, appended };
}

describe('createRunnerBookkeeping', () => {
  it('appends message / tool_call_result / turn_aborted to the current session', async () => {
    const { session, appended } = fakeSession();
    const book = createRunnerBookkeeping({ session: () => session, stats: emptyStats() });
    const message = { id: 'm1', role: 'assistant', content: 'hi' };
    const result = { id: 't1', role: 'tool', toolCallId: 'c1', content: 'ok' };
    const aborted = { id: 'a1', role: 'user', content: 'aborted' };
    expect(await book.apply({ type: 'message', message } as never)).toBe(true);
    expect(await book.apply({ type: 'tool_call_result', call: {}, result } as never)).toBe(true);
    expect(await book.apply({ type: 'turn_aborted', message: aborted } as never)).toBe(true);
    expect(appended).toEqual([message, result, aborted]);
  });

  it('returns false for presentation-only events (no side effects)', async () => {
    const { session, appended } = fakeSession();
    const book = createRunnerBookkeeping({ session: () => session, stats: emptyStats() });
    for (const type of ['turn_start', 'text_delta', 'reasoning_delta', 'llm_retry', 'empty_completion', 'done']) {
      expect(await book.apply({ type } as AgentEvent)).toBe(false);
    }
    expect(appended).toEqual([]);
  });

  it('accumulates stats and adopts anchors only for promptTokens > 0', async () => {
    const { session } = fakeSession();
    const stats = emptyStats();
    const anchors = createUsageAnchors();
    const messages = [{ id: 'm0' }, { id: 'm1' }];
    const book = createRunnerBookkeeping({
      session: () => session,
      stats,
      anchors,
      messages: () => messages,
    });
    await book.apply({
      type: 'usage',
      stats: { promptTokens: 10, completionTokens: 5, cachedTokens: 4, turns: 1, missTokens: 0, missTurns: 0 },
      usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 4 },
    } as never);
    expect(stats.promptTokens).toBe(10);
    expect(anchors.lastUsage?.promptTokens).toBe(10);
    expect(anchors.lastPromptTokens).toBe(10);
    expect(anchors.usageAnchor?.promptTokens).toBe(10);
    expect(anchors.anchorMsgCount).toBe(2);

    // prompt_tokens 缺失（coerce 成 0）的 usage 块只累计 stats，不收锚点。
    await book.apply({
      type: 'usage',
      stats: { promptTokens: 0, completionTokens: 1, cachedTokens: 0, turns: 2, missTokens: 0, missTurns: 0 },
      usage: { promptTokens: 0, completionTokens: 1, cachedTokens: 0 },
    } as never);
    expect(anchors.usageAnchor?.promptTokens).toBe(10);
    expect(anchors.anchorMsgCount).toBe(2);
  });

  it('headless runners (no anchors) still accumulate stats', async () => {
    const { session } = fakeSession();
    const stats = emptyStats();
    const book = createRunnerBookkeeping({ session: () => session, stats });
    await book.apply({
      type: 'usage',
      stats: { promptTokens: 7, completionTokens: 2, cachedTokens: 0, turns: 1, missTokens: 0, missTurns: 0 },
      usage: { promptTokens: 7, completionTokens: 2, cachedTokens: 0 },
    } as never);
    expect(stats.promptTokens).toBe(7);
  });
});

describe('resetUsageAnchors', () => {
  it('returns the state to the no-anchor baseline', () => {
    const anchors = createUsageAnchors();
    anchors.lastUsage = { promptTokens: 5, completionTokens: 1, cachedTokens: 0 };
    anchors.lastPromptTokens = 5;
    anchors.usageAnchor = { promptTokens: 5, completionTokens: 1, cachedTokens: 0 };
    anchors.anchorMsgCount = 3;
    resetUsageAnchors(anchors);
    expect(anchors).toEqual({
      lastUsage: undefined,
      lastPromptTokens: 0,
      usageAnchor: undefined,
      anchorMsgCount: 0,
    });
  });
});

describe('createTurnNotifier', () => {
  const notifyCalls: string[] = [];
  const notifier = createTurnNotifier((title) => notifyCalls.push(title));
  const now = Date.now();

  it('stays silent for short turns', () => {
    notifier.done(now);
    notifier.error(now, 'boom');
    expect(notifyCalls).toEqual([]);
  });

  it('notifies done/error past the LONG_TASK thresholds', () => {
    const longAgo = now - 60 * 60 * 1000;
    notifier.done(longAgo);
    notifier.error(longAgo, 'boom');
    expect(notifyCalls).toEqual(['任务已完成', '任务出错']);
  });

  it('honors the enabled gate (TUI exiting) and custom doneMs', () => {
    const calls: string[] = [];
    const gated = createTurnNotifier((title) => calls.push(title), { enabled: () => false });
    gated.done(now - 60 * 60 * 1000);
    expect(calls).toEqual([]);
    const exec = createTurnNotifier((title) => calls.push(title), { doneMs: 30_000 });
    exec.done(now - 31_000);
    expect(calls).toEqual(['任务已完成']);
    exec.done(now - 20_000);
    expect(calls).toEqual(['任务已完成']);
  });
});
