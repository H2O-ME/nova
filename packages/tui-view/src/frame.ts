/**
 * Frame assembly: popup lines + history slice + bottom stack, from a single
 * snapshot. The shell owns blocks, wrapping and IO; this module only decides
 * row order so it stays unit-testable.
 */

import { COMMAND_PALETTE_ROWS } from './tokens.js';
import type { CommandPopupView } from './popups.js';

export interface FrameSnapshot {
  /** Total terminal rows. */
  rows: number;
  /** Popup rows (already built, approval/picker/command). */
  popupLines: string[];
  /** Command palette state for the sliding window. */
  commandMatches: CommandPopupView['matches'];
  commandIndex: number;
  /** Composer zone rows (already built). */
  composerRows: string[];
  /** Rows reserved below history (breathing + popups + composer + status). */
  chromeRows: number;
}

export interface FramePlan {
  /** Visible command entries after the sliding window. */
  visibleMatches: CommandPopupView['matches'];
  visibleStart: number;
  /** History viewport height. */
  historyRows: number;
}

/** Sliding window + viewport math (pure; building stays with the shell). */
export function planFrame(snap: FrameSnapshot): FramePlan {
  const visibleStart = Math.max(
    0,
    Math.min(snap.commandIndex - (COMMAND_PALETTE_ROWS - 1), snap.commandMatches.length - COMMAND_PALETTE_ROWS),
  );
  const visibleMatches = snap.commandMatches.slice(visibleStart, visibleStart + COMMAND_PALETTE_ROWS);
  const historyRows = Math.max(
    3,
    snap.rows - snap.popupLines.length - snap.composerRows.length - snap.chromeRows,
  );
  return { visibleMatches, visibleStart, historyRows };
}
