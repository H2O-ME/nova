/**
 * The live turn row (M11 批4), grok's `turn_status`: one line above the
 * composer that exists only while a turn runs, and vanishes completely when it
 * ends (the transcript grows back into the space — grok hides it at height 0).
 *
 * Composition order, left to right: spinner, activity word, phase timer,
 * queued hint, filler, turn timer, token count. The timer format is grok's
 * three-tier rule; the spinner advances on the shared clock, four ticks per
 * frame (~132 ms at 33 ms/tick), and a tool blocked on the user stops spinning
 * and pulses a diamond instead — a live "it is waiting for you" that reads
 * differently from "it is working".
 */
import type { TurnPhase } from '@nova-agent/core';
import { paint, type Palette } from './theme.js';

/** Grok's braille spinner; frame = `(tick / SPINNER_DIVISOR) % frames.length`. */
export const SPINNER_DIVISOR = 4;
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'] as const;
/** Low-frequency pulse for "nothing is being generated" (grok's monitor pulse). */
export const MONITOR_PULSE_DIVISOR = 8;
export const MONITOR_PULSE_FRAMES = ['○', '◎', '◉', '◎'] as const;
/** Blocked on the user: not a spinner, a pulse. */
export const WAITING_GLYPH = '◆';

export function spinnerFrame(tick: number): string {
  if (tick < 0) return SPINNER_FRAMES[0]!;
  return SPINNER_FRAMES[Math.floor(tick / SPINNER_DIVISOR) % SPINNER_FRAMES.length]!;
}

export function pulseFrame(tick: number): string {
  if (tick < 0) return MONITOR_PULSE_FRAMES[0]!;
  return MONITOR_PULSE_FRAMES[Math.floor(tick / MONITOR_PULSE_DIVISOR) % MONITOR_PULSE_FRAMES.length]!;
}

/**
 * Elapsed time, grok's tiers: one decimal under ten seconds (the difference
 * between 0.4s and 3.9s is interesting), whole seconds under a minute, then
 * minutes and seconds, then hours and minutes.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 10) return `${total.toFixed(1)}s`;
  const secs = Math.floor(total);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${secs % 60}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

/** Token counts, grok's `format_tokens_short`. */
export function formatTokensShort(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${(n / 1_000).toFixed(2)}k`;
  if (n < 100_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(2)}m`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

const PHASE_WORDS: Record<TurnPhase, string> = {
  idle: '',
  thinking: '思考中',
  writing: '输出中',
  tool: '执行工具',
  waiting_approval: '等待审批',
  compacting: '压缩中',
  retrying: '重试中',
};

export function phaseWord(phase: TurnPhase): string {
  return PHASE_WORDS[phase] ?? '';
}

export interface TurnStatusInput {
  cols: number;
  /** The shell's single clock. */
  tick: number;
  phase: TurnPhase;
  /** Wall-clock start of the turn; the row hides while idle. */
  startedAt: number | undefined;
  now: number;
  queued: number;
  /** Prompt tokens of the last request, shown as `⇣Nk`. */
  promptTokens?: number | undefined;
  /** A tool asked the user something: pulse instead of spin. */
  blockedOnUser?: boolean;
}

/** The whole row, or `''` when there is no turn to report. */
export function turnStatusLine(input: TurnStatusInput, palette: Palette): string {
  const word = phaseWord(input.phase);
  if (input.startedAt === undefined || (input.phase === 'idle' && word.length === 0)) return '';
  const spinner = paint(palette, input.blockedOnUser === true ? palette.warning : palette.accentRunning,
    input.blockedOnUser === true ? WAITING_GLYPH : spinnerFrame(input.tick));
  const label = paint(palette, input.phase === 'retrying' ? palette.warning : palette.textSecondary, word);
  const right = rightSide(input, palette);
  const head = `${spinner} ${label}`;
  const elapsed = paint(palette, palette.gray, formatDuration(input.now - input.startedAt));
  const queued = input.queued > 0 ? paint(palette, palette.gray, ` ⧉${input.queued}`) : '';
  const fixed = head.length + elapsed.length + queued.length + right.length;
  // The screen does the ANSI-aware truncation if a narrow terminal still cuts
  // this row; the fill only aims the timer at the right edge.
  const fill = Math.max(1, input.cols - fixed - 1);
  return `${head}${queued}${' '.repeat(fill)}${elapsed}${right}`;
}

function rightSide(input: TurnStatusInput, palette: Palette): string {
  if (input.promptTokens === undefined || input.promptTokens <= 0) return '';
  return ` ${paint(palette, palette.gray, `⇣${formatTokensShort(input.promptTokens)}`)}`;
}