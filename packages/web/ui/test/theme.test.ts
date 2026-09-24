/**
 * Theme vocabulary and persistence (harness ui-theme port): the severity ladder
 * (ratio → semantic token), the preference/font-size reads, and the two-file
 * boot contract — the inline script in `index.html` resolves the palette
 * before first paint from the SAME storage keys and DOM fields
 * `shell/boot-theme.ts` builds. The agreement is asserted here rather than
 * left to a typo.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampFontSize,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  readFontSize,
  readPreference,
  resolveDark,
  severityForUsage,
} from '../src/theme.js';
import { FONT_KEY, THEME_KEY, bootThemeScript } from '../src/shell/boot-theme.js';

const ATTR = 'data-ds-dark-theme';
const FONT_VAR = '--dsh-content-font-size';

describe('severityForUsage', () => {
  it('climbs the ladder business → warn → error and never returns a literal', () => {
    expect(severityForUsage(0)).toBe('var(--dsw-alias-state-business-primary)');
    expect(severityForUsage(0.69)).toBe('var(--dsw-alias-state-business-primary)');
    expect(severityForUsage(0.7)).toBe('var(--dsw-alias-state-warn-primary)');
    expect(severityForUsage(0.89)).toBe('var(--dsw-alias-state-warn-primary)');
    expect(severityForUsage(0.9)).toBe('var(--dsw-alias-state-error-primary)');
    expect(severityForUsage(1)).toBe('var(--dsw-alias-state-error-primary)');
  });
});

/** A localStorage stand-in over a Map; `throws` models private mode. */
function stubStorage(entries: Record<string, string> = {}, throws = false): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (throws) throw new Error('SecurityError');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

/**
 * Execute the boot script against a stubbed document and return what it wrote.
 * The script's whole job is to write two fields before React mounts, so the
 * only faithful way to test it is to run it and read them back — asserting the
 * text of the source only proves it mentions the right identifiers.
 */
function runBootScript(entries: Record<string, string>): { fontSize: string; dark: boolean } {
  stubStorage(entries);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const written = new Map<string, string>();
  const attributes = new Set<string>();
  const style = {
    colorScheme: '',
    setProperty: (name: string, value: string) => void written.set(name, value),
  };
  vi.stubGlobal('document', {
    documentElement: { style: { colorScheme: '' } },
    body: {
      style,
      toggleAttribute: (name: string, force: boolean) => {
        if (force) attributes.add(name);
        else attributes.delete(name);
      },
      hasAttribute: (name: string) => attributes.has(name),
    },
  });
  // The script is a self-invoking closure with no imports; `new Function` keeps
  // it in the same module registry as the globals stubbed above.
  new Function(bootThemeScript())();
  return { fontSize: written.get(FONT_VAR) ?? '', dark: attributes.has(ATTR) };
}

describe('theme preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system, the only preference that asks the browser', () => {
    stubStorage();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') }));
    expect(readPreference()).toBe('system');
    expect(resolveDark('system')).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(resolveDark('system')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
    expect(resolveDark('light')).toBe(false);
  });

  it('ignores a stored preference that is not a built-in', () => {
    stubStorage({ [THEME_KEY]: 'sepia' });
    expect(readPreference()).toBe('system');
  });

  it('clamps a stored font size into the contract range and defaults when absent', () => {
    stubStorage();
    expect(readFontSize()).toBe(DEFAULT_FONT_SIZE);
    stubStorage({ [FONT_KEY]: '40' });
    expect(readFontSize()).toBe(FONT_SIZE_MAX);
    stubStorage({ [FONT_KEY]: '4' });
    expect(readFontSize()).toBe(FONT_SIZE_MIN);
    stubStorage({ [FONT_KEY]: 'not-a-number' });
    expect(readFontSize()).toBe(DEFAULT_FONT_SIZE);
  });

  it('is the single clamp: reads, writes and the boot script agree on the range', () => {
    // Every entry point funnels through `clampFontSize`, so no path can put a
    // value on the axis that another path would reject.
    expect(clampFontSize(40)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(4)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(15.6)).toBe(16);
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SIZE);
    for (const value of [4, 12, 14, 17, 40]) {
      stubStorage({ [FONT_KEY]: String(value) });
      expect(readFontSize()).toBe(clampFontSize(value));
    }
  });

  it('survives a storage that throws (private mode)', () => {
    stubStorage({}, true);
    expect(readPreference()).toBe('system');
    expect(readFontSize()).toBe(DEFAULT_FONT_SIZE);
  });
});

describe('boot script contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('index.html and the built script agree on the keys, the attribute and the axis', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const script = bootThemeScript();
    for (const field of [ATTR, FONT_VAR]) {
      expect(html).toContain(field);
      expect(script).toContain(field);
    }
    // `system` is resolved through matchMedia on both paths — and only there.
    expect(html).toContain('prefers-color-scheme: dark');
    expect(script).toContain('prefers-color-scheme: dark');
    for (const key of [THEME_KEY, FONT_KEY]) {
      expect(html).toContain(`localStorage.getItem('${key}')`);
      expect(script).toContain(key);
    }
  });

  it('index.html carries the built script verbatim, ignoring layout only', () => {
    // Substring checks above pass even when the two bodies diverge in logic —
    // which is how the boot read once accepted an unclamped font size while the
    // runtime clamped it. Compare the statements themselves: whitespace,
    // semicolons and quote style are the only allowed delta (the built script
    // interpolates through JSON.stringify, the hand-placed copy is written with
    // single quotes).
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const squeeze = (text: string): string =>
      text.replace(/\s+/g, '').replace(/;/g, '').replace(/["']/g, '');
    expect(squeeze(html)).toContain(squeeze(bootThemeScript()));
  });

  // The clause above is a static comparison; it cannot see a wrong VALUE. So the
  // boot script is also executed here against the same storage the runtime reads
  // and the resulting axis compared with `readFontSize()` — the property that
  // actually matters. An absent key is the important case: `Number(null)` is 0,
  // which is finite, so a boot read that only guards `Number.isFinite` clamps the
  // default to 12px and the mounted app then corrects it to 14px, jumping on the
  // most common visit there is.
  it('executes to the same font size the runtime would read, absent key included', () => {
    const cases: Record<string, string>[] = [
      {},                        // first visit: getItem → null
      { [FONT_KEY]: '' },        // empty string: Number('') === 0
      { [FONT_KEY]: '0' },       // explicit zero
      { [FONT_KEY]: '4' },       // below the range
      { [FONT_KEY]: '12' },      // at the floor
      { [FONT_KEY]: '14' },      // the default
      { [FONT_KEY]: '14.6' },    // rounds
      { [FONT_KEY]: '17' },      // at the ceiling
      { [FONT_KEY]: '99' },      // above the range
      { [FONT_KEY]: 'not-a-number' },
    ];
    for (const entries of cases) {
      const booted = runBootScript(entries);
      stubStorage(entries);
      expect(booted.fontSize).toBe(`${readFontSize()}px`);
    }
  });

  it('applies the contract range, not a raw or defaulted value', () => {
    expect(runBootScript({ [FONT_KEY]: '99' }).fontSize).toBe(`${FONT_SIZE_MAX}px`);
    expect(runBootScript({ [FONT_KEY]: '4' }).fontSize).toBe(`${FONT_SIZE_MIN}px`);
    expect(runBootScript({}).fontSize).toBe(`${DEFAULT_FONT_SIZE}px`);
  });

  it('resolves the palette attribute the runtime will find on mount', () => {
    expect(runBootScript({ [THEME_KEY]: 'dark' }).dark).toBe(true);
    expect(runBootScript({ [THEME_KEY]: 'light' }).dark).toBe(false);
    // `system` with a light system preference.
    expect(runBootScript({}).dark).toBe(false);
  });
});