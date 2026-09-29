import { describe, expect, it } from 'vitest';
import type { WireTraceRow } from '../../src/protocol.js';
import { traceRowText } from '../src/trace-view.js';

/**
 * The trace's words. The pane reads the durable log, so its labels must state
 * what the log recorded and nothing more — an approval row prints the decision
 * that was logged, not a summary verdict; a count that is not there is not
 * printed; and a row this build does not know how to word would be a compile
 * error, not a blank line.
 */
describe('traceRowText', () => {
  it('words a message row by its role and keeps the preview as the body', () => {
    const row: WireTraceRow = { kind: 'message', ts: 0, role: 'user', preview: '帮我看看', tools: 0 };
    expect(traceRowText(row)).toEqual({ label: '用户消息', detail: '帮我看看' });
  });

  it('words the seeded fragment as an injection', () => {
    const row: WireTraceRow = { kind: 'message', ts: 0, role: 'user', preview: '<environment>', tools: 0, context: true };
    expect(traceRowText(row).label).toBe('上下文注入');
  });

  it('gives the assistant its tool count and a result its tool name', () => {
    expect(traceRowText({ kind: 'message', ts: 0, role: 'assistant', preview: 'done', tools: 3 }))
      .toEqual({ label: '助手回复', detail: 'done', trailing: '3 次工具调用' });
    expect(traceRowText({ kind: 'message', ts: 0, role: 'tool', preview: 'exit: 0', tools: 0, name: 'bash' }))
      .toEqual({ label: '工具结果', detail: 'exit: 0', trailing: 'bash' });
  });

  it('prints an approval decision as the log recorded it', () => {
    expect(traceRowText({ kind: 'approval', ts: 0, tool: 'bash', request: 'execute', outcome: 'always' }))
      .toEqual({ label: '审批', detail: 'bash · execute', trailing: '总是允许' });
    expect(traceRowText({ kind: 'approval', ts: 0, tool: 'bash', request: 'execute', outcome: 'deny' }).trailing)
      .toBe('拒绝');
  });

  it('says a plan was retired rather than printing 0 / 0', () => {
    expect(traceRowText({ kind: 'todo', ts: 0, total: 0, open: 0 })).toEqual({ label: '计划快照', detail: '清空计划' });
    expect(traceRowText({ kind: 'todo', ts: 0, total: 3, open: 1 }).trailing).toBe('1 / 3 未完成');
  });

  it('keeps a compaction failure visible', () => {
    expect(traceRowText({ kind: 'compaction', ts: 0, phase: 'end', error: 'boom' }))
      .toEqual({ label: '压缩结束', detail: '出错：boom' });
    expect(traceRowText({ kind: 'compaction', ts: 0, phase: 'summary', tokens: 12_345 }).trailing)
      .toBe('折叠 12,345 tok');
  });

  it('words a run row with the formatter the transcript line uses', () => {
    const stats = {
      startedAt: 1_700_000_000_000,
      durationMs: 4_000,
      firstTokenMs: 2_300,
      llmMs: 3_800,
      toolMs: 0,
      requests: 1,
      toolCalls: 0,
      retries: 0,
      promptTokens: 100,
      completionTokens: 356,
      cachedTokens: 40,
    };
    // 356 tokens in 4s is 89 tok/s, and the row is the SAME sentence the
    // conversation shows under the answer (one formatter, one reading).
    expect(traceRowText({ kind: 'run', ts: stats.startedAt, stats })).toEqual({
      label: '运行量测',
      detail: '用时 4.0s · 首 token 2.3s · 89 tok/s',
    });
  });

  it('names the workspace and the PTC sub-call outcome', () => {
    expect(traceRowText({ kind: 'workspace', ts: 0, path: 'D:/w' })).toEqual({ label: '工作区', detail: 'D:/w' });
    expect(traceRowText({ kind: 'dispatch', ts: 0, tool: 'read_file', isError: true }))
      .toEqual({ label: 'PTC 子调用', detail: 'read_file', trailing: '失败' });
  });

  it('never prints an inherited Object member as a word', () => {
    // The regression this pins: the three label tables were read as
    // `TABLE[value]`, and every value here is a discriminant of a `trace` frame
    // — i.e. whatever the host's log said. A value naming an `Object.prototype`
    // member returned the inherited FUNCTION, which the pane then printed as the
    // row's label (`typeof label === 'function'`, proven by calling this before
    // the guard existed). `Object.hasOwn` confines the read to the table.
    const hostile = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'] as const;
    for (const value of hostile) {
      const message = traceRowText({ kind: 'message', ts: 0, role: value, preview: '', tools: 0 } as never);
      expect(typeof message.label, `role ${value}`).toBe('string');
      expect(message.label, `role ${value}`).not.toContain('native code');

      const compaction = traceRowText({ kind: 'compaction', ts: 0, phase: value } as never);
      expect(typeof compaction.label, `phase ${value}`).toBe('string');
      expect(compaction.label, `phase ${value}`).not.toContain('native code');

      const approval = traceRowText({ kind: 'approval', ts: 0, tool: 't', request: 'r', outcome: value } as never);
      expect(typeof approval.trailing, `outcome ${value}`).toBe('string');
      expect(String(approval.trailing), `outcome ${value}`).not.toContain('native code');
    }
  });
});