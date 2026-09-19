/**
 * The composer's state machine, with no rendering in sight (M11 批4).
 *
 * One rule shapes the whole file: **a fold is a display illusion, never a
 * second copy of the text.** A long paste is stored verbatim in `text` and only
 * *marked* as a fold, so what the user submits is byte-for-byte what they
 * pasted — and so nothing can be lost by a fold that disagrees with the buffer.
 *
 * The cursor therefore only ever rests on a fold's boundary: arrow keys step
 * over a whole paste (it reads as one thing), and an edit at a boundary
 * *expands* the fold first rather than eating it. Deleting a 400-line paste
 * with one keystroke is not a feature.
 */

export interface PasteFold {
  /** Index of the fold's first character in `text`. */
  start: number;
  /** Index one past its last character. */
  end: number;
  /** Line and character counts, for the chip label (display only). */
  lines: number;
  chars: number;
}

export interface Composer {
  text: string;
  /** Caret position, 0..text.length. */
  cursor: number;
  folds: readonly PasteFold[];
}

export function createComposer(): Composer {
  return { text: '', cursor: 0, folds: [] };
}

/** A paste folds once it is long enough that showing it verbatim would bury the draft. */
export const FOLD_MIN_LINES = 3;
export const FOLD_MIN_CHARS = 120;

export function shouldFold(raw: string): boolean {
  return raw.split('\n').length >= FOLD_MIN_LINES || raw.length >= FOLD_MIN_CHARS;
}

/** Plain typing: never folds (a user typing 120 characters wants to see them). */
export function insert(state: Composer, chunk: string): Composer {
  return splice(state, state.cursor, state.cursor, chunk, undefined);
}

/** A paste: folds when long, otherwise behaves like typing. */
export function paste(state: Composer, raw: string): Composer {
  const fold = shouldFold(raw)
    ? { start: state.cursor, end: state.cursor + raw.length, lines: raw.split('\n').length, chars: raw.length }
    : undefined;
  return splice(state, state.cursor, state.cursor, raw, fold);
}

/**
 * Backspace. At a fold's trailing boundary the fold expands — the first press
 * shows what is there, and only the presses after it delete. Falling straight
 * through to a byte-wise delete would let one keystroke silently eat a
 * four-hundred-line paste.
 */
export function backspace(state: Composer): Composer {
  const fold = foldEndingAt(state, state.cursor);
  if (fold !== undefined) return splice(state, fold.start, fold.end, state.text.slice(fold.start, fold.end), undefined);
  if (state.cursor === 0) return state;
  return splice(state, state.cursor - 1, state.cursor, '', undefined);
}

/** Forward delete, with the same expand-first rule at a fold's leading edge. */
export function deleteForward(state: Composer): Composer {
  const index = state.folds.findIndex((f) => f.start === state.cursor);
  if (index >= 0) {
    const fold = state.folds[index]!;
    const expanded = splice(state, fold.start, fold.end, state.text.slice(fold.start, fold.end), undefined);
    // Expanded from the left: leave the caret at the fold's leading edge, so
    // the next forward-delete takes the first character, not nothing at all.
    return { ...expanded, cursor: fold.start };
  }
  if (state.cursor >= state.text.length) return state;
  return splice(state, state.cursor, state.cursor + 1, '', undefined);
}

/** Delete the word before the caret (Ctrl+W / Ctrl+Backspace). */
export function deleteWord(state: Composer): Composer {
  if (state.cursor === 0) return state;
  const start = prevWordStart(state.text, state.cursor);
  return splice(state, start, state.cursor, '', undefined);
}

export type MoveKind = 'left' | 'right' | 'wordLeft' | 'wordRight' | 'lineStart' | 'lineEnd';

export function move(state: Composer, kind: MoveKind): Composer {
  switch (kind) {
    case 'left': {
      const fold = foldEndingAt(state, state.cursor);
      if (fold !== undefined) return { ...state, cursor: fold.start };
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    }
    case 'right': {
      const fold = state.folds.find((f) => f.start === state.cursor);
      if (fold !== undefined) return { ...state, cursor: fold.end };
      return { ...state, cursor: Math.min(state.text.length, state.cursor + 1) };
    }
    case 'wordLeft':
      return { ...state, cursor: prevWordStart(state.text, state.cursor) };
    case 'wordRight':
      return { ...state, cursor: nextWordEnd(state.text, state.cursor) };
    case 'lineStart':
      return { ...state, cursor: lineStart(state.text, state.cursor) };
    case 'lineEnd':
      return { ...state, cursor: lineEnd(state.text, state.cursor) };
  }
}

/** What the user submits: the buffer, verbatim — folds never touch it. */
export function submitText(state: Composer): string {
  return state.text;
}

export function isEmpty(state: Composer): boolean {
  return state.text.trim().length === 0;
}

/** Display segments: verbatim runs split by the chips standing in for folds. */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'fold'; fold: PasteFold };

export function segments(state: Composer): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const fold of [...state.folds].sort((a, b) => a.start - b.start)) {
    if (fold.start > at) out.push({ kind: 'text', text: state.text.slice(at, fold.start) });
    out.push({ kind: 'fold', fold });
    at = fold.end;
  }
  if (at < state.text.length) out.push({ kind: 'text', text: state.text.slice(at) });
  return out;
}

/** The chip's label, e.g. `▤ 粘贴 12行 480字`. */
export function foldLabel(fold: PasteFold): string {
  return `▤ 粘贴 ${fold.lines}行 ${fold.chars}字`;
}

/**
 * Replace `[from, to)` with `insert`, carrying a new fold if one is being
 * created. Folds after the edit shift; a fold the edit touches is expanded —
 * an edit *inside* a paste means it is no longer that paste.
 */
function splice(state: Composer, from: number, to: number, insert: string, fold: PasteFold | undefined): Composer {
  const text = state.text.slice(0, from) + insert + state.text.slice(to);
  const delta = insert.length - (to - from);
  const folds: PasteFold[] = [];
  for (const existing of state.folds) {
    if (existing.end <= from) folds.push(existing);
    else if (existing.start >= to) folds.push({ ...existing, start: existing.start + delta, end: existing.end + delta });
    // else: the edit lands inside this fold — it is gone (its text stays).
  }
  if (fold !== undefined) folds.push(fold);
  return { text, cursor: from + insert.length, folds: folds.sort((a, b) => a.start - b.start) };
}

function foldEndingAt(state: Composer, cursor: number): PasteFold | undefined {
  return state.folds.find((f) => f.end === cursor);
}

function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf('\n', cursor - 1) + 1;
}

function lineEnd(text: string, cursor: number): number {
  const at = text.indexOf('\n', cursor);
  return at === -1 ? text.length : at;
}

const WORD = /[\p{L}\p{N}_]/u;

function prevWordStart(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && !WORD.test(text[i - 1]!)) i--;
  while (i > 0 && WORD.test(text[i - 1]!)) i--;
  return i;
}

function nextWordEnd(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && !WORD.test(text[i]!)) i++;
  while (i < text.length && WORD.test(text[i]!)) i++;
  return i;
}