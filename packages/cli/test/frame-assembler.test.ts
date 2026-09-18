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

  it('composer 带粘贴 chip 时帧内只出现徽章行，粘贴段不炸窗（M10 组件8）', () => {
    const t = setup();
    t.store.setInputAll('a\nb\nc');
    t.store.inputChips.push({ start: 2, end: 5 });
    t.store.cursorPos = 5;
    t.assembler.render({ commandMatches: [], modelContextTokens: () => undefined, currentModel: 'm1', currentSessionFile: '/s.jsonl' });
    const frame = t.frames.at(-1)!;
    expect(frame.lines.join('\n')).toContain('⧉ 粘贴 2行 3字');
    expect(frame.cursor.col).toBeGreaterThanOrEqual(0);
  });

  it('reuses the flattened transcript while no block is touched (identity-based cache)', () => {
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

/**
 * 逻辑滚动锚（M10 R5）：上滚后视口顶行钉在「块 + 块内偏移」上——历史任意
 * 位置的行数变化（上方块变高、尾部追加）都由锚反推补偿，sliceStart 恒定；
 * 用户滚动（scrollFromEnd 变化）让位并按新视口顶重锚。
 */
describe('FrameAssembler logical scroll anchor', () => {
  const renderArgs = {
    commandMatches: [],
    modelContextTokens: () => undefined,
    currentModel: 'm1',
    currentSessionFile: '/s.jsonl',
  };

  function scrolledSetup(blockCount: number, scrollFromEnd: number) {
    const t = setup();
    for (let i = 0; i < blockCount; i++) {
      t.store.pushBlock([`内容块 ${i}`], undefined, 'assistant');
    }
    t.store.scrollFromEnd = scrollFromEnd;
    t.assembler.render(renderArgs);
    return t;
  }

  it('growth above the viewport does not drift the visible top row', () => {
    const t = scrolledSetup(40, 5);
    const top = t.store.frameMap!.sliceStart;
    // 首块 1 行 → 3 行：锚定的是**内容**（块坐标），绝对 sliceStart 随下移，
    // scrollFromEnd 不变——旧行数锚会把 +2 补到偏移上，视口反而漂 2 行。
    const first = t.store.blocks[0]!;
    t.store.replaceBlock(first, ['加长', '第二行', '第三行']);
    t.assembler.render(renderArgs);
    expect(t.store.scrollFromEnd).toBe(5);
    expect(t.store.frameMap!.sliceStart).toBe(top + 2);
    expect(t.frames[1]!.lines[0]).toBe(t.frames[0]!.lines[0]);
  });

  it('tail appends keep the anchored top and grow the offset', () => {
    const t = scrolledSetup(40, 5);
    const top = t.store.frameMap!.sliceStart;
    t.store.pushBlock(['新输出'], undefined, 'assistant');
    t.assembler.render(renderArgs);
    expect(t.store.scrollFromEnd).toBe(7); // +1 行内容 +1 分隔空行
    expect(t.store.frameMap!.sliceStart).toBe(top);
  });

  it('a user scroll wins over derivation and re-anchors the new top', () => {
    const t = scrolledSetup(40, 5);
    const anchorTop = t.store.frameMap!.sliceStart;
    t.store.scrollFromEnd = 12; // 模拟滚轮/PageUp
    t.assembler.render(renderArgs);
    const userTop = t.store.frameMap!.sliceStart;
    expect(userTop).toBeLessThan(anchorTop);
    // 重锚后追加内容：新的 sliceStart 仍钉在用户选择的位置。
    t.store.pushBlock(['后续输出'], undefined, 'assistant');
    t.assembler.render(renderArgs);
    expect(t.store.frameMap!.sliceStart).toBe(userTop);
  });

  it('scrolling back to the bottom resumes live-follow (anchor dropped)', () => {
    const t = scrolledSetup(40, 5);
    t.store.scrollFromEnd = 0;
    t.assembler.render(renderArgs);
    expect(t.store.frameMap!.sliceStart).toBeGreaterThan(0); // 贴底但内容超窗
    t.store.pushBlock(['直播新行'], undefined, 'assistant');
    t.assembler.render(renderArgs);
    expect(t.store.scrollFromEnd).toBe(0);
  });

  it('anchor block removal falls back to row semantics without crashing', () => {
    const t = scrolledSetup(40, 5);
    const top = t.store.frameMap!.sliceStart;
    // 顶行所在的块被删除（历史截断/块生命周期）。
    const victim = t.store.blocks.find((b) => {
      const entry = t.store.frameMap!.rows.find((e) => e.block === b);
      return entry !== undefined && entry.start <= top && top < entry.start + entry.count;
    })!;
    t.store.blocks.splice(t.store.blocks.indexOf(victim), 1);
    t.assembler.render(renderArgs);
    expect(t.frames).toHaveLength(2);
    expect(t.store.scrollFromEnd).toBeGreaterThanOrEqual(0);
  });
});