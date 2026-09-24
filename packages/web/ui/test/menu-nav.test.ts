/**
 * Direct lane for the select menu's index walking (the component lane has no
 * DOM): wrap-around stepping, the open-focus target, and the guard that keeps
 * a stale index from being focused.
 */
import { describe, expect, it } from 'vitest';
import { initialOptionIndex, isOptionIndex, stepOptionIndex } from '../src/conversation/menu-nav.js';

describe('stepOptionIndex', () => {
  it('wraps in both directions', () => {
    expect(stepOptionIndex(0, 3, 1)).toBe(1);
    expect(stepOptionIndex(2, 3, 1)).toBe(0);
    expect(stepOptionIndex(0, 3, -1)).toBe(2);
    expect(stepOptionIndex(1, 3, -1)).toBe(0);
  });

  it('enters the list from either end when nothing is focused', () => {
    expect(stepOptionIndex(-1, 3, 1)).toBe(0);
    expect(stepOptionIndex(-1, 3, -1)).toBe(2);
    expect(stepOptionIndex(9, 3, 1)).toBe(0);
  });

  it('has no target in an empty menu', () => {
    expect(stepOptionIndex(0, 0, 1)).toBe(-1);
    expect(stepOptionIndex(-1, 0, -1)).toBe(-1);
  });
});

describe('initialOptionIndex', () => {
  it('focuses the selected row when the menu has one', () => {
    expect(initialOptionIndex(3, 2)).toBe(2);
  });

  it('falls back to the first row for no/foreign selection', () => {
    expect(initialOptionIndex(3, -1)).toBe(0);
    expect(initialOptionIndex(3, 7)).toBe(0);
    expect(initialOptionIndex(0, 0)).toBe(-1);
  });
});

describe('isOptionIndex', () => {
  it('accepts only in-range indices', () => {
    expect(isOptionIndex(0, 3)).toBe(true);
    expect(isOptionIndex(2, 3)).toBe(true);
    expect(isOptionIndex(3, 3)).toBe(false);
    expect(isOptionIndex(-1, 3)).toBe(false);
    expect(isOptionIndex(0, 0)).toBe(false);
  });
});