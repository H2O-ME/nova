/**
 * Follow-scroll ownership: the predicates that decide whether the transcript
 * follows the live tail or holds the reader's position. These are the whole
 * point of `scroll-follow.ts` being a module — the shell wires them to DOM
 * events, and the decisions themselves are testable without one.
 */
import { describe, expect, test } from 'vitest';
import {
  FOLLOW_THRESHOLD,
  anchorRow,
  atFloor,
  floorTop,
  flowTop,
  readerMoved,
  restoredTop,
} from '../src/scroll-follow.js';

/** A fake element with one fixed rect — enough for the geometry helpers. */
const at = (top: number, bottom = top): { getBoundingClientRect(): { top: number; bottom: number } } => ({
  getBoundingClientRect: () => ({ top, bottom }),
});

describe('floorTop / atFloor', () => {
  test('the floor is the content that overflows the viewport', () => {
    expect(floorTop(2000, 600)).toBe(1400);
  });

  test('content shorter than the viewport has no floor (never negative)', () => {
    expect(floorTop(300, 600)).toBe(0);
  });

  test('pinned means within the threshold of the floor', () => {
    expect(atFloor(1400, 2000, 600)).toBe(true);
    expect(atFloor(1400 - FOLLOW_THRESHOLD, 2000, 600)).toBe(true);
    // Sub-pixel floors would otherwise read as "reader scrolled up".
    expect(atFloor(1400 - FOLLOW_THRESHOLD - 1, 2000, 600)).toBe(true);
  });

  test('a reader parked further up than the threshold is not pinned', () => {
    expect(atFloor(1200, 2000, 600)).toBe(false);
    expect(atFloor(0, 2000, 600)).toBe(false);
  });
});

describe('readerMoved (the observed-top ledger)', () => {
  test('a position we wrote ourselves is not reader input', () => {
    expect(readerMoved(1400, 1400, 1400)).toBe(false);
    expect(readerMoved(800, 1400, 800)).toBe(false);
  });

  test('a sub-pixel rounding drift is not reader input', () => {
    expect(readerMoved(800.4, 1400, 800)).toBe(false);
  });

  test('a real move is reader input', () => {
    expect(readerMoved(700, 1400, 800)).toBe(true);
  });

  test('the browser shrink-clamp is not reader input', () => {
    // Content shrank under a reader parked at 1000: the browser delivers the
    // new floor. Comparing against min(ledger, floor) keeps ownership intact.
    expect(readerMoved(900, 900, 1000)).toBe(false);
  });
});

describe('flowTop / anchorRow / restoredTop', () => {
  test('row top is measured against the scrollport, not the document', () => {
    expect(flowTop(at(310), at(200))).toBe(110);
  });

  test('the anchor is the first row still reaching below the reading line', () => {
    const rows = [at(0, 40), at(48, 88), at(96, 140)];
    expect(anchorRow(rows, at(50))).toBe(rows[1]);
  });

  test('everything above the line anchors the last row (never null mid-transcript)', () => {
    const rows = [at(0, 40), at(48, 88)];
    expect(anchorRow(rows, at(300))).toBe(rows[1]);
  });

  test('an empty flow has no anchor', () => {
    expect(anchorRow([], at(0))).toBeNull();
  });

  test('restoring puts the anchored row back where it sat', () => {
    // The row was 110px below the viewport top at click time; the prepend moved
    // it to 610px. The scrollport must move down by the difference.
    expect(restoredTop(900, 610, 110)).toBe(1400);
  });
});