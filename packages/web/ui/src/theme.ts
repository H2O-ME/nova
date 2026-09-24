/**
 * Theme preference, content font size, and the DOM projection, ported from
 * deepseek-harness `ui-theme` (MIT): the browser resolves only `system`, then
 * one presenter writes the same fields the boot script writes pre-paint —
 * `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` for
 * the token palette, and the content font-size axis.
 *
 * The severity ladder lives here too: "which token encodes which band" is
 * theme vocabulary, not any one card's business.
 */
import { useEffect, useState } from 'react';

/** Built-in preferences accepted at the settings boundary. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
/** Default preference when no durable override exists. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system';
/** Content font size bounds and default, in px. */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 17;
export const DEFAULT_FONT_SIZE = 14;

const THEME_KEY = 'nova.theme';
const FONT_KEY = 'nova.fontSize';
const DARK_ATTRIBUTE = 'data-ds-dark-theme';
/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size';

function read<T extends string | number>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return (typeof fallback === 'number' ? Number(raw) : raw) as T;
  } catch {
    /* private mode: fall through to the default */
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice simply does not survive the reload */
  }
}

/**
 * Clamp a font size into the contract range, defaulting when unusable. This is
 * the ONLY place the range is applied: `readFontSize`, `setFontSize`, and the
 * pre-paint boot script (`shell/boot-theme.ts`) all go through it, so the first
 * frame and the mounted app can never disagree about the axis — a boot script
 * that accepted `40` while the runtime clamped to 17 would jump on mount.
 */
export function clampFontSize(value: number): number {
  return Number.isFinite(value)
    ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

export function readPreference(): ThemePreference {
  const raw = read<string>(THEME_KEY, DEFAULT_PREFERENCE);
  return (THEME_PREFERENCES as readonly string[]).includes(raw) ? (raw as ThemePreference) : DEFAULT_PREFERENCE;
}

export function readFontSize(): number {
  return clampFontSize(read<number>(FONT_KEY, DEFAULT_FONT_SIZE));
}

/** Whether a preference currently renders dark (a resolved question, not the
 *  id: only `system` asks the browser, and it asks here). */
export function resolveDark(preference: ThemePreference): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Project a preference onto the document: root `color-scheme`, the body
 *  palette attribute, the font-size axis, and the surrounding browser UI's
 *  theme-color, which follows the rendered background. */
export function applyTheme(preference: ThemePreference, fontSize: number): void {
  const dark = resolveDark(preference);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.body.toggleAttribute(DARK_ATTRIBUTE, dark);
  document.body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${fontSize}px`);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.append(meta);
  }
  meta.setAttribute('content', getComputedStyle(document.body).backgroundColor);
}

/** Current palette as a boolean, for chrome that mirrors it (toggle icons). */
export function isDark(): boolean {
  return document.body.hasAttribute(DARK_ATTRIBUTE);
}

/** Theme preference + font size as view state, with `system` following the
 *  browser live (matchMedia, not a resize poll). */
export function useTheme(): {
  preference: ThemePreference;
  fontSize: number;
  dark: boolean;
  setPreference: (next: ThemePreference) => void;
  setFontSize: (next: number) => void;
  toggle: () => void;
} {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [fontSize, setSize] = useState<number>(readFontSize);
  const [dark, setDark] = useState<boolean>(isDark);

  useEffect(() => {
    applyTheme(preference, fontSize);
    setDark(resolveDark(preference));
    if (preference !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyTheme('system', fontSize);
      setDark(resolveDark('system'));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference, fontSize]);

  return {
    preference,
    fontSize,
    dark,
    setPreference: (next) => {
      write(THEME_KEY, next);
      setPref(next);
    },
    setFontSize: (next) => {
      const clamped = clampFontSize(next);
      write(FONT_KEY, String(clamped));
      setSize(clamped);
    },
    toggle: () => {
      const next: ThemePreference = resolveDark(preference) ? 'light' : 'dark';
      write(THEME_KEY, next);
      setPref(next);
    },
  };
}

/** Severity color for a usage ratio in [0,1] (≥0.9 error / ≥0.7 warn / business). */
export function severityForUsage(ratio: number): string {
  if (ratio >= 0.9) return 'var(--dsw-alias-state-error-primary)';
  if (ratio >= 0.7) return 'var(--dsw-alias-state-warn-primary)';
  return 'var(--dsw-alias-state-business-primary)';
}