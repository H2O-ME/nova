/**
 * The settings panel's copy, as ONE table assembled from per-section files.
 *
 * It was a single 119-line literal. Splitting it is not cosmetic: the settings
 * page now has three independently-owned sections (general/appearance,
 * models+providers, plugins+skills+qqbot) and each one is edited on its own, so
 * one file per owner means two people changing two sections never touch the
 * same file. `SETTINGS_COPY` keeps its name and stays the only thing the panel
 * imports, so no component knows the table has parts.
 *
 * Sources of the words themselves (deepseek-harness, MIT, (c) 2026 DeepSeek):
 * the shell's General-nav row and close label (`ui-settings-general/src/client/
 * locales.ts`), the theme feature's rows (`ui-theme/src/client/locales.ts`), the
 * permission row (`ui-permission-presets/src/client/locales.ts`), and the
 * section nav labels (`ui-settings-models` / `ui-settings-plugins`). Rows this
 * product words itself say so in their own file.
 */
import { GENERAL_COPY } from './copy/general.js';
import { MODELS_COPY } from './copy/models.js';
import { PLUGINS_COPY } from './copy/plugins.js';

export const SETTINGS_COPY = {
  ...GENERAL_COPY,
  ...MODELS_COPY,
  ...PLUGINS_COPY,
} as const;
