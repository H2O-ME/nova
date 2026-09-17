import { plainPalette } from '@nova-agent/tui-view';
import { describe, expect, it } from 'vitest';
import type { ContextBreakdownView, StatusView } from '@nova-agent/tui-view';
import { FrameAssembler } from '../src/tui/frame-assembler.js';
import { TuiStore } from '../src/tui/store.js';

function setup() {
  const store = new TuiStore(() => undefined);
  const frames: { lines: string[]; cursor: { row: number; col: number } }[] = [];
  let metaVersion = 0;
  const status: StatusView = {
    cols: 80,
    model: 'm1',
    approvalMode: 'read-only',
    codeMode: 'native',
    pristine: true,
    streaming: false,
    interruptAt: undefined,
    inputEmpty: true,
    lastCtrlC: undefined,
    now: 0,
    tpsRing: [],
    tpsSamples: 0,
    promptTokens: 0,
    cachedTokens: 0,
    cacheSeen: false,
    gaugeForms: ['', '', ''],
  } as unknown as StatusView;
  const context: ContextBreakdownView = {
    systemPrompt: 'sys',
    tools: [],
    messages: [],
    usageAnchor: undefined,
    anchorMsgCount: 0,
    contextWindow: 100_000,
    modelMetaContextWindow: undefined,
  } as unknown as ContextBreakdownView;
  const assembler = new FrameAssembler({
    store,
    paint: () => plainPalette,
    cols: () => 80,
    rows: () => 24,
    activeView: () => ['  [popup]'],
    statusView: () => status,
    contextView: () => context,
    gaugeKeyParts: () => ({
      messagesLen: 0,
      usageAnchor: undefined,
      model: 'm1',
      codeMode: 'native',
      modelMetaVersion: metaVersion,
      capacity: 100_000,
      toolCount: 0,
      compactLimit: 60_000,
    }),
    write: (lines, cursor) => frames.push({ lines, cursor }),
  });
  return {
    store,
    frames,
    assembler,
    bumpMeta: () => {
      metaVersion += 1;
    },
  };
}

describe('FrameAssembler', () => {
  it('writes one frame whose bottom stack carries popup + composer + status', () => {
    const t = setup();
    t.store.pushBlock(['  hi']);
    t.assembler.render({ commandMatches: [], modelContextTokens: () => undefined, currentModel: 'm1', currentSessionFile: '/s.jsonl' });
    expect(t.frames).toHaveLength(1);
    const frame = t.frames[0]!;
    const text = frame.lines.join('\n');
    expect(text).toContain('[popup]');
    expect(text).toContain('hi');
    expect(frame.cursor.row).toBeGreaterThan(0);
    expect(frame.cursor.col).toBeGreaterThanOrEqual(0);
    // 帧映射写回 store（点击命中块靠它）。
    expect(t.store.frameMap.historyRows).toBeGreaterThanOrEqual(0);
  });

  it('caches the flattened transcript until blocksVersion moves', () => {
    const t = setup();
    t.store.pushBlock(['  a']);
    const args = { commandMatches: [], modelContextTokens: () => undefined, currentModel: 'm1', currentSessionFile: '/s.jsonl' };
    t.assembler.render(args);
    const first = t.frames[0]!.lines;
    t.assembler.render(args);
    expect(t.frames[1]!.lines).toEqual(first);
  });

  it('keeps the gauge forms stable while the cache key holds and recomputes when it moves', () => {
    const t = setup();
    const a = t.assembler.gaugeForms();
    const b = t.assembler.gaugeForms();
    expect(b).toBe(a); // 同一实例 = 未重算（全量估算很贵）
    t.bumpMeta();
    const c = t.assembler.gaugeForms();
    expect(c).not.toBe(a);
  });

  it('invalidate drops the flatten cache (resize path)', () => {
    const t = setup();
    t.store.pushBlock(['  a']);
    const args = { commandMatches: [], modelContextTokens: () => undefined, currentModel: 'm1', currentSessionFile: '/s.jsonl' };
    t.assembler.render(args);
    t.assembler.invalidate();
    t.assembler.render(args);
    expect(t.frames).toHaveLength(2);
  });
});