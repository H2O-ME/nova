/**
 * Column geometry (harness ui-layout port): the numbers the frame writes and
 * the concession ladder it applies when the frame is too narrow for both side
 * columns. Pure by design, so the rules are asserted here rather than
 * discovered by dragging a divider in a browser.
 */
import { describe, expect, it } from 'vitest';
import {
  CENTER_MIN,
  RIGHTBAR_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampWidth,
  computeColumns,
} from '../src/shell/columns.js';

describe('clampWidth', () => {
  it('keeps a drag inside the track it is allowed to occupy', () => {
    expect(clampWidth(300, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(300);
    expect(clampWidth(10, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(SIDEBAR_MIN);
    expect(clampWidth(9_999, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(SIDEBAR_MAX);
  });

  it('rounds fractional pixel widths (a pointer drag reports fractions)', () => {
    expect(clampWidth(300.4, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(300);
    expect(clampWidth(300.6, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(301);
  });
});

describe('computeColumns', () => {
  it('a wide frame gives every column what it asked for', () => {
    expect(computeColumns(1600, SIDEBAR_DEFAULT, 600)).toEqual({
      sidebar: 280,
      center: 720,
      rightbar: 600,
    });
  });

  it('a closed sidebar resolves to the rail, not to zero', () => {
    expect(computeColumns(1200, 0, 0).sidebar).toBe(SIDEBAR_COLLAPSED);
  });

  it('the right column shrinks before the centre concedes', () => {
    // 1000 - 280 - 400 = 320 available, clamped into [300, 700].
    expect(computeColumns(1000, SIDEBAR_DEFAULT, 600)).toEqual({
      sidebar: 280,
      center: 400,
      rightbar: 320,
    });
  });

  it('the right column loses its track before the centre drops below its minimum', () => {
    // 900 - 280 - 400 = 220 < RIGHTBAR_MIN: the track goes to zero and the
    // centre keeps the whole remainder.
    const cols = computeColumns(900, SIDEBAR_DEFAULT, 600);
    expect(cols.rightbar).toBe(0);
    expect(cols.center).toBe(620);
  });

it('only without the right track may the centre fall below its minimum', () => {
    const cols = computeColumns(500, SIDEBAR_DEFAULT, 0);
    expect(cols.center).toBeLessThan(CENTER_MIN);
    expect(cols.center).toBe(500 - SIDEBAR_DEFAULT);
  });

  it('the right column never exceeds 70% of the frame', () => {
    // 4000 - 280 - 400 = 3320 available, but the ratio cap is the tighter one.
    expect(computeColumns(4000, SIDEBAR_DEFAULT, 3900).rightbar).toBe(2800);
  });

  it('the rail is narrower than the sidebar floor, which sits under the breakpoint', () => {
    expect(SIDEBAR_COLLAPSED).toBeLessThan(SIDEBAR_MIN);
    expect(SIDEBAR_MIN).toBeLessThan(SIDEBAR_AUTO_COLLAPSE);
    expect(RIGHTBAR_MIN).toBeGreaterThan(CENTER_MIN / 2);
  });
});