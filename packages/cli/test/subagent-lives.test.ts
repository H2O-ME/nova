/**
 * SubagentLives state-machine tests: the takeover contract (one block morphs
 * 调用 → ⧉ live → done, never two lines for one fact), the click-expand
 * detail survival on the DONE row (a regression this extraction fixes — the
 * old shell deleted the takeover block before rewriting it and the re-push
 * stripped `detail`), and the abort fallback to a static ■ row.
 */
import { describe, expect, it } from 'vitest';
import { plainPalette } from '@nova-agent/tui-view';
import type { SubagentUsage } from '@nova-agent/core';
import { TuiStore } from '../src/tui/store.js';
import { SubagentLives } from '../src/tui/subagent-lives.js';

function harness() {
  let clock = 20_000;
  const store = new TuiStore(() => undefined);
  const lives = new SubagentLives({
    store,
    paint: plainPalette,
    budget: () => 73, // cols-1-6 with cols=80
    now: () => clock,
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  /** Simulate tool_call_start's pending line the shell/projector creates. */
  const pinPending = (callId: string) => {
    const block = store.pushBlock([`    • 调用 subagent {"label":"侦察"} `]);
    store.toolBlocks.set(callId, { block, startAt: clock, name: 'subagent', rawArgs: '{"label":"侦察"}' });
    return block;
  };
  return { store, lives, advance, pinPending };
}

const usage = (over: Partial<SubagentUsage> = {}): SubagentUsage => ({
  elapsedMs: 4200,
  turns: 3,
  toolCalls: 5,
  promptTokens: 1200,
  completionTokens: 300,
  ...over,
});

describe('SubagentLives', () => {
  it('start takes over the pending tool line without adding a block', () => {
    const { store, lives, pinPending } = harness();
    const block = pinPending('c1');
    const before = store.blocks.length;
    lives.progress('c1', { type: 'start', label: '侦察' });
    // Same block, morphed into the live row — no second line for one fact.
    expect(store.blocks).toHaveLength(before);
    expect(store.blocks).toContain(block);
    expect(block.lines[0]).toContain('⧉ 子代理');
    expect(block.lines[0]).not.toContain('调用 subagent');
  });

  it('taken-over entries are skipped by the pending-line animation (去重契约)', () => {
    const { lives, advance, pinPending } = harness();
    const block = pinPending('c1');
    lives.progress('c1', { type: 'start', label: '侦察' });
    expect(lives.has('c1')).toBe(true);
    advance(9000);
    lives.renderAll('⠹');
    // animateRunningTools skips live ids: the takeover block is never
    // re-drawn back into a 调用 line with an elapsed suffix.
    expect(block.lines[0]).toContain('⧉ 子代理');
    expect(block.lines.join('\n')).not.toContain('调用 subagent');
  });

  it('nested tool calls and usage accumulate into the live row and detail', () => {
    const { lives, pinPending } = harness();
    const block = pinPending('c1');
    lives.progress('c1', { type: 'start', label: '侦察' });
    lives.progress('c1', {
      type: 'tool_call',
      label: '侦察',
      call: { id: 'n1', name: 'read_file', args: {}, rawArgs: '{"path":"a.ts"}' },
    });
    lives.progress('c1', {
      type: 'usage',
      label: '侦察',
      stats: { turns: 2, promptTokens: 900, completionTokens: 120 } as never,
    });
    const head = block.lines[0] ?? '';
    expect(head).toContain('read_file');
    expect(head).toContain('2 轮');
    expect(block.detail?.lines.some((l) => l.includes('› read_file'))).toBe(true);
  });

  it('settle keeps the takeover block in place and the done row click-expandable', () => {
    const { store, lives, advance, pinPending } = harness();
    const block = pinPending('c1');
    lives.progress('c1', { type: 'start', label: '侦察' });
    lives.progress('c1', { type: 'done', label: '侦察', usage: usage(), status: 'completed' });
    advance(5000);
    const doneLines = ['    ✓ 调用子代理 侦察 · 4.2s'];
    lives.settle('c1', doneLines, 5000);
    // The block SURVIVES for the caller's in-place rewrite (this is the fixed
    // regression: the old code removed it here and the re-push lost detail).
    expect(store.blocks).toContain(block);
    expect(lives.has('c1')).toBe(false);
    expect(block.detail?.base).toEqual(doneLines);
    expect(block.detail?.lines.some((l) => l.includes('✓ 完成'))).toBe(true);
    expect(block.expanded).toBe(false);
  });

  it('settle without a takeover removes the standalone fallback block', () => {
    const { store, lives } = harness();
    // No pending tool line (progress raced tool_call_start): fallback block.
    lives.progress('cX', { type: 'start', label: '侦察' });
    const fallback = store.blocks.find((b) => b.lines.some((l) => l.includes('⧉')));
    expect(fallback).toBeDefined();
    lives.settle('cX', ['done'], 1000);
    expect(store.blocks).not.toContain(fallback);
    expect(lives.has('cX')).toBe(false);
  });

  it('abortAll falls back to a static ■ row and keeps the nested log expandable', () => {
    const { lives, pinPending } = harness();
    const block = pinPending('c1');
    lives.progress('c1', { type: 'start', label: '侦察' });
    lives.progress('c1', {
      type: 'tool_call',
      label: '侦察',
      call: { id: 'n1', name: 'search_files', args: {}, rawArgs: '{}' },
    });
    lives.abortAll();
    expect(lives.has('c1')).toBe(false);
    expect(block.lines.some((l) => l.includes('■'))).toBe(true);
    // 中止了也看得到它做到了哪一步：detail 保留、默认收起。
    expect(block.detail?.lines.some((l) => l.includes('› search_files'))).toBe(true);
    expect(block.expanded).toBe(false);
  });

  it('nested log is capped: oldest entries fall off (memory budget)', () => {
    const { lives, pinPending } = harness();
    const block = pinPending('c1');
    lives.progress('c1', { type: 'start', label: '侦察' });
    for (let i = 0; i < 250; i++) {
      lives.progress('c1', {
        type: 'tool_call',
        label: '侦察',
        call: { id: `n${i}`, name: 'read_file', args: {}, rawArgs: `{"path":"f${i}.ts"}` },
      });
    }
    const detail = block.detail?.lines ?? [];
    expect(detail).toHaveLength(200);
    // 裁旧保新：最早一条（f0）已被挤出，最新的 f249 还在。
    expect(detail.some((l) => l.includes('f0.ts'))).toBe(false);
    expect(detail.some((l) => l.includes('f249.ts'))).toBe(true);
  });
});
