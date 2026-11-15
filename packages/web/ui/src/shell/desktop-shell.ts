/**
 * Whether the page is hosted in the desktop shell.
 *
 * Tauri installs `__TAURI_INTERNALS__` in its webview only; a browser tab never
 * has it. Geometry the reference resolves per platform — the workspace panel
 * radius (6px Windows desktop, 12px web) and the header's reserve for the
 * self-drawn caption buttons — reads this one predicate instead of each
 * component carrying its own copy.
 */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
