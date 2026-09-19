/**
 * `@nova-agent/tui-app` — the new TUI surface (M11 批4).
 *
 * Public surface: the metrics and state machines that make the terminal
 * transcript *read* the way it does. They are exported as pure functions on
 * purpose — the shell that drives them is thin, and everything a screenshot
 * could disagree about is testable without a terminal.
 */
export {
  buildPalette,
  plainPalette,
  paint,
  capsule,
  usageUrgency,
  waveBrightness,
  blend,
  BG_BASE,
  type Palette,
  type ThemeName,
} from './theme.js';
export {
  MARK_COL,
  MARK_GAP,
  MARK_LEAD,
  CONTENT_COL,
  GAP_BETWEEN,
  GAP_DENSE,
  USER_VPAD,
  SCROLLBACK_MIN_ROWS,
  CHROME_PAD_COLS,
  COMPOSER_PAD_COLS,
  COMPOSER_ROWS,
  CARD_CORNERS,
  TICK_MS,
  SPINNER_DIVISOR,
  RAIL_SPEED,
  RAIL_WAVE_ROWS,
  toolBudget,
  chromeWidth,
  bottomStack,
  type BottomStack,
} from './layout.js';
export { Scrollback, layoutEntries, type ScrollEntry, type ScrollLayout, type Viewport } from './scrollback.js';
export {
  createComposer,
  insert,
  paste,
  backspace,
  deleteForward,
  deleteWord,
  move,
  submitText,
  isEmpty,
  segments,
  foldLabel,
  shouldFold,
  type Composer,
  type PasteFold,
  type Segment,
  type MoveKind,
} from './composer.js';
export {
  statusLine,
  humanTokens,
  GROUP_SEP,
  ITEM_SEP,
  type StatusInput,
  type StatusView,
  type GaugeZones,
} from './status-bar.js';
export {
  turnStatusLine,
  spinnerFrame,
  pulseFrame,
  formatDuration,
  formatTokensShort,
  phaseWord,
  SPINNER_FRAMES,
  MONITOR_PULSE_FRAMES,
  WAITING_GLYPH,
  type TurnStatusInput,
} from './turn-status.js';
export {
  partitionRuns,
  bucketsOf,
  verbLabel,
  runRunning,
  verbKindOf,
  type RunSpan,
  type RunStep,
  type VerbBucket,
  type VerbKind,
  type VerbRun,
} from './verb-group.js';

export {
  cardTop,
  cardRow,
  cardBottom,
  fit,
  composerCard,
  approvalCard,
  approvalScopeOf,
  callHeadline,
  queueLane,
  hintBar,
  listPanel,
  welcomeCard,
  modeSelector,
  COMPOSER_PLACEHOLDER,
  COMPOSER_LEAD,
  APPROVAL_OPTIONS,
  QUEUE_PREVIEW_ROWS,
  type ApprovalChoice,
  type ApprovalInput,
  type ApprovalScope,
  type ComposerInput,
  type ComposerView,
  type KeyboardOwner,
  type HintInput,
  type ListPanelInput,
  type QueueInput,
  type WelcomeInput,
} from './panels.js';
export { buildFrame, frameRegions, type Frame, type FrameInput } from './frame.js';
export {
  createUiState,
  handleKey,
  WHEEL_ROWS,
  PAGE_ROWS,
  type ApprovalState,
  type CommandSpec,
  type KeyContext,
  type PanelRow,
  type PanelState,
  type TuiAction,
  type UiState,
} from './keys.js';
export { TuiApp, type CommandOutcome, type TuiAppOptions } from './app.js';
export { reduce, initialTranscript, type Block, type TranscriptState, type ReduceContext } from './blocks.js';
export { buildEntries, type BlockPainter, type EntryInput, type RenderOpts } from './entries.js';
export { paintBlock, markdown, reasoningLines, toolLines, MARKS, TRUNCATED_ROWS, EXPANDED_ROWS, type PaintOpts } from './render.js';
