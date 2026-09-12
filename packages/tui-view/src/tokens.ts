/**
 * Single source for every TUI magic number. Previously scattered across
 * tui-mode.ts, ui.ts, popup.ts and reasoning.ts (including two copies of the
 * picker window sizes) — change a budget here, everywhere follows.
 */

/** Visible input rows in the composer (overflow scrolls with ⋯ hints). */
export const COMPOSER_MAX_ROWS = 8;
/** Paste safety cap: longer pastes are truncated with a notice. */
export const PASTE_MAX_CHARS = 200_000;

/** Reasoning budgets: live expanded tail cap + tail slice + buffer cap. */
export const REASONING_MAX_LINES = 2;
/** Auto-expanded streaming rows (settled newest-first tail + 1 live row). */
export const REASONING_LIVE_MAX_ROWS = 8;
export const REASONING_MAX_PARTIAL_CHARS = 240;
export const REASONING_FULL_MAX_CHARS = 200_000;
export const REASONING_FULL_MAX_LINES = 2000;
/** Reasoning block indent columns; wrap budgets must agree (see wrapBlock). */
export const REASONING_INDENT_COLS = 4;

/** Async effect-preview rows fetched into the approval popup. */
export const APPROVAL_PREVIEW_MAX_ROWS = 20;

/** Picker sliding-window sizes (render + key navigation share these). */
export const MODEL_PICKER_WINDOW = 10;
export const SESSION_PICKER_WINDOW = 8;
/** Command palette visible rows. */
export const COMMAND_PALETTE_ROWS = 6;
/** Recent-session entries offered by the session switcher. */
export const SESSION_LIST_LIMIT = 30;

/** tps speedometer: samples × interval (≈5s trend window). */
export const TPS_SAMPLES = 10;
export const TPS_INTERVAL_MS = 500;

/** Frame layout constants. */
export const BREATHE_ROWS = 1;
export const STATUS_ROWS = 1;
export const HISTORY_MIN_ROWS = 3;

/** Animation + render scheduling. */
export const SPINNER_TICK_MS = 90;
export const RENDER_BUDGET_MS = 16;

/** Double Ctrl+C exit window. */
export const DOUBLE_CTRLC_MS = 2000;
/** A stalled tool starts showing its elapsed seconds after this long. */
export const TOOL_ELAPSED_AFTER_MS = 2000;

/** Bash live-output tail buffer (kept / shown). */
export const TOOL_TAIL_KEEP_CHARS = 8000;
export const TOOL_TAIL_SHOW_CHARS = 4000;

/** Long-turn toast thresholds (error ping / completion ping). */
export const LONG_TASK_ERROR_MS = 5000;
export const LONG_TASK_DONE_MS = 15_000;
/** Headless exec completion ping. */
export const EXEC_DONE_NOTIFY_MS = 30_000;

/** Input history depth. */
export const HISTORY_LIMIT = 200;

/** Splash panel floor width. */
export const SPLASH_MIN_INNER = 14;

/** Braille activity frames (shared by the TUI tool bullet + composer lead). */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Rotating verbs for the headless progress line. */
export const SPINNER_VERBS = ['思考中', '推敲中', '酝酿中', '翻找中', '梳理中', '盘算中'];
