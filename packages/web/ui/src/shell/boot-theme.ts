/**
 * Theme bootstrap for the pre-mount interval. The inline script resolves the
 * stored preference (only `system` asks the browser) and writes the same DOM
 * fields `theme.ts` owns afterwards, so the first paint is already in the
 * right palette with no flash.
 *
 * The script body is built HERE and injected into the mount document by
 * `app/layout.tsx`, which calls this function — it does not keep a copy.
 * `app/layout.tsx` is the direct successor of `index.html` after the Next.js
 * migration, and `theme.test.ts` still asserts the two cannot drift: it pins
 * that the layout derives the script from this function rather than pasting
 * the body in.
 * Imported from `../theme-constants.js`, deliberately NOT from `../theme.js`:
 * `theme.ts` exports hooks, and `app/layout.tsx` (a Server Component) calls
 * `bootThemeScript()` at module scope, so a hook-dependent import in this chain
 * fails the Next build outright.
 */
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFERENCE,
  FONT_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEME_KEY,
  type ThemePreference,
} from '../theme-constants.js';

// Re-exported: `THEME_KEY` / `FONT_KEY` were defined here before, and tests and
// settings import them from this module. One definition now, in
// `theme-constants.ts`, so the boot script and the runtime cannot disagree.
export { FONT_KEY, THEME_KEY };

/**
 * Build the inline script body for one theme preference and font size.
 *
 * The font-size read applies the SAME range as `theme.ts`'s `clampFontSize`
 * (bounds interpolated from the constants, so they cannot drift): a stored
 * out-of-range value used to reach the first paint unclamped and was then
 * corrected on mount, which is a visible jump in every text row.
 * @param preference - durable preference embedded in the page.
 * @param fontSize - durable content font size in px.
 * @returns the script text (what `app/layout.tsx` inlines verbatim).
 */
export function bootThemeScript(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): string {
  return `(() => {
  let preference = ${JSON.stringify(preference)}
  let fontSize = ${JSON.stringify(fontSize)}
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_KEY)})
    if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored
    const raw = localStorage.getItem(${JSON.stringify(FONT_KEY)})
    if (raw !== null) {
      const size = Number(raw)
      if (Number.isFinite(size)) {
        fontSize = Math.min(${FONT_SIZE_MAX}, Math.max(${FONT_SIZE_MIN}, Math.round(size)))
      }
    }
  } catch {}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-nova-dark', dark)
  document.body.style.setProperty('--nova-content-font-size', fontSize + 'px')
})()`;
}