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
