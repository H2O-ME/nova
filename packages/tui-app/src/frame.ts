/**
 * Frame assembly (M11 批4): the parts of the bottom stack plus a transcript
 * viewport become exactly `rows` display lines and one caret position.
 *
 * This is the screen's *arithmetic*, and it is pure on purpose: a row count
 * that comes out wrong is then a failing assertion rather than a screenshot.
 * The order below is grok's and is the reason a short transcript does not
 * drift: the transcript is the only region that shrinks, so everything under
 * it stays pinned to the bottom edge.
 *
 * `owners` is the hit-testing seam: one entry index per screen row (-1 for a
 * blank), so a click turns into "which entry is this" without re-deriving the
 * layout, and scrolling is the same number read the other way.
 */
import { bottomStack } from './layout.js';
import type { Scrollback, Viewport } from './scrollback.js';
import type { ComposerView } from './panels.js';

export interface FrameInput {
  cols: number;
  rows: number;
  /** The transcript's state machine; the shell owns it so scrolling survives. */
  scrollback: Scrollback;
  /** The live turn row, or `''` while idle (the row disappears entirely). */
  turn?: string;
  popup?: readonly string[];
  queue?: readonly string[];
  composer: ComposerView;
  status?: string;
  hints?: string;
}

export interface Frame {
  /** Exactly `rows` lines, top to bottom. */
  lines: string[];
  /** Where the hardware cursor should sit (0-based row and display column). */
  cursor: { row: number; col: number };
  /** Entry index owning each screen row; -1 for blank. */
  owners: number[];
  /** The transcript's own numbers, carried through for the shell's scroll math. */
  viewport: Viewport;
  /** Screen row where the transcript region starts (0 — kept for clarity). */
  transcriptTop: number;
}

export function buildFrame(input: FrameInput): Frame {
  const popup = input.popup ?? [];
  const queue = input.queue ?? [];
  const turnRows = input.turn === undefined || input.turn.length === 0 ? 0 : 1;
  const status = input.status === undefined || input.status.length === 0 ? 0 : 1;
  const hints = input.hints === undefined || input.hints.length === 0 ? 0 : 1;
  const stack = bottomStack(input.rows, {
    popup: popup.length,
    queue: queue.length,
    turn: turnRows,
    composer: input.composer.lines.length,
    status,
    hints,
  });

  const viewport = input.scrollback.viewport(stack.transcript);
  const lines: string[] = [...viewport.screen];
  for (let i = 0; i < stack.breath; i++) lines.push('');
  lines.push(...popup, ...queue);
  if (turnRows === 1) lines.push(input.turn!);
  lines.push(...input.composer.lines);
  if (status === 1) lines.push(input.status!);
  if (hints === 1) lines.push(input.hints!);
  // The stack is computed from the same numbers, so this only ever pads — but a
  // frame one row short would shift the composer up and desync the terminal's
  // own scrolling, so it must never be possible to write fewer rows than asked.
  while (lines.length < input.rows) lines.push('');

  const composerTop = stack.transcript + stack.breath + popup.length + queue.length + turnRows;
  const owners = Array.from({ length: input.rows }, (): number => -1);
  for (const [row, owner] of viewport.owner.entries()) owners[row] = owner;
  return {
    lines: lines.slice(0, input.rows),
    cursor: { row: composerTop + input.composer.cursorRow, col: input.composer.cursorCol },
    owners,
    viewport,
    transcriptTop: 0,
  };
}

/**
 * Which rows the frame's own regions occupy, for hit-testing and for the
 * scroll wheel's row budget. Derived from the same inputs as the frame, never
 * guessed by the caller.
 */
export function frameRegions(input: FrameInput): { transcript: number; transcriptTop: number; firstFixed: number } {
  const popup = input.popup?.length ?? 0;
  const queue = input.queue?.length ?? 0;
  const turn = input.turn === undefined || input.turn.length === 0 ? 0 : 1;
  const stack = bottomStack(input.rows, {
    popup,
    queue,
    turn,
    composer: input.composer.lines.length,
    status: input.status === undefined || input.status.length === 0 ? 0 : 1,
    hints: input.hints === undefined || input.hints.length === 0 ? 0 : 1,
  });
  return { transcript: stack.transcript, transcriptTop: 0, firstFixed: stack.transcript };
}