/**
 * The terminal's line → answer parsing (both kinds of ask).
 *
 * Pure functions, so this is the cheap lane: the REPL's own routing is exercised
 * by hand, but what a typed line MEANS for the model is decided here and is worth
 * pinning. The failure this guards against is silent: a line that resolves to a
 * different option than the one the user read on screen, or a question that
 * vanishes from the batch because it was skipped.
 */
import { describe, expect, it } from 'vitest';
import type { AskUserQuestionItem } from '@nova-agent/core';
import { assembleAnswers, parseApprovalAnswer, parseQuestionAnswer, questionBatchLines } from '../src/repl-answers.js';
import { parseApprovalAnswer as parseViaReplBarrel } from '../src/repl.js';

const CHOICE: AskUserQuestionItem = {
  id: 'mode',
  question: '选哪种模式？',
  options: [{ label: '快速' }, { label: '彻底' }],
};
const MULTI: AskUserQuestionItem = {
  id: 'extras',
  question: '还要什么？',
  multiSelect: true,
  options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }],
};
const FREE: AskUserQuestionItem = { id: 'note', question: '备注？' };

describe('parseApprovalAnswer', () => {
  it('is still reachable from the repl barrel (one implementation, one import path)', () => {
    // The function moved to `repl-answers.ts`; the barrel re-exports it so no
    // caller or test had to change. Two live copies would be the real bug.
    expect(parseViaReplBarrel).toBe(parseApprovalAnswer);
  });

  it('maps the verdict letters and carries a denial reason through', () => {
    expect(parseApprovalAnswer('y')).toBe('allow');
    expect(parseApprovalAnswer('a')).toBe('always');
    expect(parseApprovalAnswer('n 别动 main 分支')).toEqual({ answer: 'deny', reason: '别动 main 分支' });
    // Anything unrecognized is a denial: the interactive lane resolves to the
    // safe end rather than throwing at a person mid-run.
    expect(parseApprovalAnswer('run the tests')).toBe('deny');
  });
});

describe('parseQuestionAnswer', () => {
  it('matches an option by its exact label', () => {
    expect(parseQuestionAnswer(CHOICE, '彻底')).toEqual({ id: 'mode', selected: ['彻底'] });
  });

  it('matches an option by its 1-based screen number', () => {
    // Typing a whole label is painful at a terminal; the number is what the
    // printed batch actually shows beside it.
    expect(parseQuestionAnswer(CHOICE, '2')).toEqual({ id: 'mode', selected: ['彻底'] });
    expect(parseQuestionAnswer(CHOICE, '3')).toEqual({ id: 'mode', selected: [], custom: '3' });
  });

  it('prefers a literal label over the number it happens to look like', () => {
    // The printed line is the promise: when an option's own label is "1", typing
    // "1" must mean that option, not position 1.
    const numeric: AskUserQuestionItem = { id: 'n', question: 'pick', options: [{ label: '1' }, { label: '2' }] };
    expect(parseQuestionAnswer(numeric, '1')).toEqual({ id: 'n', selected: ['1'] });
  });

  it('treats a blank line as an explicit skip, not as custom text', () => {
    // `selected: []` with no `custom` is how the model reads "this one was
    // skipped"; an empty custom string would be indistinguishable from a typo.
    expect(parseQuestionAnswer(CHOICE, '   ')).toEqual({ id: 'mode', selected: [] });
  });

  it('reads free text as a custom answer when nothing matches', () => {
    expect(parseQuestionAnswer(FREE, '先别动手')).toEqual({ id: 'note', selected: [], custom: '先别动手' });
    expect(parseQuestionAnswer(CHOICE, '都不是，用第三种')).toEqual({
      id: 'mode',
      selected: [],
      custom: '都不是，用第三种',
    });
  });

  it('splits a multi-select line on either comma, and leaves single-select intact', () => {
    expect(parseQuestionAnswer(MULTI, '1, 3')).toEqual({ id: 'extras', selected: ['a', 'c'] });
    expect(parseQuestionAnswer(MULTI, 'a，b')).toEqual({ id: 'extras', selected: ['a', 'b'] });
    // A single-select question must not lose half a custom answer to a comma.
    expect(parseQuestionAnswer(CHOICE, 'A, B')).toEqual({ id: 'mode', selected: [], custom: 'A, B' });
  });
});

describe('assembleAnswers', () => {
  it('reports every question, so a skipped one is stated rather than inferred', () => {
    const questions = [CHOICE, MULTI, FREE];
    const answer = assembleAnswers(questions, [{ id: 'mode', selected: ['快速'] }]);
    expect(answer.answers).toEqual([
      { id: 'mode', selected: ['快速'] },
      { id: 'extras', selected: [] },
      { id: 'note', selected: [] },
    ]);
  });

  it('keeps the batch order, not the answer order', () => {
    const answer = assembleAnswers([FREE, CHOICE], [
      { id: 'mode', selected: ['彻底'] },
      { id: 'note', selected: [], custom: 'x' },
    ]);
    expect(answer.answers.map((item) => item.id)).toEqual(['note', 'mode']);
  });
});

describe('questionBatchLines', () => {
  const paint = { cyan: (t: string) => t, dim: (t: string) => t, yellow: (t: string) => t };

  it('numbers every option and marks the focused question', () => {
    const lines = questionBatchLines(paint, [CHOICE, FREE], 1);
    const text = lines.join('\n');
    expect(text).toContain('共 2 题');
    expect(text).toContain('1) 快速');
    expect(text).toContain('2) 彻底');
    // The second question is the focus, so its row carries the marker.
    expect(lines.find((line) => line.includes('备注？'))).toContain('›');
    expect(lines.find((line) => line.includes('选哪种模式？'))).not.toContain('›');
  });

  it('says a question with no options is answered by typing', () => {
    expect(questionBatchLines(paint, [FREE], 0).join('\n')).toContain('直接输入你的答案');
  });

  it('says a multi-select question takes a comma-separated list', () => {
    expect(questionBatchLines(paint, [MULTI], 0).join('\n')).toContain('可多选');
  });
});
