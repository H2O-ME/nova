/**
 * Column width persistence (ZCode alignment): the sidebar and right panel
 * widths survive a reload, the way the reference stores its sidebar split
 * (`zcode:workspace-shell:sidebar-width-px`). Keys are Nova's own; only POSITIVE
 * pixel widths are stored — "closed" is a presentation, not a width, so the
 * collapsed rail never writes (a reload boots expanded, as the reference's
 * storage does).
 *
 * Every access is guarded: `typeof window === 'undefined'` (a static/SSR
 * render has no storage) and try/catch (a denied or full `localStorage`
 * throws; losing a width preference must never break the shell). Clamp to the
 * contract happens in `layout-store.ts` at boot, against the boot viewport —
 * the frame's own measurement refines it afterwards.
 */

/** Stored sidebar width preference, in px. */
const SIDEBAR_KEY = 'nova.layout.sidebar';
/** Stored right panel width preference, in px. */
const RIGHTBAR_KEY = 'nova.layout.rightbar';

/**
 * Read one stored positive integer width.
 * @param key - the localStorage key.
 * @returns the stored px value, or null when absent/invalid/unavailable.
 */
function readWidth(key: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Write one width, ignoring storage failures.
 * @param key - the localStorage key.
 * @param px - the width to store; non-positive values remove the entry.
 */
function writeWidth(key: string, px: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (px > 0) window.localStorage.setItem(key, String(Math.round(px)));
    else window.localStorage.removeItem(key);
  } catch {
    /* a refused write loses the preference, never the session */
  }
}

/**
 * The stored sidebar width preference.
 * @returns px, or null before the first drag (or in a storage-less render).
 */
export function readStoredSidebarWidth(): number | null {
  return readWidth(SIDEBAR_KEY);
}

/**
 * The stored right panel width preference.
 * @returns px, or null before the panel's first opening.
 */
export function readStoredRightbarWidth(): number | null {
  return readWidth(RIGHTBAR_KEY);
}

/**
 * Store the sidebar width preference (a drag's settled width, not its frames).
 * @param px - the width; 0 (the rail) removes the entry.
 */
export function persistSidebarWidth(px: number): void {
  writeWidth(SIDEBAR_KEY, px);
}

/**
 * Store the right panel width preference (a drag's settled width or a first
 * open's seed, not the drag's frames).
 * @param px - the width.
 */
export function persistRightbarWidth(px: number): void {
  writeWidth(RIGHTBAR_KEY, px);
}
