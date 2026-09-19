/**
 * Entry assembly is where the transcript's shape is decided, so the tests here
 * drive *blocks in, lines out*: a burst of read-only calls becomes one header,
 * a shell command stays its own row, a question gets its two blank rows, and
 * everything lands inside the content column.
 */
import { describe, expect, it } from 'vitest';
import { plainPalette } from '../src/theme.js';
import type { Block } from '../src/blocks.js';
import { buildEntries } from '../src/entries.js';
import { paintBlock } from '../src/render.js';
import { CONTENT_COL } from '../src/layout.js';

const palette = plainPalette();
const opts = { tick: 0, idle: false };

const tool = (id: string, name: string, kind: 'read' | 'execute', over: Partial<Extract<Block, { kind: 'tool' }>> = {}): Block => ({
  id,
  kind: 'tool',
  callId: id,
  name,
  args: '{}',
  view: kind === 'read' ? { card: 'generic', kind: 'read', title: `${id}.ts` } : { card: 'terminal', command: 'pnpm test' },
  startedAt: 0,
  endedAt: 10,
  expanded: false,
  failed: false,
  ...over,
});

const entries = (blocks: Block[], cols = 80) => buildEntries({ blocks, cols, palette, paintBlock, opts });

describe('tool grouping in the transcript', () => {
  it('folds a burst of read-only calls into one header', () => {
    const built = entries([tool('a', 'read_file', 'read'), tool('b', 'read_file', 'read'), tool('c', 'read_file', 'read')]);
    expect(built).toHaveLength(1);
    expect(built[0]!.lines).toHaveLength(1);
    expect(built[0]!.lines[0]).toContain('◈');
    expect(built[0]!.lines[0]).toContain('读取 3 个文件');
    expect(built[0]!.dense).toBe(true);
  });

  it('a shell command keeps its own row and splits the run', () => {
    const built = entries([tool('a', 'read_file', 'read'), tool('b', 'bash', 'execute'), tool('c', 'read_file', 'read')]);
    expect(built).toHaveLength(3);
    expect(built[1]!.lines[0]).toContain('$ pnpm test');
  });

  it('a group header turns present-tense while a member runs', () => {
    const running = tool('b', 'read_file', 'read', { result: undefined, endedAt: undefined });
    const label = entries([tool('a', 'read_file', 'read'), running])[0]!.lines[0]!;
    expect(label).toContain('正在读取');
  });

  it('a failure in the group is reported in the header, not swallowed', () => {
    const failed = tool('b', 'read_file', 'read', { failed: true });
    const label = entries([tool('a', 'read_file', 'read'), failed])[0]!.lines[0]!;
    expect(label).toContain('1 失败');
  });

  it('an expanded member is rendered on its own but does not split the run', () => {
    const expanded = tool('b', 'read_file', 'read', { expanded: true });
    const built = entries([tool('a', 'read_file', 'read'), expanded, tool('c', 'read_file', 'read')]);
    expect(built).toHaveLength(2); // header + the expanded row
    expect(built[0]!.lines[0]).toContain('读取 2 个文件');
    expect(built[1]!.lines[0]).toContain('b.ts');
  });
});

describe('spacing', () => {
  it('a user prompt carries the pad that makes it a question', () => {
    const built = entries([{ id: 'u', kind: 'user', text: 'do the thing' }]);
    expect(built[0]!.vpad).toBe(1);
  });

  it('tool rows are dense; prose is not', () => {
    const built = entries([tool('a', 'bash', 'execute'), { id: 't', kind: 'text', text: 'answer', streaming: false }]);
    expect(built[0]!.dense).toBe(true);
    expect(built[1]!.dense).toBe(false);
  });
});

describe('columns and wrapping', () => {
  it('every line starts at the content column', () => {
    const built = entries([{ id: 'u', kind: 'user', text: 'hello' }, { id: 't', kind: 'text', text: 'world', streaming: false }]);
    for (const entry of built) {
      for (const line of entry.lines) {
        expect(line.startsWith(' '.repeat(CONTENT_COL))).toBe(true);
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('wraps a long answer to the width instead of overflowing', () => {
    const long = '这是一段很长的中文回答，用来验证折行是否按显示列而不是字符数来算，'.repeat(4);
    const built = entries([{ id: 't', kind: 'text', text: long, streaming: false }], 40);
    expect(built[0]!.lines.length).toBeGreaterThanOrEqual(4);
    for (const line of built[0]!.lines) expect(line.length).toBeLessThanOrEqual(40);
  });

  it('keeps a tool row inside the budget even when the payload is huge', () => {
    const big = tool('a', 'read_file', 'read');
    const built = entries([{ ...big, result: { card: 'read', path: 'a.ts', lineCount: 1, truncated: false } }], 30);
    for (const line of built[0]!.lines) expect(line.length).toBeLessThanOrEqual(30);
  });
});