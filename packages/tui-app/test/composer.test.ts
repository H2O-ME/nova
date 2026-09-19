/**
 * The composer's two earned behaviours are what these tests protect: a paste
 * is folded for *display* only (submitting gives back every byte), and the
 * caret treats a fold as one thing — stepping over it whole, and expanding it
 * rather than swallowing it when a deletion lands on its boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  backspace,
  createComposer,
  deleteForward,
  deleteWord,
  foldLabel,
  insert,
  isEmpty,
  move,
  paste,
  segments,
  shouldFold,
  submitText,
  type Composer,
} from '../src/composer.js';

const typed = (text: string): Composer => insert(createComposer(), text);
const bigPaste = 'line one\nline two\nline three\nline four';

describe('typing', () => {
  it('inserts at the caret and moves it', () => {
    const state = insert(typed('helo'), '!');
    expect(state.text).toBe('helo!');
    const fixed = insert({ ...typed('helo'), cursor: 3 }, 'l');
    expect(fixed.text).toBe('hello');
    expect(fixed.cursor).toBe(4);
  });

  it('inserts at a mid-text caret, not at the end', () => {
    const state = insert({ ...typed('ac'), cursor: 1 }, 'b');
    expect(state.text).toBe('abc');
  });

  it('never folds plain typing, however long', () => {
    const state = insert(createComposer(), 'x'.repeat(400));
    expect(state.folds).toEqual([]);
  });

  it('empty means whitespace-only, not zero-length', () => {
    expect(isEmpty(typed('   \n '))).toBe(true);
    expect(isEmpty(typed(' x '))).toBe(false);
  });
});

describe('pasting', () => {
  it('folds a multi-line paste but keeps the bytes', () => {
    const state = paste(typed('before '), bigPaste);
    expect(state.folds).toHaveLength(1);
    expect(submitText(state)).toBe(`before ${bigPaste}`);
  });

  it('does not fold a short single-line paste', () => {
    expect(paste(createComposer(), 'short').folds).toEqual([]);
    expect(shouldFold('one\ntwo')).toBe(false);
    expect(shouldFold('one\ntwo\nthree')).toBe(true);
    expect(shouldFold('x'.repeat(120))).toBe(true);
  });

  it('the chip counts lines and characters of what was pasted', () => {
    const state = paste(createComposer(), bigPaste);
    expect(foldLabel(state.folds[0]!)).toBe(`▤ 粘贴 4行 ${bigPaste.length}字`);
  });

  it('renders as text-chip-text, with the chip standing in for the paste', () => {
    const state = paste(typed('a'), bigPaste);
    const parts = segments(state);
    expect(parts.map((p) => p.kind)).toEqual(['text', 'fold']);
    expect(parts[0]).toEqual({ kind: 'text', text: 'a' });
  });

  it('preserves line breaks and trailing whitespace exactly', () => {
    const raw = '  indented\n\n\ttabbed  \n';
    const state = paste(createComposer(), `${raw}\nmore\nand more`);
    expect(submitText(state)).toBe(`${raw}\nmore\nand more`);
  });
});

describe('the caret treats a fold as one character', () => {
  const withFold = (): Composer => paste(typed('ab'), bigPaste);
  const fold = (state: Composer) => state.folds[0]!;

  it('steps over the whole paste in both directions', () => {
    const state = withFold();
    const left = move(state, 'left');
    expect(left.cursor).toBe(fold(state).start);
    const right = move(left, 'right');
    expect(right.cursor).toBe(fold(state).end);
  });

  it('does not stop inside the paste', () => {
    const state = withFold();
    // One step lands *before* the chip; the next one jumps over the whole paste.
    let caret = move({ ...state, cursor: 1 }, 'right');
    expect(caret.cursor).toBe(2);
    caret = move(caret, 'right');
    expect(caret.cursor).toBe(fold(state).end);
  });

  it('backspace at the trailing edge expands the paste instead of eating it', () => {
    const state = withFold();
    const expanded = backspace(state); // caret sits at the fold end after pasting
    expect(expanded.folds).toEqual([]);
    expect(submitText(expanded)).toBe(`ab${bigPaste}`); // not one byte lost
    // …and the press after that does delete, one character at a time.
    expect(backspace(expanded).text).toBe(`ab${bigPaste.slice(0, -1)}`);
  });

  it('forward delete at the leading edge expands instead of eating', () => {
    const state = withFold();
    const expanded = deleteForward({ ...state, cursor: fold(state).start });
    expect(expanded.folds).toEqual([]);
    expect(submitText(expanded)).toBe(`ab${bigPaste}`);
    expect(expanded.cursor).toBe(2); // still facing right, at the first character
    expect(deleteForward(expanded).text).toBe(`ab${bigPaste.slice(1)}`);
  });

  it('an edit inside a paste dissolves the fold, keeping the text', () => {
    const state = withFold();
    const inside = { ...state, cursor: fold(state).start + 3 };
    const after = insert(inside, 'X');
    expect(after.folds).toEqual([]);
    expect(after.text).toBe(`ab${bigPaste.slice(0, 3)}X${bigPaste.slice(3)}`);
  });

  it('a word delete that reaches into a paste dissolves the fold, keeping the rest', () => {
    const pasted = paste(typed('keep\n'), bigPaste);
    const after = deleteWord({ ...pasted, cursor: pasted.text.length });
    expect(after.text).toBe('keep\nline one\nline two\nline three\nline ');
    expect(after.folds).toEqual([]);
  });
});

describe('word and line movement', () => {
  it('ctrl+left/right walk words', () => {
    const state = typed('alpha beta gamma');
    expect(move(state, 'wordLeft').cursor).toBe(11);
    expect(move({ ...state, cursor: 0 }, 'wordRight').cursor).toBe(5);
  });

  it('home/end stay on the current line', () => {
    const state = typed('first\nsecond');
    expect(move({ ...state, cursor: 9 }, 'lineStart').cursor).toBe(6);
    expect(move({ ...state, cursor: 6 }, 'lineEnd').cursor).toBe(12);
  });

  it('ctrl+w deletes the word before the caret', () => {
    const state = typed('one two');
    expect(deleteWord(state).text).toBe('one ');
  });
});