import { describe, expect, it } from 'vitest';
import { createComposer } from '../src/composer.js';
import { buildFrame, type FrameInput } from '../src/frame.js';
import { composerCard } from '../src/panels.js';
import { Scrollback } from '../src/scrollback.js';
import { plainPalette } from '../src/theme.js';

const palette = plainPalette();
const COLS = 40;
const ROWS = 20;

function entry(id: string, lines: string[], extra: Partial<{ dense: boolean; vpad: number; center: boolean }> = {}) {
  return { id, lines, dense: false, ...extra };
}

function input(overrides: Partial<FrameInput> = {}): FrameInput {
  const scrollback = new Scrollback();
  scrollback.setEntries([entry('a', ['A1', 'A2']), entry('b', ['B1'])]);
  return {
    cols: COLS,
    rows: ROWS,
    scrollback,
    composer: composerCard({ cols: COLS, composer: createComposer(), palette }),
    status: 'STATUS',
    hints: 'HINTS',
    ...overrides,
  };
}

describe('buildFrame', () => {
  it('always produces exactly the requested number of rows', () => {
    const cases: FrameInput[] = [
      input(),
      input({ rows: 8 }),
      input({ turn: '⠙ 思考中' }),
      input({ popup: ['p1', 'p2'] }),
      input({ queue: ['q1'] }),
      input({ status: '', hints: '' }),
      input({ rows: 6, turn: 'x', popup: ['p'], queue: ['q'] }),
    ];
    for (const frame of cases) expect(buildFrame(frame).lines).toHaveLength(frame.rows);
  });

  it('pins the composer card to the bottom, status and hints below it', () => {
    const frame = buildFrame(input());
    const card = composerCard({ cols: COLS, composer: createComposer(), palette });
    const top = ROWS - card.lines.length - 2;
    expect(frame.lines.slice(top, top + card.lines.length)).toEqual(card.lines);
    expect(frame.lines.at(-2)).toBe('STATUS');
    expect(frame.lines.at(-1)).toBe('HINTS');
  });

  it('puts the caret inside the composer card', () => {
    const frame = buildFrame(input());
    const card = composerCard({ cols: COLS, composer: createComposer(), palette });
    const top = ROWS - card.lines.length - 2;
    expect(frame.cursor.row).toBe(top + card.cursorRow);
    expect(frame.lines[frame.cursor.row]).toContain('描述任务');
    expect(frame.cursor.col).toBeGreaterThan(0);
    expect(frame.cursor.col).toBeLessThan(COLS);
  });

  it('anchors the newest transcript line to the bottom of its region', () => {
    const frame = buildFrame(input());
    const rows = frame.viewport.screen.length;
    // Content is A1 A2 · B1 — four rows with the gap — so it fills the tail of
    // the region and the blank floats up above it.
    expect(frame.lines[rows - 1]).toBe('B1');
    expect(frame.lines[rows - 2]).toBe('');
    expect(frame.lines[rows - 3]).toBe('A2');
    expect(frame.lines[rows - 4]).toBe('A1');
    expect(frame.lines[0]).toBe('');
  });

  it('maps screen rows back to entries for hit-testing', () => {
    const frame = buildFrame(input());
    const rows = frame.viewport.screen.length;
    expect(frame.owners[rows - 1]).toBe(1);
    expect(frame.owners[rows - 2]).toBe(-1); // the gap row between two entries
    expect(frame.owners[rows - 3]).toBe(0);
    expect(frame.owners[0]).toBe(-1); // blank above the content
  });

  it('gives the turn row a row of its own, shrinking the transcript', () => {
    const idle = buildFrame(input());
    const running = buildFrame(input({ turn: '⠙ 思考中' }));
    const transcriptRows = running.viewport.screen.length;
    // The breath row still separates the transcript from the live row.
    expect(running.lines[transcriptRows]).toBe('');
    expect(running.lines[transcriptRows + 1]).toBe('⠙ 思考中');
    expect(transcriptRows).toBe(idle.viewport.screen.length - 1);
  });

  it('scrolling up walks the transcript backwards, not the frame', () => {
    const scrollback = new Scrollback();
    scrollback.setEntries(Array.from({ length: 12 }, (_, i) => entry(`e${i}`, [`line ${i}`])));
    const atBottom = buildFrame(input({ scrollback }));
    const region = atBottom.viewport.screen.length;
    expect(atBottom.lines.slice(0, region)).toContain('line 11');
    scrollback.scrollBy(3, region);
    const scrolled = buildFrame(input({ scrollback }));
    expect(scrolled.lines.slice(0, region)).not.toContain('line 11');
    expect(scrolled.lines.slice(0, region)).toContain('line 9');
    expect(scrolled.viewport.atBottom).toBe(false);
    expect(scrolled.lines.at(-1)).toBe('HINTS');
  });

  it('keeps every fixed row on screen when the popup is tall', () => {
    const frame = buildFrame(input({ rows: 12, popup: ['p1', 'p2', 'p3', 'p4'] }));
    expect(frame.lines).toHaveLength(12);
    // Transcript region, breath row, then the popup.
    const region = frame.viewport.screen.length;
    expect(frame.lines.slice(region, region + 4)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(frame.lines.at(-1)).toBe('HINTS');
  });
});