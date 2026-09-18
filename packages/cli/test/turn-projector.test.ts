/**
 * TurnProjector state-machine tests: the class is exactly the closure state
 * that used to hide inside tui-mode's agentTurn — the surface every M7.7–M7.11
 * "真机截图驱动" fix touched (retry residues, blank-answer anchoring, fake
 * live rows, discarded partials, orphan continuation rows). Driving it with
 * plainPalette + a fake clock turns those screenshot regressions into red
 * tests. No terminal, no agent loop, no timers.
 */
import { describe, expect, it } from 'vitest';
import { plainPalette } from '@nova-agent/tui-view';
import { styledWidth } from '@nova-agent/tui';
import type { ToolCall } from '@nova-agent/core';
import { TuiStore, type Block } from '../src/tui/store.js';
import { TurnProjector } from '../src/tui/turn-projector.js';

const COLS = 80;

function harness() {
  let clock = 10_000;
  let revealArms = 0;
  const store = new TuiStore(() => undefined);
  const projector = new TurnProjector({
    store,
    paint: plainPalette,
    cols: () => COLS,
    now: () => clock,
    onNeedsReveal: () => {
      revealArms += 1;
    },
    gutters: {
      user: { first: '❯ ', rest: '  ' },
      assistant: { first: '• ', rest: '  ' },
    },
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  // Drive the reveal ticker the way the shell's interval would.
  const tickUntilIdle = (): void => {
    for (let i = 0; i < 500 && projector.hasPendingReveal(); i++) {
      clock += 30;
      projector.tick();
    }
  };
  return { store, projector, advance, tickUntilIdle, revealArms: () => revealArms };
}

const call = (name: string, id: string, args = '{}'): ToolCall => ({
  id,
  name,
  args: {},
  rawArgs: args,
});

const allRows = (blocks: readonly Block[]): string[] => blocks.flatMap((b) => b.lines);

describe('TurnProjector', () => {
  it('beginTurn pushes the user row and starts from a clean slate', () => {
    const { store, projector } = harness();
    projector.beginTurn('你好，帮我看看');
    expect(store.blocks).toHaveLength(1);
    expect(store.blocks[0]!.lines).toEqual(['你好，帮我看看']);
  });

  it('whitespace-only leading deltas never anchor a blank answer block', () => {
    const { store, projector } = harness();
    projector.beginTurn('hi');
    projector.appendAssistant('  \n');
    projector.appendAssistant('\n\n');
    // Only the user row exists — no empty assistant block above tool lines.
    expect(store.blocks.filter((b) => b.kind === 'assistant')).toHaveLength(0);
    // A real delta opens it exactly once.
    projector.appendAssistant('好的。');
    expect(store.blocks.filter((b) => b.kind === 'assistant')).toHaveLength(1);
  });

  it('reveal is paced through the smoothers and flushes on close', () => {
    const { store, projector, tickUntilIdle, revealArms } = harness();
    projector.beginTurn('q');
    projector.appendAssistant('a'.repeat(50));
    expect(revealArms()).toBeGreaterThan(0);
    expect(projector.hasPendingReveal()).toBe(true);
    tickUntilIdle();
    expect(projector.hasPendingReveal()).toBe(false);
    const text = allRows(store.blocks).join('\n');
    expect(text).toContain('a'.repeat(50));
  });

  it('retry reset leaves no residue: no partial block, no reasoning line', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('想到一半');
    projector.appendAssistant('答了一半');
    const before = store.blocks.length;
    projector.resetAssistant();
    // Only the user row survives: reasoning + assistant blocks are gone.
    expect(store.blocks).toHaveLength(1);
    expect(store.blocks.length).toBeLessThan(before);
    expect(store.reasoningBlock).toBeUndefined();
    // The next attempt opens fresh blocks.
    projector.appendAssistant('重试后的回答');
    expect(store.blocks.some((b) => b.kind === 'assistant')).toBe(true);
  });

  it('abort teardown drops the uncommitted partial and marks 已中断', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.appendAssistant('写到一半被中断');
    projector.handleFailure('abort');
    expect(store.blocks.some((b) => b.lines.some((l) => l.includes('写到一半')))).toBe(false);
    expect(store.blocks.some((b) => b.lines.some((l) => l.includes('■ 已中断')))).toBe(true);
    // Abort never shows the discarded-answer hint (nothing was committed).
    expect(store.blocks.some((b) => b.lines.some((l) => l.includes('已丢弃')))).toBe(false);
    projector.endTurn();
    expect(store.streaming).toBe(false);
    expect(store.genPhase).toBe('idle');
  });

  it('committed answer survives; only the uncommitted retry part is dropped on error', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.appendAssistant('第一段已完成。');
    projector.closeAssistant(); // 'message' event: committed, stays
    projector.appendAssistant('第二段没写完');
    projector.handleFailure('error', 'gateway 502');
    const text = allRows(store.blocks).join('\n');
    expect(text).toContain('第一段已完成。');
    expect(text).not.toContain('第二段没写完');
    expect(text).toContain('未完成的回答已丢弃');
    expect(text).toContain('✗ 出错：gateway 502');
    projector.endTurn();
  });

  it('tool lines morph pending → done in place; reads fold into a group', () => {
    const { store, projector, advance } = harness();
    projector.beginTurn('q');
    const bash = call('bash', 'c1', '{"command":"pnpm test"}');
    projector.toolStart(bash);
    const pending = store.blocks[store.blocks.length - 1]!;
    expect(pending.lines[0]).toContain('执行命令');
    advance(2500);
    projector.toolResult(bash, 'done ok');
    // Same block rewritten (no second line, no orphan).
    expect(store.blocks).toContain(pending);
    expect(pending.lines.some((l) => l.includes('✓') || l.includes('✗'))).toBe(true);

    const read = call('read_file', 'c2', '{"path":"a.txt"}');
    projector.toolStart(read);
    // Running reads take no row of their own: the verb group holds the line
    // in present aspect until the result settles it.
    const group = store.blocks[store.blocks.length - 1]!;
    expect(group.lines[0]).toContain('正在读取 1 个文件');
    projector.toolResult(read, 'content');
    expect(store.toolBlocks.has('c2')).toBe(false);
    expect(store.blocks).toContain(group); // group row rewritten in place
    expect(group.lines[0]).toContain('读取 1 个文件');
    expect(group.lines[0]).toContain('✓');
    expect(group.lines[0]).not.toContain('正在');
  });

  it('multi-line tool result attaches the tri-state fold source; header carries ▸', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    const bash = call('bash', 'cf', '{"command":"ls"}');
    projector.toolStart(bash);
    const block = store.blocks[store.blocks.length - 1]!;
    projector.toolResult(bash, 'r1\nr2\nr3');
    expect(block.fold).toBeDefined();
    expect(block.fold!.state).toBe(0);
    expect(block.fold!.full).toHaveLength(3);
    expect(block.fold!.base).toEqual(block.lines); // Collapsed 真相 = 头行
    expect(block.lines[0]).toContain('▸');

    const echo = call('bash', 'cg', '{"command":"echo"}');
    projector.toolStart(echo);
    const single = store.blocks[store.blocks.length - 1]!;
    projector.toolResult(echo, 'single');
    expect(single.fold).toBeUndefined();
    expect(single.lines[0]).not.toContain('▸');
  });

  it('running-line animation keeps every row inside cols-1 with CJK args', () => {
    const { store, projector, advance } = harness();
    projector.beginTurn('q');
    const cjkArg = '{"command":"cd \\"项目/构建输出\\" && python 统计.py --深度 全仓 --格式 json"}';
    projector.toolStart(call('bash', 'c9', cjkArg));
    advance(10_000); // well past the elapsed-suffix threshold
    projector.animateRunningTools('⠹');
    const entry = store.toolBlocks.get('c9')!;
    for (const line of entry.block.lines) {
      expect(styledWidth(line)).toBeLessThanOrEqual(COLS - 1);
    }
    // The elapsed suffix stays on the first row (no orphan continuation).
    expect(entry.block.lines[0]).toContain('10s');
  });

  it('interrupt suffix also respects the single-row budget', () => {
    const { store, projector, advance } = harness();
    projector.beginTurn('q');
    projector.toolStart(call('bash', 'cx', '{"command":"' + 'echo '.repeat(60) + '"}'));
    advance(1000);
    store.interruptAt = 10_500;
    projector.animateRunningTools('⠹');
    const entry = store.toolBlocks.get('cx')!;
    expect(entry.block.lines[0]).toContain('正在中断');
    for (const line of entry.block.lines) {
      expect(styledWidth(line)).toBeLessThanOrEqual(COLS - 1);
    }
  });

  it('live bash tail appends under the running line, clipped to budget', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.toolStart(call('bash', 'ct', '{"command":"pnpm test"}'));
    projector.toolTail('一堆输出\n第二行 带很长'.repeat(12));
    projector.animateRunningTools('•');
    const entry = store.toolBlocks.get('ct')!;
    expect(entry.block.lines.length).toBe(2);
    expect(entry.block.lines[1]).toContain('└');
    for (const line of entry.block.lines) {
      expect(styledWidth(line)).toBeLessThanOrEqual(COLS - 1);
    }
  });

  it('reasoning block is transient: folded away when work starts or fails', () => {
    const { store, projector, tickUntilIdle } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('让我想想这件事');
    tickUntilIdle();
    expect(store.blocks.some((b) => b.kind === 'reasoning')).toBe(true);
    projector.toolStart(call('bash', 'cr', '{"command":"ls"}'));
    expect(store.blocks.some((b) => b.kind === 'reasoning')).toBe(false);
    expect(store.reasoningBlock).toBeUndefined();
  });

  it('endTurn clears every transient even without a failure (done path)', () => {
    const { store, projector, tickUntilIdle } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('想');
    projector.appendAssistant('答');
    projector.closeAssistant();
    tickUntilIdle();
    projector.endTurn();
    expect(store.streaming).toBe(false);
    expect(store.genPhase).toBe('idle');
    expect(store.activeToolId).toBeUndefined();
    expect(store.readGroup).toBeUndefined();
    expect(store.reasoningBlock).toBeUndefined();
    // The message commit adopted the 已思考 header: transcript, not transient.
    expect(store.blocks.some((b) => b.kind === 'reasoning')).toBe(true);
  });

  it('next beginTurn starts clean after a torn-down turn', () => {
    const { store, projector } = harness();
    projector.beginTurn('第一问');
    projector.appendAssistant('写一半');
    projector.handleFailure('abort');
    projector.endTurn();
    projector.beginTurn('第二问');
    const last = store.blocks[store.blocks.length - 1]!;
    expect(last.kind).toBe('user');
    expect(last.lines).toEqual(['第二问']);
    expect(store.streaming).toBe(false);
  });
});

describe('TurnProjector.onEvent', () => {
  const stats = { promptTokens: 10, completionTokens: 2, cachedTokens: 0, turns: 1, missTokens: 0, missTurns: 0 };
  const ctx = () => ({ stats, elapsedMs: 1_000, config: { maxTurns: 30 } as never });

  it('llm_retry discards the partial answer and explains the restart', () => {
    const { store, projector, advance, tickUntilIdle } = harness();
    projector.beginTurn('问');
    projector.appendAssistant('半截回答');
    advance(100);
    tickUntilIdle();
    projector.onEvent({ type: 'llm_retry', error: 'timeout', attempt: 1, maxRetries: 2, stats }, ctx());
    expect(store.genPhase).toBe('thinking');
    expect(allRows(store.blocks).join('\n')).toContain('自动重试 1/2');
    // 半截回答块已丢弃（不残留在转录里）。
    expect(allRows(store.blocks).join('\n')).not.toContain('半截回答');
  });

  it('empty_completion leaves the same kind of audit line', () => {
    const { store, projector } = harness();
    projector.beginTurn('问');
    projector.onEvent({ type: 'empty_completion', finishReason: 'stop', attempt: 1, maxRetries: 2 }, ctx());
    expect(allRows(store.blocks).join('\n')).toContain('空回复');
  });

  it('blank text deltas never anchor an assistant block', () => {
    const { store, projector } = harness();
    projector.beginTurn('问');
    projector.onEvent({ type: 'text_delta', text: '' }, ctx());
    expect(store.blocks.some((b) => b.kind === 'assistant')).toBe(false);
  });

  it('done on an abnormal stop pushes the status line, complete stays silent', () => {
    const { store, projector } = harness();
    projector.beginTurn('问');
    projector.onEvent({ type: 'done', stopReason: 'max_turns' }, ctx());
    expect(allRows(store.blocks).join('\n')).toContain('已达最大轮数');

    const second = harness();
    second.projector.beginTurn('问');
    second.projector.onEvent({ type: 'done', stopReason: 'complete' }, ctx());
    expect(allRows(second.store.blocks).join('\n')).not.toContain('完成');
  });

  it('turn_start/usage/turn_aborted have no projection action', () => {
    const { store, projector } = harness();
    projector.beginTurn('问');
    const before = store.blocks.length;
    projector.onEvent({ type: 'turn_start' }, ctx());
    projector.onEvent({ type: 'usage', usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stats }, ctx());
    projector.onEvent({ type: 'turn_aborted', message: { id: 'm', ts: 0, role: 'user', content: 'x' } }, ctx());
    expect(store.blocks).toHaveLength(before);
  });
});

describe('live read verb group (M10 组件4)', () => {
  it('parallel reads share one live row: counts grow, tense flips only when all settle', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    const before = store.blocks.length;
    const r1 = call('read_file', 'r1', '{"path":"a.ts"}');
    const r2 = call('read_file', 'r2', '{"path":"b.ts"}');
    const s = call('search_files', 's1', '{"pattern":"todo"}');
    projector.toolStart(r1);
    projector.toolStart(r2);
    projector.toolStart(s);
    // Three starts, one group block: no per-call pending rows.
    expect(store.blocks).toHaveLength(before + 1);
    const row = store.blocks[store.blocks.length - 1]!;
    // 时态整组翻转（Grok：running 翻 tense only），桶序=首现序。
    expect(row.lines[0]).toContain('正在读取 2 个文件, 正在搜索 1 个模式');
    projector.toolResult(r1, 'x');
    expect(row.lines[0]).toContain('正在'); // one member still running
    projector.toolResult(r2, 'x');
    projector.toolResult(s, 'x');
    expect(row.lines[0]).toContain('读取 2 个文件, 搜索 1 个模式');
    expect(row.lines[0]).toContain('✓');
    expect(row.lines[0]).not.toContain('正在');
    // 点击展开体是成员摘要。
    expect(row.detail!.lines.join('\n')).toContain('a.ts');
    expect(row.detail!.lines.join('\n')).toContain('b.ts');
  });

  it('a failed read folds into the group with a 失败 suffix, no standalone ✗ row', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    const ok = call('read_file', 'f1', '{"path":"a.ts"}');
    const bad = call('read_file', 'f2', '{"path":"gone.ts"}');
    projector.toolStart(ok);
    projector.toolResult(ok, 'x');
    projector.toolStart(bad);
    projector.toolResult(bad, 'Error: no such file');
    const group = store.blocks[store.blocks.length - 1]!;
    expect(group.lines).toHaveLength(1);
    expect(group.lines[0]).toContain('读取 2 个文件');
    expect(group.lines[0]).toContain('1 失败');
    expect(group.lines[0]).not.toContain('✗');
    // 失败成员在展开体里标 ✗。
    expect(group.detail!.lines.join('\n')).toContain('✗ gone.ts');
  });

  it('a non-read call closes the run; the next read opens a fresh group', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    const r = call('read_file', 'g1', '{"path":"a.ts"}');
    projector.toolStart(r);
    projector.toolResult(r, 'x');
    const group = store.blocks[store.blocks.length - 1]!;
    const bash = call('bash', 'g2', '{"command":"ls"}');
    projector.toolStart(bash);
    expect(store.readGroup).toBeUndefined();
    expect(group.lines[0]).toContain('读取 1 个文件');
    expect(store.blocks[store.blocks.length - 1]).not.toBe(group); // bash 有自己的活行
    projector.toolResult(bash, 'done');
    const r2 = call('list_dir', 'g3', '{"path":"src"}');
    projector.toolStart(r2);
    const second = store.blocks[store.blocks.length - 1]!;
    expect(second).not.toBe(group);
    expect(second.lines[0]).toContain('正在列出 1 个目录');
  });

  it('never-returned members vanish at endTurn (all-pending leaves no row)', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.toolStart(call('read_file', 'i1', '{"path":"a.ts"}'));
    projector.endTurn();
    expect(store.readGroup).toBeUndefined();
    expect(allRows(store.blocks).join('\n')).not.toContain('读取');
    expect(store.toolBlocks.size).toBe(0);

    const h2 = harness();
    h2.projector.beginTurn('q');
    const a = call('read_file', 'i2', '{"path":"a.ts"}');
    const b = call('read_file', 'i3', '{"path":"b.ts"}');
    h2.projector.toolStart(a);
    h2.projector.toolStart(b);
    h2.projector.toolResult(a, 'x');
    h2.projector.endTurn();
    const text = allRows(h2.store.blocks).join('\n');
    expect(text).toContain('读取 1 个文件');
    expect(text).not.toContain('读取 2');
    expect(text).not.toContain('正在');
  });

  it('an expanded group keeps detail rows across re-renders', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    const r1 = call('read_file', 'e1', '{"path":"a.ts"}');
    const r2 = call('read_file', 'e2', '{"path":"b.ts"}');
    projector.toolStart(r1);
    projector.toolResult(r1, 'x');
    const group = store.blocks[store.blocks.length - 1]!;
    group.expanded = true; // 点击展开态挂在块上
    projector.toolStart(r2);
    expect(group.lines).toHaveLength(3); // header + 2 成员（含在跑）
    expect(group.lines[0]).toContain('▾');
    projector.toolResult(r2, 'y');
    expect(group.lines).toHaveLength(3);
    expect(group.lines[0]).toContain('✓');
  });
});

describe('reasoning fold header (M10 组件11)', () => {
  it('answer start freezes the thought into a ▸ 已思考 header with click detail', () => {
    const { store, projector, advance } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('先看看仓库结构');
    advance(4200);
    projector.appendAssistant('好的。');
    const headers = store.blocks.filter((b) => b.kind === 'reasoning');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.lines).toEqual(['▸ 已思考 4.2s']);
    expect(headers[0]!.detail?.lines.join('\n')).toContain('先看看仓库结构');
    // Live window is gone: nothing streams into the header anymore.
    expect(store.reasoningBlock).toBeUndefined();
  });

  it('the message commit adopts the header; without it endTurn drops the transient', () => {
    const h1 = harness();
    h1.projector.beginTurn('q');
    h1.projector.appendReasoning('想');
    h1.projector.appendAssistant('答');
    h1.projector.closeAssistant();
    h1.tickUntilIdle();
    h1.projector.endTurn();
    expect(h1.store.blocks.some((b) => b.kind === 'reasoning')).toBe(true);

    const h2 = harness();
    h2.projector.beginTurn('q');
    h2.projector.appendReasoning('想');
    h2.projector.appendAssistant('没提交');
    h2.projector.endTurn();
    expect(h2.store.blocks.some((b) => b.kind === 'reasoning')).toBe(false);
  });

  it('retry drops the uncommitted header with the partial answer', () => {
    const { store, projector } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('想');
    projector.appendAssistant('答了一半');
    projector.resetAssistant();
    expect(store.blocks.some((b) => b.kind === 'reasoning')).toBe(false);
  });

  it('a later thought evicts only its own header: committed ones stay, one burst at a time', () => {
    const { store, projector, tickUntilIdle } = harness();
    projector.beginTurn('q');
    projector.appendReasoning('第一段思考');
    projector.appendAssistant('第一段回答');
    projector.closeAssistant();
    tickUntilIdle();
    // Second burst never reaches an answer — tool start discards it whole.
    projector.appendReasoning('第二段思考');
    projector.toolStart(call('bash', 'z1', '{"command":"ls"}'));
    const headers = store.blocks.filter((b) => b.kind === 'reasoning');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.lines[0]).toContain('已思考');
  });
});
