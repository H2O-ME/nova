/**
 * The 变更 page's comparison choices (`rightbar/diff-view.ts`).
 *
 * The killing rule: **an unreadable or foreign value reads as the default** —
 * a storage entry from a future build (or a browser that refuses storage)
 * must leave the diff in 统一 / 不换行 rather than rendering nothing or
 * throwing inside a render pass.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIFF_LAYOUT_KEY,
  DIFF_WRAP_KEY,
  readDiffLayout,
  readDiffWrap,
  writeDiffLayout,
  writeDiffWrap,
} from '../src/rightbar/diff-view.js';

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

describe('diff view preferences', () => {
  it('round-trips the reader’s choices', () => {
    const store = stubStorage();
    expect(readDiffLayout()).toBe('unified');
    expect(readDiffWrap()).toBe(false);
    writeDiffLayout('split');
    writeDiffWrap(true);
    expect(store[DIFF_LAYOUT_KEY]).toBe('split');
    expect(store[DIFF_WRAP_KEY]).toBe('1');
    expect(readDiffLayout()).toBe('split');
    expect(readDiffWrap()).toBe(true);
    writeDiffLayout('unified');
    writeDiffWrap(false);
    expect(readDiffLayout()).toBe('unified');
    expect(readDiffWrap()).toBe(false);
  });

  it('falls back to the defaults for a value this build does not know', () => {
    stubStorage({ [DIFF_LAYOUT_KEY]: 'side-by-side', [DIFF_WRAP_KEY]: 'yes' });
    expect(readDiffLayout()).toBe('unified');
    expect(readDiffWrap()).toBe(false);
  });

  it('survives a browser that refuses storage', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readDiffLayout()).toBe('unified');
    expect(readDiffWrap()).toBe(false);
    expect(() => { writeDiffLayout('split'); writeDiffWrap(true); }).not.toThrow();
  });
});
