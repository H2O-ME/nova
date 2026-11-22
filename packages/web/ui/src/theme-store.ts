/**
 * Theme state as one module-level store (2026-11-22).
 *
 * WHY A STORE, NOT `useState` PER CONSUMER: the palette has exactly one owner
 * but two kinds of reader — the runtime (which must follow the OS while the
 * preference is `system`, whether or not any settings page is open) and the
 * settings UI. The first version kept the state inside `useTheme()`, which only
 * the settings dialog called — so a launch that never opened settings never
 * registered the `prefers-color-scheme` listener, and toggling the OS theme
 * did nothing until the dialog was opened once. Measured on Windows: dark OS,
 * light app until 设置 was opened.
 *
 * The store holds the preference and the RESOLVED system fact; the DOM
 * projection stays in `theme.ts` (`applyTheme`), because the boot script writes
 * the same fields and the two must keep agreeing.
 */
import {
  clampFontSize,
  DEFAULT_FONT_SIZE,
  DEFAULT_PREFERENCE,
  persistFontSize,
  persistPreference,
  readStoredFontSize,
  readStoredPreference,
  type ThemePreference,
} from './theme-constants.js';

/** What consumers read: the durable preference plus the resolved palette. */
export interface ThemeSnapshot {
  readonly preference: ThemePreference;
  readonly fontSize: number;
  /** Whether the palette currently renders dark (system resolved when `system`). */
  readonly dark: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** The OS fact, kept so a preference flip does not have to re-ask. */
function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(preference: ThemePreference): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  return systemPrefersDark();
}

/**
 * The ONE `prefers-color-scheme` listener for the whole runtime, installed when
 * the first subscriber arrives and removed when the last one leaves.
 *
 * It lives HERE rather than in the hook's own `useEffect` because a hook effect
 * runs per COMPONENT: with `useTheme()` now called from every A2UI card as well
 * as the settings page, the hook-local version would have registered one OS
 * listener per mounted consumer while claiming to register one. The store is the
 * only thing that is genuinely singular.
 */
let stopWatchingSystem: (() => void) | null = null;

function watchSystemPalette(): void {
  if (stopWatchingSystem !== null || typeof matchMedia === 'undefined') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => { refreshSystemTheme(); };
  mq.addEventListener('change', onChange);
  stopWatchingSystem = () => {
    mq.removeEventListener('change', onChange);
    stopWatchingSystem = null;
  };
}

let snapshot: ThemeSnapshot = Object.freeze({
  preference: readStoredPreference(),
  fontSize: readStoredFontSize(),
  dark: resolve(readStoredPreference()),
});

function publish(next: Partial<ThemeSnapshot>): void {
  const merged: ThemeSnapshot = Object.freeze({ ...snapshot, ...next });
  if (merged.preference === snapshot.preference
    && merged.fontSize === snapshot.fontSize
    && merged.dark === snapshot.dark) {
    return;
  }
  snapshot = merged;
  for (const listener of listeners) listener();
}

/** Subscribe to theme changes (the `useSyncExternalStore` contract). */
export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  watchSystemPalette();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatchingSystem?.();
    }
  };
}

/** The current snapshot; the SAME object until something changes. */
export function themeSnapshot(): ThemeSnapshot {
  return snapshot;
}

/** Server snapshot: the boot defaults (the app is client-only, this is a guard). */
export function themeServerSnapshot(): ThemeSnapshot {
  return Object.freeze({
    preference: DEFAULT_PREFERENCE,
    fontSize: DEFAULT_FONT_SIZE,
    dark: DEFAULT_PREFERENCE === 'dark',
  });
}

/** Set and persist the durable preference. */
export function setThemePreference(next: ThemePreference): void {
  persistPreference(next);
  publish({ preference: next, dark: resolve(next) });
}

/** Set and persist the content font size (clamped to the contract range). */
export function setThemeFontSize(next: number): void {
  const clamped = clampFontSize(next);
  persistFontSize(clamped);
  publish({ fontSize: clamped });
}

/** Flip between explicit light and dark (what `system` currently renders, inverted). */
export function toggleTheme(): void {
  setThemePreference(snapshot.dark ? 'light' : 'dark');
}

/**
 * Re-read the OS palette. Called by the runtime's `matchMedia` listener: when a
 * preference is explicit this only refreshes the stored fact, and only a
 * `system` preference publishes a visible change.
 */
export function refreshSystemTheme(): void {
  const dark = resolve(snapshot.preference);
  if (dark !== snapshot.dark) publish({ dark });
}
