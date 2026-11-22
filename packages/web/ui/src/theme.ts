/**
 * Theme preference, content font size, and the DOM projection: the browser
 * resolves only `system`, then
 * one presenter writes the same fields the boot script writes pre-paint —
 * `html { color-scheme }` for native UA chrome, `body[data-nova-dark]` for
 * the token palette, and the content font-size axis.
 *
 * The live STATE lives in `theme-store.ts` (a module-level store) because the
 * OS-palette listener must exist from first mount, not only while a settings
 * dialog is open; this file keeps the storage reads, the resolution rule, the
 * DOM projection and the React binding.
 *
 * The severity ladder lives here too: "which token encodes which band" is
 * theme vocabulary, not any one card's business.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  clampFontSize,
  CONTENT_FONT_SIZE_VARIABLE,
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFERENCE,
  DARK_ATTRIBUTE,
  FONT_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  readStoredFontSize,
  readStoredPreference,
  THEME_KEY,
  THEME_PREFERENCES,
  type ThemePreference,
} from './theme-constants.js';
import {
  setThemeFontSize,
  setThemePreference,
  subscribeTheme,
  themeServerSnapshot,
  themeSnapshot,
  toggleTheme,
} from './theme-store.js';

// Re-exported so every existing consumer keeps importing from `theme.ts`. The
// definitions live in `theme-constants.ts` because `boot-theme.ts` needs them
// from a NON-React module: `app/layout.tsx` is a Server Component and calling
// `bootThemeScript()` there pulls in whatever `boot-theme.ts` imports.
export {
  CONTENT_FONT_SIZE_VARIABLE,
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFERENCE,
  DARK_ATTRIBUTE,
  FONT_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEME_KEY,
  THEME_PREFERENCES,
  clampFontSize,
  readStoredFontSize as readFontSize,
  readStoredPreference as readPreference,
  type ThemePreference,
};

/**
 * Whether a preference currently renders dark (a resolved question, not the
 * id: only `system` asks the browser, and it asks here).
 */
export function resolveDark(preference: ThemePreference): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Project a preference onto the document: root `color-scheme`, the body
 *  palette attribute, the font-size axis, and the surrounding browser UI's
 *  theme-color, which follows the rendered background. */
export function applyTheme(preference: ThemePreference, fontSize: number): void {
  applyResolvedTheme(resolveDark(preference), fontSize);
}

/** Project an ALREADY-resolved palette onto the document.
 *
 *  Two callers need this split: the preference-driven path above resolves
 *  `system` itself, while the theme store has already resolved it (and must be
 *  the one deciding, so the attribute and the React state can never disagree —
 *  a `system` flip that updated the store but re-resolved here would paint one
 *  palette while the UI's `dark` flag said another). */
export function applyResolvedTheme(dark: boolean, fontSize: number): void {
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

/** Theme preference + font size as view state.
 *
 *  Reads the module-level store (`theme-store.ts`) so that EVERY consumer sees
 *  the same palette. The `prefers-color-scheme` listener belongs to the store
 *  as well, not to this hook — a hook effect would install one OS listener per
 *  mounted consumer, and every A2UI card calls this too. See
 *  `subscribeTheme` for the single-listener contract.
 *
 *  The DOM projection runs as an effect of the snapshot: whichever component
 *  mounts first installs it, and the boot script already painted the same
 *  fields pre-mount, so the first frame never flips.
 */
export function useTheme(): {
  preference: ThemePreference;
  fontSize: number;
  dark: boolean;
  setPreference: (next: ThemePreference) => void;
  setFontSize: (next: number) => void;
  toggle: () => void;
} {
  const snapshot = useSyncExternalStore(subscribeTheme, themeSnapshot, themeServerSnapshot);
  const { preference, fontSize, dark } = snapshot;

  useEffect(() => {
    applyResolvedTheme(dark, fontSize);
  }, [dark, fontSize]);

  return {
    preference,
    fontSize,
    dark,
    setPreference: setThemePreference,
    setFontSize: setThemeFontSize,
    toggle: toggleTheme,
  };
}

/** Severity color for a usage ratio in [0,1] (≥0.9 error / ≥0.7 warn / business). */
export function severityForUsage(ratio: number): string {
  if (ratio >= 0.9) return 'var(--nova-color-danger)';
  if (ratio >= 0.7) return 'var(--nova-color-warn)';
  return 'var(--nova-color-accent)';
}