/**
 * The right panel's tab vocabulary (`rightbar/tabs.ts`).
 *
 * The rule this file exists for: **an unreadable preference must not blank the
 * panel.** `localStorage` carries whatever an older strip, another build, or a
 * curious reader left there, and the panel has three bodies behind one switch —
 * so a value that is not one of them has to resolve to the default rather than
 * to an empty box.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB,
  isTabId,
  readTabPreference,
  RIGHTBAR_TABS,
  TAB_STORAGE_KEY,
  writeTabPreference,
} from '../src/rightbar/tabs.js';

/** Install a minimal `window.localStorage` for one test. */
function stubStorage(initial: Record<string, string> = {}): Record<string, string> {
  const store: Record<string, string> = { ...initial };
  const target = globalThis as { window?: unknown };
  target.window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
    },
  };
  return store;
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('right panel tabs', () => {
  it('offers the three pages, with a default that is one of them', () => {
    expect(RIGHTBAR_TABS.map((tab) => tab.id)).toEqual(['changes', 'files', 'terminal']);
    expect(RIGHTBAR_TABS.map((tab) => tab.label)).toEqual(['变更', '文件', '终端']);
    expect(isTabId(DEFAULT_TAB)).toBe(true);
  });

  it('recognizes only its own ids', () => {
    expect(isTabId('terminal')).toBe(true);
    expect(isTabId('diffs')).toBe(false);
    expect(isTabId(undefined)).toBe(false);
    expect(isTabId(7)).toBe(false);
  });

  it('resolves a stale or hostile stored value to the default', () => {
    // The killing case: an id from a future strip (or any junk) must open a real
    // page, never an empty body.
    stubStorage({ [TAB_STORAGE_KEY]: 'browser' });
    expect(readTabPreference()).toBe(DEFAULT_TAB);
  });

  it('remembers the tab the reader moved to', () => {
    const store = stubStorage();
    writeTabPreference('terminal');
    expect(store[TAB_STORAGE_KEY]).toBe('terminal');
    expect(readTabPreference()).toBe('terminal');
  });

  it('works with no storage at all', () => {
    // A browser that refuses storage (private mode, disabled cookies) still gets
    // a working panel: the preference is a convenience, not a dependency.
    expect(readTabPreference()).toBe(DEFAULT_TAB);
    expect(() => { writeTabPreference('files'); }).not.toThrow();
  });
});
