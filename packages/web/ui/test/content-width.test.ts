/**
 * Direct lane for the content-width axis (no DOM, no browser): the clamp the
 * stylesheet applies, the dragged preference's clamps, and the symmetric
 * handle gesture. The measurement plumbing (ResizeObserver / pointer capture)
 * is not here — only the arithmetic it feeds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_EDGE_BUDGET,
  CONTENT_MIN,
  WIDTH_PREF_KEY,
  handleWidth,
  readWidthPreference,
  resolveContentWidth,
  writeWidthPreference,
} from '../src/conversation/content-width.js';

const REAL_STORAGE = globalThis.localStorage;

/** A storage stub: the module only ever reads/writes one key. */
function storeWith(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

afterEach(() => {
  globalThis.localStorage = REAL_STORAGE;
});

describe('resolveContentWidth', () => {
  it('takes the reference two-step column: 896 from 864, 1152 from 1280', () => {
    // Below the first breakpoint the content is full width minus the 32px
    // side clearance; at 864 the column gives up 6rem (capped at max-w-4xl),
    // at 1280 it gives up 24rem (capped at max-w-6xl) — the content GROWS with
    // a wide window instead of sitting under one fixed cap.
    expect(resolveContentWidth(500, null)).toBe(468);
    expect(resolveContentWidth(900, null)).toBe(804);
    expect(resolveContentWidth(1000, null)).toBe(896);
    expect(resolveContentWidth(1400, null)).toBe(1016);
    expect(resolveContentWidth(2000, null)).toBe(1152);
  });

  it('lets a dragged preference replace the adaptive term wholesale', () => {
    expect(resolveContentWidth(2000, 1500)).toBe(1500);
  });

  it('clamps a preference by the column floor and its edge budget', () => {
    expect(resolveContentWidth(2000, 500)).toBe(CONTENT_MIN);
    // The handles need CONTENT_EDGE_BUDGET of column left over to stay reachable.
    expect(resolveContentWidth(2000, 5000)).toBe(2000 - CONTENT_EDGE_BUDGET);
    // On a column too narrow for the budget the min wins: never below 640.
    expect(resolveContentWidth(700, 900)).toBe(CONTENT_MIN);
  });
});

describe('handleWidth', () => {
  it('widens by 2× the pointer distance (both sides write one centered width)', () => {
    expect(handleWidth('right', 700, 40)).toBe(780);
    expect(handleWidth('left', 700, 40)).toBe(620);
  });

  it('reads the left strip outward as the pointer moves left', () => {
    expect(handleWidth('left', 700, -40)).toBe(780);
    expect(handleWidth('right', 700, -40)).toBe(620);
  });
});

describe('the width preference boundary', () => {
  it('names the durable key', () => {
    expect(WIDTH_PREF_KEY).toBe('nova.conversation.contentWidth');
  });

  it('resolves a missing, corrupt or non-positive value to no preference', () => {
    globalThis.localStorage = storeWith();
    expect(readWidthPreference()).toBeNull();
    globalThis.localStorage = storeWith({ [WIDTH_PREF_KEY]: 'wide' });
    expect(readWidthPreference()).toBeNull();
    globalThis.localStorage = storeWith({ [WIDTH_PREF_KEY]: '0' });
    expect(readWidthPreference()).toBeNull();
    globalThis.localStorage = storeWith({ [WIDTH_PREF_KEY]: '-40' });
    expect(readWidthPreference()).toBeNull();
  });

  it('reads back only positive finite numbers', () => {
    globalThis.localStorage = storeWith({ [WIDTH_PREF_KEY]: '820' });
    expect(readWidthPreference()).toBe(820);
  });

  it('writes the resolved width under the one key', () => {
    const store = storeWith();
    globalThis.localStorage = store;
    writeWidthPreference(764);
    expect(store.getItem(WIDTH_PREF_KEY)).toBe('764');
  });
});