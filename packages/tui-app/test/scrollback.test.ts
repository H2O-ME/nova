/**
 * The scrollback state machine is where "how the screen reads" is decided, so
 * these tests pin the three decisions by name: breathing (one gap between
 * entries, none inside a dense run), anchoring (bottom-hugging, with the
 * welcome card as the single centered exception) and geometry (a row maps back
 * to its entry for hit-testing).
 */
import { describe, expect, it } from 'vitest';
import { Scrollback, layoutEntries, type ScrollEntry } from '../src/scrollback.js';

const entry = (id: string, lines: string | string[], extra: Partial<ScrollEntry> = {}): ScrollEntry => ({
  id,
  lines: typeof lines === 'string' ? [lines] : lines,
  dense: false,
  ...extra,
});

const rows = (viewport: { screen: string[] }): string => viewport.screen.join('|');

describe('layoutEntries', () => {
  it('puts one blank row between two ordinary entries', () => {
    const layout = layoutEntries([entry('a', 'A'), entry('b', 'B')]);
    expect(layout.starts).toEqual([0, 2]);
    expect(layout.height).toBe(3);
  });

  it('keeps a dense run glued together', () => {
    const layout = layoutEntries([
      entry('t1', 'one', { dense: true }),
      entry('t2', 'two', { dense: true }),
      entry('t3', 'three', { dense: true }),
    ]);
    expect(layout.starts).toEqual([0, 1, 2]);
    expect(layout.gaps).toEqual([0, 0, 0]);
    expect(layout.height).toBe(3);
  });

  it('breaks the dense run at a non-dense neighbour', () => {
    const layout = layoutEntries([
      entry('t1', 'one', { dense: true }),
      entry('answer', 'text'),
      entry('t2', 'two', { dense: true }),
    ]);
    expect(layout.gaps).toEqual([1, 1, 0]);
  });

  it('a prompt pad is symmetric, and its top half is skipped at the very top', () => {
    const first = layoutEntries([entry('u', 'hi', { vpad: 1 }), entry('a', 'answer')]);
    // question, its own bottom pad, the pair gap, answer.
    expect(first.starts).toEqual([0, 3]);
    expect(first.height).toBe(4);
    const second = layoutEntries([entry('a', 'answer'), entry('u', 'hi', { vpad: 1 })]);
    // the question is separated by two blank rows in both directions.
    expect(second.starts).toEqual([0, 3]);
    expect(second.height).toBe(5);
  });

  it('gives a question exactly two blank rows on each side (net 2, grok’s vpad)', () => {
    const layout = layoutEntries([
      entry('a1', 'before'),
      entry('u', 'question', { vpad: 1 }),
      entry('a2', 'after'),
    ]);
    const above = layout.starts[1]! - layout.starts[0]! - 1; // gap + top pad
    const below = layout.starts[2]! - layout.starts[1]! - 1; // bottom pad + gap
    expect(above).toBe(2);
    expect(below).toBe(2);
  });

  it('never ends the layout on a trailing gap', () => {
    const layout = layoutEntries([entry('a', 'A'), entry('b', 'B')]);
    expect(layout.height).toBe(3);
  });

  it('an empty transcript has zero height', () => {
    expect(layoutEntries([]).height).toBe(0);
  });
});

describe('viewport anchoring', () => {
  it('pins the newest line to the bottom and floats the blank upward', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['a1', 'a2', 'a3'])]);
    const view = scroll.viewport(6);
    expect(view.screen).toEqual(['', '', '', 'a1', 'a2', 'a3']);
    expect(view.atBottom).toBe(true);
    expect(view.above).toBe(0);
  });

  it('centers a lone welcome card instead of hugging the bottom', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('welcome', ['w1', 'w2'], { center: true })]);
    expect(scroll.viewport(6).screen).toEqual(['', '', 'w1', 'w2', '', '']);
  });

  it('a lone answer block still hugs the bottom — there IS history above it', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['a1', 'a2'])]);
    expect(scroll.viewport(5).screen).toEqual(['', '', '', 'a1', 'a2']);
  });

  it('a welcome card stops centering the moment a real block joins it', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('welcome', ['w1'], { center: true }), entry('u', 'hi', { vpad: 1 })]);
    // Five content rows in six — centered layout is gone, the blank goes on top.
    expect(scroll.viewport(6).screen).toEqual(['', 'w1', '', '', 'hi', '']);
  });

  it('does not center once the transcript has real history', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('u', 'hi'), entry('a', 'answer')]);
    // Two entries, three content rows in six: blank belongs above the content.
    expect(scroll.viewport(6).screen).toEqual(['', '', '', 'hi', '', 'answer']);
  });

  it('scrolls up by whole rows and reports what is below', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['1', '2', '3', '4', '5'])]);
    scroll.scrollBy(1, 3);
    const view = scroll.viewport(3);
    expect(view.screen).toEqual(['2', '3', '4']);
    expect(view.below).toBe(1);
    expect(view.atBottom).toBe(false);
    expect(view.above).toBe(1);
  });

  it('clamps scrolling at both ends', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['1', '2', '3', '4', '5'])]);
    scroll.scrollBy(99, 3);
    expect(scroll.viewport(3).screen).toEqual(['1', '2', '3']);
    scroll.scrollBy(-99, 3);
    expect(scroll.viewport(3).screen).toEqual(['3', '4', '5']);
    expect(scroll.atBottom).toBe(true);
  });

  it('keeps the scroll position when entries change under it', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['1', '2', '3', '4', '5'])]);
    scroll.scrollBy(2, 3);
    scroll.setEntries([entry('a', ['1', '2', '3', '4', '5']), entry('b', ['6'])]);
    expect(scroll.viewport(3).screen).toEqual(['3', '4', '5']);
  });

  it('an empty transcript renders blank rows, not a crash', () => {
    const scroll = new Scrollback();
    expect(scroll.viewport(3).screen).toEqual(['', '', '']);
    expect(scroll.contentHeight).toBe(0);
  });
});

describe('row → entry mapping (click hit-testing)', () => {
  it('maps content rows to their entry and gap rows to nothing', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', 'A'), entry('b', ['B1', 'B2'])]);
    expect(scroll.entryAtRow(0)).toBe(0);
    expect(scroll.entryAtRow(1)).toBe(-1); // the breathing row
    expect(scroll.entryAtRow(2)).toBe(1);
    expect(scroll.entryAtRow(3)).toBe(1);
    expect(scroll.entryAtRow(4)).toBe(-1);
  });

  it('the viewport carries an owner per screen row', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', 'A'), entry('b', 'B')]);
    const view = scroll.viewport(4);
    // Three content rows in four: the blank floats to the top.
    expect(rows(view)).toBe('|A||B');
    expect(view.owner).toEqual([-1, 0, -1, 1]);
  });

  it('the owner map follows the scroll position', () => {
    const scroll = new Scrollback();
    scroll.setEntries([entry('a', ['1', '2', '3', '4', '5'])]);
    scroll.scrollBy(1, 2);
    expect(scroll.viewport(2).owner).toEqual([0, 0]);
  });
});