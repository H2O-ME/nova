/**
 * The status line's contract is "give up whole fields, never cut a word", so
 * these tests walk the tiers from a wide terminal down to a sliver and assert
 * what survives: the numbers outlive the hint, the bar disappears before the
 * numbers do, and the right cluster never moves its separator as values tick.
 */
import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildPalette, plainPalette } from '../src/theme.js';
import { GROUP_SEP, ITEM_SEP, humanTokens, statusLine, type StatusInput } from '../src/status-bar.js';

const palette = plainPalette();

const base = (over: Partial<StatusInput> = {}): StatusInput => ({
  cols: 120,
  usedTokens: 42_000,
  contextWindow: 200_000,
  zones: { prompt: 20_000, schema: 6_000, fragment: 4_000, skills: 1_000, messages: 11_000 },
  model: 'deepseek/deepseek-v4.1-flash',
  codeMode: 'native',
  approvalMode: 'read-only',
  tps: 12.34,
  cacheHitRate: 0.93,
  ...over,
});

describe('the full line', () => {
  it('spells out model, mode and approval, and keeps its total within the width', () => {
    const view = statusLine(base(), palette);
    expect(view.line).toContain('deepseek/deepseek-v4.1-flash');
    expect(view.line).toContain('普通');
    expect(view.line).toContain('只读');
    expect(view.line.length).toBeLessThanOrEqual(120);
  });

  it('separates groups and items with their own, different separators', () => {
    const line = statusLine(base(), palette).line;
    expect(line).toContain(GROUP_SEP);
    expect(line).toContain(ITEM_SEP);
    expect(GROUP_SEP.length).toBe(3);
    expect(ITEM_SEP.length).toBe(3);
  });

  it('reports where the gauge sits, for hover hit-testing', () => {
    const view = statusLine(base(), palette);
    expect(view.gaugeCols?.start).toBe(0);
    expect(view.gaugeCols?.end).toBeGreaterThan(10);
  });

  it('shows the numbers and the percentage of the context window', () => {
    expect(statusLine(base(), palette).line).toContain('42k/200k · 21%');
  });
});

describe('what survives when space runs out', () => {
  const withHint = (cols: number): StatusInput => base({ cols, transient: '已中断' });
  const line = (cols: number): string => statusLine(withHint(cols), palette).line;
  /** The narrowest width at which a feature is still drawn. */
  const narrowest = (feature: (text: string) => boolean): number => {
    for (let cols = 30; cols <= 200; cols++) if (feature(line(cols))) return cols;
    throw new Error('feature never drawn');
  };

  it('degrades monotonically: a narrower line never re-introduces a field', () => {
    const features = (text: string): Record<string, boolean> => ({
      hint: text.includes('已中断'),
      provider: text.includes('deepseek/'),
      labels: text.includes('只读'),
      bar: text.includes('█'),
      numbers: text.includes('42k/200k'),
      model: text.includes('flash'),
    });
    const gone = new Set<string>();
    for (let cols = 200; cols >= 24; cols--) {
      const now = features(line(cols));
      for (const [name, present] of Object.entries(now)) {
        if (gone.has(name)) expect(present, `${name} came back at cols=${cols}`).toBe(false);
        if (!present) gone.add(name);
      }
    }
    expect(gone.size).toBeGreaterThan(3); // it really did shed fields
  });

  it('drops the transient hint before anything carrying a number', () => {
    const hint = narrowest((t) => t.includes('已中断'));
    const numbers = narrowest((t) => t.includes('42k/200k'));
    expect(hint).toBeGreaterThan(numbers);
  });

  it('gives up the model name before the numbers', () => {
    const model = narrowest((t) => t.includes('flash'));
    const numbers = narrowest((t) => t.includes('42k/200k'));
    expect(model).toBeGreaterThan(numbers);
  });

  it('shrinks approval to one character and truncates the model on the way down', () => {
    const word = narrowest((t) => t.includes('只读'));
    const char = narrowest((t) => t.includes(' · 读'));
    const bare = narrowest((t) => t.includes('deepseek-v4.1-flash'));
    const truncated = narrowest((t) => t.includes('deepseek-v4.1-f…'));
    // Narrower forms appear at narrower widths — never the other way round.
    expect(char).toBeLessThan(word);
    expect(truncated).toBeLessThan(bare);
  });

  it('never exceeds the width it was given', () => {
    for (let cols = 20; cols <= 130; cols += 3) {
      expect(statusLine(base({ cols }), palette).line.length, `cols=${cols}`).toBeLessThanOrEqual(cols);
    }
  });
});

describe('the gauge', () => {
  it('drops the whole bar when not a single cell would be filled', () => {
    const view = statusLine(base({ usedTokens: 13_000, contextWindow: 1_000_000 }), palette);
    expect(view.line).not.toContain('░');
    expect(view.line).toContain('13k/1.0M · 1%');
  });

  it('draws the bar once a cell exists, with an unfilled remainder', () => {
    const line = statusLine(base({ usedTokens: 100_000, contextWindow: 200_000 }), palette).line;
    expect(line).toContain('█');
    expect(line).toContain('░');
  });

  it('vanishes entirely when the window is unknown', () => {
    const view = statusLine(base({ contextWindow: null }), palette);
    expect(view.gaugeCols).toBeUndefined();
    expect(view.line).not.toContain('42k/');
  });

  it('announces compaction only when it is approaching', () => {
    expect(statusLine(base({ compactRatio: 0.3 }), palette).line).not.toContain('压缩');
    expect(statusLine(base({ compactRatio: 0.62 }), palette).line).toContain('压缩 62%');
  });
});

describe('the right cluster', () => {
  it('pads its numbers so a ticking value cannot move the separator', () => {
    const slow = statusLine(base({ tps: 9.5 }), palette).line;
    const fast = statusLine(base({ tps: 120 }), palette).line;
    expect(slow.indexOf(ITEM_SEP, slow.indexOf('⚡'))).toBe(fast.indexOf(ITEM_SEP, fast.indexOf('⚡')));
    expect(slow).toContain('⚡  9.5');
    expect(fast).toContain('⚡120.0');
  });

  it('hides tps until something is being generated, and cache until it is reported', () => {
    const line = statusLine(base({ tps: 0, cacheHitRate: null }), palette).line;
    expect(line).not.toContain('⚡');
    expect(line).not.toContain('cache');
  });
});

describe('a colour terminal', () => {
  const color = buildPalette({ color: true, truecolor: true });

  it('lays out by display columns, not by escape bytes', () => {
    const plain = statusLine(base(), palette);
    const painted = statusLine(base(), color);
    // Same tier as the uncoloured terminal: counting the SGR bytes would have
    // dropped fields a 120-column terminal has room for.
    expect(painted.line).toContain('deepseek/deepseek-v4.1-flash');
    expect(painted.line).toContain('只读');
    expect(painted.line).toContain('⚡');
    expect(styledWidth(painted.line)).toBe(styledWidth(plain.line));
    expect(painted.line.length).toBeGreaterThan(styledWidth(painted.line));
  });

  it('reports the gauge columns for hover hit-testing in display width', () => {
    const view = statusLine(base(), color);
    expect(view.gaugeCols?.end).toBeLessThan(40);
  });
});

describe('humanTokens', () => {
  it('keeps small numbers exact and abbreviates large ones', () => {
    expect(humanTokens(999)).toBe('999');
    expect(humanTokens(4_200)).toBe('4.2k');
    expect(humanTokens(42_000)).toBe('42k');
    expect(humanTokens(1_000_000)).toBe('1.0M');
  });
});