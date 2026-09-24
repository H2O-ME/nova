/**
 * Theme bootstrap for the pre-mount interval, ported from deepseek-harness
 * `ui-theme/src/boot-theme.ts` (MIT). The index's inline script resolves the
 * stored preference (only `system` asks the browser) and writes the same DOM
 * fields `theme.ts` owns afterwards, so the first paint is already in the
 * right palette with no flash.
 *
 * The script body is built here and hand-placed in `index.html`; a test asserts
 * the two agree on the durable keys and the DOM fields, so the pair cannot
 * drift.
 */
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFERENCE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type ThemePreference,
} from '../theme.js';

/** localStorage keys the boot script reads; shared with `theme.ts` by contract. */
export const THEME_KEY = 'nova.theme';
export const FONT_KEY = 'nova.fontSize';

/**
 * Build the inline script body for one theme preference and font size.
 *
 * The font-size read applies the SAME range as `theme.ts`'s `clampFontSize`
 * (bounds interpolated from the constants, so they cannot drift): a stored
 * out-of-range value used to reach the first paint unclamped and was then
 * corrected on mount, which is a visible jump in every text row.
 * @param preference - durable preference embedded in the page.
 * @param fontSize - durable content font size in px.
 * @returns the script text (also what `index.html` carries by hand).
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
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', fontSize + 'px')
})()`;
}