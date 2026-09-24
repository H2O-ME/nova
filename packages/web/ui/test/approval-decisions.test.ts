/**
 * The approval card's decisions, asserted without a DOM.
 *
 * Two kinds of case live here, and both have already gone wrong in a real
 * frontend somewhere:
 *  - **the answer contract** — a scope that steps past its range, an "always"
 *    that the wire parser would reject, a reason that stops being an
 *    instruction because it was never trimmed or never capped;
 *  - **the key contract** — `n` typed into a denial reason denying the call,
 *    an IME Enter sending a half-typed reason, Escape deciding something.
 *
 * The last block is a seam test: every answer these functions assemble must
 * parse on the host's own frame validator (`parseAskResult` in the shared
 * protocol parser), and the caps restated in the browser bundle must equal
 * core's.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ALWAYS_SCOPE_WORDS, MAX_DENY_REASON_CHARS, parseAskResult } from '@nova-agent/core';
import {
  MAX_DENY_REASON_CHARS as UI_MAX_REASON_CHARS,
  MAX_SCOPE_WORDS,
  alwaysAnswer,
  approvalKey,
  clampScope,
  denyAnswer,
  isScoped,
  scopeLimit,
  stepScope,
  type ApprovalKeyState,
} from '../src/approval/decisions.js';

/** A key state with everything but the field under test filled in. */
const key = (over: Partial<ApprovalKeyState> = {}): ApprovalKeyState => ({
  key: 'y',
  shiftKey: false,
  inField: false,
  words: undefined,
  scope: 1,
  reason: '',
  ...over,
});

describe('scope range', () => {
  it('offers no scope for an absent word list, one word, or a compound command (which yields one word)', () => {
    expect(scopeLimit(undefined)).toBe(0);
    expect(scopeLimit([])).toBe(0);
    expect(scopeLimit(['rm'])).toBe(0);
    expect(isScoped(['git'])).toBe(false);
  });

  it('offers every word of a bare command, capped at the wire maximum', () => {
    expect(scopeLimit(['git', 'status', '--short'])).toBe(3);
    const long = Array.from({ length: 40 }, (_, i) => `w${String(i)}`);
    expect(scopeLimit(long)).toBe(MAX_SCOPE_WORDS);
  });

  it('clamps instead of overflowing, and falls back to the first word', () => {
    expect(clampScope(0, 5)).toBe(1);
    expect(clampScope(-3, 5)).toBe(1);
    expect(clampScope(9, 5)).toBe(5);
    expect(clampScope(Number.NaN, 5)).toBe(1);
    expect(clampScope(1.7, 5)).toBe(1);
    expect(clampScope(3, 0)).toBe(0);
  });

  it('steps within the offered range and stops at both ends', () => {
    expect(stepScope(1, 3, -1)).toBe(1);
    expect(stepScope(2, 3, -1)).toBe(1);
    expect(stepScope(2, 3, 1)).toBe(3);
    expect(stepScope(3, 3, 1)).toBe(3);
    // A composite/one-word request has no range at all: it never moves.
    expect(stepScope(1, 0, 1)).toBe(0);
  });
});

describe('answer assembly', () => {
  it('sends a bare always when the request offers no scope', () => {
    expect(alwaysAnswer(undefined, 1)).toBe('always');
    expect(alwaysAnswer(['git'], 1)).toBe('always');
  });

  it('pins the always grant to the chosen word prefix', () => {
    expect(alwaysAnswer(['git', 'status', '--short'], 2)).toEqual({ answer: 'always', scopeWords: 2 });
    // Out of range clamps into the range rather than being refused on the wire.
    expect(alwaysAnswer(['git', 'status'], 9)).toEqual({ answer: 'always', scopeWords: 2 });
  });

  it('drops an empty reason and trims a real one', () => {
    expect(denyAnswer('')).toBe('deny');
    expect(denyAnswer('   ')).toBe('deny');
    expect(denyAnswer('  太危险了  ')).toEqual({ answer: 'deny', reason: '太危险了' });
  });

  it('caps the reason the way core does', () => {
    const cut = denyAnswer('x'.repeat(UI_MAX_REASON_CHARS + 120));
    expect(cut).toEqual({ answer: 'deny', reason: 'x'.repeat(UI_MAX_REASON_CHARS) });
  });
});

describe('key routing', () => {
  it('y / a / n answer outside the field', () => {
    expect(approvalKey(key({ key: 'y' }))).toEqual({ kind: 'answer', answer: 'allow' });
    expect(approvalKey(key({ key: 'A', words: ['git', 'status'], scope: 2 })))
      .toEqual({ kind: 'answer', answer: { answer: 'always', scopeWords: 2 } });
    expect(approvalKey(key({ key: 'n', reason: '别动配置' })))
      .toEqual({ kind: 'answer', answer: { answer: 'deny', reason: '别动配置' } });
  });

  it('letters typed into the reason field are text, not answers', () => {
    for (const letter of ['y', 'a', 'n', 'Y', 'A', 'N']) {
      expect(approvalKey(key({ key: letter, inField: true, reason: '因为是 ' + letter }))).toEqual({ kind: 'none' });
    }
  });

  it('Enter sends the denial from the field, Shift+Enter breaks the line', () => {
    expect(approvalKey(key({ key: 'Enter', inField: true, reason: '不行' })))
      .toEqual({ kind: 'answer', answer: { answer: 'deny', reason: '不行' } });
    expect(approvalKey(key({ key: 'Enter', inField: true, reason: '不行', shiftKey: true }))).toEqual({ kind: 'none' });
    // An empty reason is not an answer: Enter with nothing typed does nothing.
    expect(approvalKey(key({ key: 'Enter', inField: true, reason: '  ' }))).toEqual({ kind: 'none' });
  });

  it('Escape clears a half-typed reason and never decides anything', () => {
    expect(approvalKey(key({ key: 'Escape', reason: '半句' }))).toEqual({ kind: 'clear-reason' });
    expect(approvalKey(key({ key: 'Escape', inField: true, reason: '半句' }))).toEqual({ kind: 'clear-reason' });
    expect(approvalKey(key({ key: 'Escape' }))).toEqual({ kind: 'none' });
  });

  it('arrows step the scope, and only when the request offers one', () => {
    expect(approvalKey(key({ key: 'ArrowRight', words: ['git', 'status'], scope: 1 })))
      .toEqual({ kind: 'scope', scope: 2 });
    expect(approvalKey(key({ key: 'ArrowLeft', words: ['git', 'status'], scope: 2 })))
      .toEqual({ kind: 'scope', scope: 1 });
    // One word (or a compound command): the arrows belong to the scroll region.
    expect(approvalKey(key({ key: 'ArrowRight', words: ['rm'], scope: 1 }))).toEqual({ kind: 'none' });
    expect(approvalKey(key({ key: 'ArrowRight', scope: 1 }))).toEqual({ kind: 'none' });
  });

  it('leaves every other key alone', () => {
    expect(approvalKey(key({ key: 'Tab' }))).toEqual({ kind: 'none' });
    expect(approvalKey(key({ key: 'Enter' }))).toEqual({ kind: 'none' });
    expect(approvalKey(key({ key: ' ' }))).toEqual({ kind: 'none' });
  });
});

describe('seam with the host frame parser', () => {
  const cases: ApprovalKeyState[] = [
    key({ key: 'y' }),
    key({ key: 'n' }),
    key({ key: 'n', reason: '  拒绝，理由很长 '.repeat(40) }),
    key({ key: 'a', words: ['git', 'status'], scope: 1 }),
    key({ key: 'a', words: ['git', 'status'], scope: 2 }),
    key({ key: 'a', words: Array.from({ length: 40 }, (_, i) => `w${String(i)}`), scope: 32 }),
  ];

  it('every assembled answer survives parseAskResult', () => {
    for (const state of cases) {
      const action = approvalKey(state);
      expect(action.kind).toBe('answer');
      if (action.kind !== 'answer') continue;
      expect(parseAskResult(action.answer)).toBeDefined();
    }
  });

  it('restates core\'s caps exactly (a drifted copy would fail closed on the wire)', () => {
    expect(MAX_SCOPE_WORDS).toBe(MAX_ALWAYS_SCOPE_WORDS);
    expect(UI_MAX_REASON_CHARS).toBe(MAX_DENY_REASON_CHARS);
  });

  it('a reason longer than the cap still arrives as a denial with a reason', () => {
    const long = 'x'.repeat(4_000);
    expect(parseAskResult(denyAnswer(long))).toEqual({ answer: 'deny', reason: 'x'.repeat(MAX_DENY_REASON_CHARS) });
  });
});