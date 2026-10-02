import { describe, expect, it } from 'vitest';
import type { ContextBreakdown, ContextTimeline } from '../src/types.js';
import { compositionBar, compositionSlots, occupancy, percentOf, staggerStyle, statCells } from '../src/context/context-model.js';
import { trendChart } from '../src/context/trend-model.js';
import { visibleMax } from '../src/context/trend-geometry.js';
import { elementBoard } from '../src/context/element-model.js';
import { fileRows } from '../src/context/file-model.js';

/** A breakdown with one category filled and the rest zero. */
function cats(overrides: Partial<ContextBreakdown> = {}): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0, ...overrides };
}

function timeline(overrides: Partial<ContextTimeline> = {}): ContextTimeline {
  return {
    truncated: false,
    live: { cats: cats({ system: 100, user: 300 }), total: 400, elements: [] },
    counts: { requests: 2, turns: 1, toolCalls: 0, compactions: 0 },
    points: [],
    events: [],
    files: [],
    ...overrides,
  };
}

describe('percentOf', () => {
  it('rounds a share and never divides by an empty total', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(250, 1000)).toBe(25);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe('composition slots', () => {
  it('keeps every category in a fixed order and pins each to its share', () => {
    const slots = compositionSlots(cats({ system: 100, user: 300 }), 1000);
    expect(slots.map((slot) => slot.cat)).toEqual(['system', 'tools', 'injected', 'user', 'assistant', 'tool']);
    expect(slots.find((slot) => slot.cat === 'system')!.share).toBeCloseTo(0.1);
    expect(slots.find((slot) => slot.cat === 'user')!.share).toBeCloseTo(0.3);
    expect(slots.find((slot) => slot.cat === 'tools')!.share).toBe(0);
  });

  it('falls back to the estimate total when no window is known', () => {
    const slots = compositionSlots(cats({ system: 100, user: 300 }));
    expect(slots.find((slot) => slot.cat === 'user')!.share).toBeCloseTo(0.75);
  });

  it('never overflows the bar when the estimate exceeds the window', () => {
    const slots = compositionSlots(cats({ injected: 4000 }), 1000);
    expect(slots.every((slot) => slot.share <= 1)).toBe(true);
    expect(slots.find((slot) => slot.cat === 'injected')!.share).toBe(1);
  });

  it('paints every category from a declared token, never a literal colour', () => {
    for (const slot of compositionSlots(cats({ system: 1 }), 10)) {
      expect(slot.color.startsWith('var(--dsw-static-')).toBe(true);
    }
    expect(compositionSlots(cats({ system: 1 }), 10).map((slot) => slot.color)).toEqual(
      Array.from(new Set(compositionSlots(cats({ system: 1 }), 10).map((slot) => slot.color))),
    );
  });
});

describe('composition bar', () => {
  it('lays the segments out against the window, leaving the rest free', () => {
    const bar = compositionBar(cats({ system: 100, user: 300 }), 1000);
    const system = bar.segments.find((segment) => segment.cat === 'system')!;
    const user = bar.segments.find((segment) => segment.cat === 'user')!;
    expect(system.left).toBe(0);
    expect(system.width).toBeCloseTo(10);
    expect(user.left).toBeCloseTo(10);
    expect(user.width).toBeCloseTo(30);
    expect(bar.usedPercent).toBe(40);
    // The hover anchor is the segment's own span, and stays inside the track.
    expect(system.center).toBeCloseTo(5);
    expect(user.center).toBeCloseTo(25);
  });

  it('saturates the scale on an overflowing estimate instead of drawing past the track', () => {
    const bar = compositionBar(cats({ injected: 4000 }), 1000);
    expect(bar.scale).toBe(4000);
    expect(bar.usedPercent).toBe(100);
    expect(bar.segments.find((segment) => segment.cat === 'injected')!.width).toBeCloseTo(100);
  });

  it('reports each segment as a share of the occupied total', () => {
    const bar = compositionBar(cats({ system: 100, user: 300 }), 1000);
    expect(bar.segments.find((segment) => segment.cat === 'system')!.pct).toBe(25);
    expect(bar.segments.find((segment) => segment.cat === 'user')!.pct).toBe(75);
  });
});

describe('occupancy', () => {
  it('states a ratio only when a window is known', () => {
    expect(occupancy(timeline(), 1000)).toEqual({ tokens: 400, window: 1000, ratio: 0.4 });
    expect(occupancy(timeline())).toEqual({ tokens: 400 });
  });

  it('treats a zero or negative window as unknown rather than dividing', () => {
    expect(occupancy(timeline(), 0)).toEqual({ tokens: 400 });
  });
});

describe('stagger slot', () => {
  it('passes the column index through as the --lc-i slot', () => {
    expect(staggerStyle(0)).toEqual({ '--lc-i': 0 });
    expect(staggerStyle(7)).toEqual({ '--lc-i': 7 });
  });

  it('caps the slot so a long log still settles in about a second', () => {
    expect(staggerStyle(19)).toEqual({ '--lc-i': 19 });
    expect(staggerStyle(20)).toEqual({ '--lc-i': 20 });
    expect(staggerStyle(500)).toEqual({ '--lc-i': 20 });
  });
});

describe('trend chart', () => {
  const points = [
    { seq: 1, at: 10, cats: cats({ system: 100 }), total: 100 },
    { seq: 2, at: 20, cats: cats({ system: 100, tool: 300 }), total: 400, prompt: 512, cached: 400, output: 12 },
  ];

  it('draws the requests oldest first, so the trend reads left to right', () => {
    expect(trendChart(points).bars.map((bar) => bar.at)).toEqual([10, 20]);
  });

  it('scales every height against the tallest request, so the trend shows its own shape', () => {
    const chart = trendChart(points);
    expect(chart.scale).toBe(400);
    expect(chart.bars[0]!.height).toBeCloseTo(0.25);
    expect(chart.bars[1]!.height).toBe(1);
    // The model window is NOT the axis: at 1.05M both bars would sit within 2%
    // of the floor and the chart would say nothing — the regression this pins.
    expect(chart.ticks[0]!.label).toBe('400');
  });

  it('rescales to the peak in view when the 自适应 switch overrides it', () => {
    const chart = trendChart(points, 200);
    expect(chart.scale).toBe(200);
    expect(chart.bars[0]!.height).toBeCloseTo(0.5);
    // A bar taller than the visible peak saturates instead of overflowing.
    expect(chart.bars[1]!.height).toBe(1);
  });

  it('ignores an empty override, so a zero-peak window keeps the whole-log scale', () => {
    expect(trendChart(points, 0).scale).toBe(400);
  });

  it('stacks only the categories in use, in reading order', () => {
    const [, second] = trendChart(points).bars;
    expect(second!.segments.map((segment) => segment.cat)).toEqual(['system', 'tool']);
    expect(second!.segments.map((segment) => segment.pct)).toEqual([25, 75]);
  });

  it('carries provider-reported usage alongside the estimate', () => {
    const [, second] = trendChart(points).bars;
    expect(second).toMatchObject({ prompt: 512, cached: 400, output: 12 });
  });

  it('labels the axis from the scale down to zero', () => {
    const chart = trendChart(points);
    expect(chart.ticks.map((tick) => tick.frac)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(chart.ticks[0]!.label).toBe('400');
    expect(chart.ticks[4]!.label).toBe('0');
  });

  it('survives an all-zero session without dividing by zero', () => {
    expect(trendChart([{ seq: 1, at: 0, cats: cats(), total: 0 }]).bars.map((bar) => bar.height)).toEqual([0]);
  });
});

describe('trend visible window', () => {
  // Columns are 14px boxes on a 16px pitch starting at x=2 (`.trendBar` +
  // `.chart`), so column i spans [2+16i, 16+16i): 0:[2,16) 1:[18,32) 2:[34,48)
  // 3:[50,64) 4:[66,80). The tall columns sit at both ends on purpose — a
  // window that forgets either edge changes the peak.
  const points = [100, 900, 300, 700, 200].map((total, index) => ({
    seq: index + 1,
    at: index,
    cats: cats(),
    total,
  }));

  it('reports the peak of the columns in view, not of the whole log', () => {
    expect(visibleMax(points, 0, 100)).toBe(900);
    // [34,68) holds columns 2..4: the 900 at column 1 must not leak in.
    expect(visibleMax(points, 34, 34)).toBe(700);
  });

  it('drops a column whose box ends inside the left edge and one starting past the right', () => {
    // [34,50): column 2 only — column 1 ends at 32, column 3 starts at 50.
    expect(visibleMax(points, 34, 16)).toBe(300);
  });

  it('counts a partially visible column — it is what the reader is looking at', () => {
    // [30,34) overlaps column 1's tail by 2px.
    expect(visibleMax(points, 30, 4)).toBe(900);
  });

  it('answers zero when the window holds no column at all', () => {
    expect(visibleMax(points, 200, 100)).toBe(0);
    expect(visibleMax([], 0, 100)).toBe(0);
  });
});

describe('element board', () => {
  it('groups the window into one card per category, in reading order', () => {
    const board = elementBoard(
      [
        { seq: 1, cat: 'tools', label: 'read_file', tokens: 300, preview: '{' },
        { seq: 2, cat: 'system', label: 'prompt', tokens: 100 },
        { seq: 3, cat: 'tools', label: 'bash', tokens: 50 },
      ],
      450,
    );
    expect(board.groups.map((group) => group.cat)).toEqual(['system', 'tools']);
    expect(board.groups.map((group) => group.label)).toEqual(['系统提示', '工具定义']);
    expect(board.groups[1]).toMatchObject({ count: 2, tokens: 350, pct: 78 });
    expect(board.groups[1]!.color).toBe('var(--dsw-static-amber-500)');
    // Heaviest-first INSIDE the card: the header states the category, the rows
    // answer "what is taking the room".
    expect(board.groups[1]!.rows.map((row) => row.label)).toEqual(['read_file', 'bash']);
    expect(board.groups[1]!.rows[0]).toMatchObject({ tokens: 300, pct: 67, preview: '{' });
  });

  it('skips an empty category rather than drawing a card with nothing in it', () => {
    expect(elementBoard([], 0)).toEqual({ groups: [] });
    expect(elementBoard([{ seq: 1, cat: 'tool', label: 'a', tokens: 1 }], 1).groups.map((g) => g.cat)).toEqual(['tool']);
  });
});

describe('file rows', () => {
  it('badges every purpose the run exercised, read → write → search', () => {
    const rows = fileRows([
      { path: 'a.ts', reads: 1, writes: 2, searches: 3, added: 5, removed: 3, seq: 9 },
      { path: 'b.ts', reads: 4, writes: 0, searches: 0, added: 0, removed: 0, seq: 8 },
    ]);
    // The badges are the row's summary: a file both read AND written reports
    // both, where a dominance rule would have hidden one of them.
    expect(rows[0]!.badges).toEqual([
      { kind: 'read', label: '读取', count: 1 },
      { kind: 'write', label: '写入', count: 2 },
      { kind: 'search', label: '搜索', count: 3 },
    ]);
    expect(rows[0]!.added).toBe(5);
    expect(rows[0]!.removed).toBe(3);
    expect(rows[0]!.ops).toBe(6);
    expect(rows[1]!.badges).toEqual([{ kind: 'read', label: '读取', count: 4 }]);
  });
});

describe('stat cells', () => {
  it('reads the cache hit off the newest request that reported usage', () => {
    const cells = statCells(
      timeline({
        points: [
          { seq: 1, at: 0, cats: cats({ system: 10 }), total: 10, prompt: 100, cached: 10, output: 1 },
          { seq: 2, at: 0, cats: cats({ system: 10 }), total: 10, prompt: 200, cached: 150, output: 1 },
          { seq: 3, at: 0, cats: cats({ system: 10 }), total: 10 },
        ],
      }),
    );
    expect(cells.map((cell) => cell.label)).toEqual(['轮次', '请求', '工具调用', '缓存命中']);
    expect(cells[3]!.value).toBe('75%');
  });

  it('dashes the hit figure when no request reported usage yet', () => {
    expect(statCells(timeline())[3]!.value).toBe('—');
  });
});
