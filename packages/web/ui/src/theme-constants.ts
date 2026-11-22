/**
 * Theme/boot constants, in a module with NO React dependency.
 *
 * WHY THIS FILE EXISTS (2026-10-20): `boot-theme.ts` builds the pre-paint script
 * and needs only these constants, but it used to import them from `theme.ts`,
 * which also exports hooks (`useEffect`/`useState`). After the Next.js migration
 * the mount document (`app/layout.tsx`) is a **Server Component** and calls
 * `bootThemeScript()` at module scope — so importing `theme.ts` there dragged a
 * hook-dependent module into the server graph and the build failed with:
 *
 *   You're importing a module that depends on `useEffect` into a React Server
 *   Component module.
 *
 * Splitting the constants out is the minimal fix that keeps ONE definition: both
 * `theme.ts` (client) and `boot-theme.ts` (runs in both worlds) re-export/import
 * from here, so the boot script and the runtime cannot disagree about the key
 * names, the attribute, or the font-size range.
 */

/** Built-in preferences accepted at the settings boundary. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
/** Default preference when no durable override exists. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system';
/** Content font size bounds and default, in px. */
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 17;
export const DEFAULT_FONT_SIZE = 14;

/** localStorage key for the durable theme preference. */
export const THEME_KEY = 'nova.theme';
/** localStorage key for the durable content font size. */
export const FONT_KEY = 'nova.fontSize';
/** Body attribute selecting the dark token palette. */
export const DARK_ATTRIBUTE = 'data-nova-dark';
/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--nova-content-font-size';

/**
 * Clamp a font size into the contract range, defaulting when unusable. This is
 * the ONLY place the range is applied: `readFontSize`, the theme store's
 * `setFontSize`, and the pre-paint boot script (`shell/boot-theme.ts`) all go
 * through it, so the first frame and the mounted app can never disagree about
 * the axis — a boot script that accepted `40` while the runtime clamped to 17
 * would jump on mount.
 *
 * Lives HERE (not in `theme.ts`) because the theme store imports it and
 * `theme.ts` imports the store: keeping the pure function in the React-free
 * module leaves the dependency graph acyclic.
 */
export function clampFontSize(value: number): number {
  return Number.isFinite(value)
    ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

/** The durable theme preference, or the default when absent/unusable. */
export function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return (THEME_PREFERENCES as readonly string[]).includes(raw ?? '')
      ? (raw as ThemePreference)
      : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** The durable content font size, clamped, or the default when absent. */
export function readStoredFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (raw === null) return DEFAULT_FONT_SIZE;
    return clampFontSize(Number(raw));
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

/** Persist the theme preference, ignoring storage failures (private mode). */
export function persistPreference(value: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* the choice simply does not survive the reload */
  }
}

/** Persist the content font size, ignoring storage failures. */
export function persistFontSize(value: number): void {
  try {
    localStorage.setItem(FONT_KEY, String(value));
  } catch {
    /* the choice simply does not survive the reload */
  }
}
