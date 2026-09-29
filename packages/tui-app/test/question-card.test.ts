/**
 * The question card's rendering: what a person actually reads while a batch has
 * the run parked.
 *
 * Asserted on structure, not on copy (AGENTS.md §6): the batch size, the focused
 * question, its options, and whether the picked one is marked. A wording tweak
 * must not turn this red, but "the card forgot the second question" must.
 */
import { describe, expect, it } from 'vitest';
import type { AskUserQuestionItem } from '@nova-agent/core';
import { questionCard, questionHintKeys } from '../src/question-card.js';
import { createQuestionState, toggleOption, skipQuestion } from '../src/question.js';
import { plainPalette } from '../src/theme.js';

const batch: AskUserQuestionItem[] = [
  {
    id: 'q1',
    question: '用哪个方案？',
    options: [{ label: '方案 A', description: '快' }, { label: '方案 B' }],
  },
  { id: 'q2', header: '范围', question: '包含哪些？', multiSelect: true, options: [{ label: 'X' }] },
];

const draw = (state = createQuestionState()): string =>
  questionCard({ cols: 80, questions: batch, state, palette: plainPalette() }).join('\n');

describe('the question card', () => {
  it('draws the focused question with its options', () => {
    const out = draw();
    expect(out).toContain('用哪个方案？');
    expect(out).toContain('方案 A');
    expect(out).toContain('方案 B');
    expect(out).toContain('快'); // the option's description
  });

  it('shows how much of the batch is left', () => {
    // The pager is the card's whole point: without the counter a person cannot
    // tell whether Enter is about to submit or to ask again.
    expect(draw()).toContain('1/2');
  });

  it('folds the unfocused questions to one line each', () => {
    const out = draw();
    // The second question's heading is visible (so the batch's size reads), but
    // its options are not drawn until it has focus.
    expect(out).toContain('范围');
    expect(out).not.toContain('包含哪些？');
  });

  it('marks a picked option, and only that one', () => {
    const picked = toggleOption(createQuestionState(), batch[0]!, '方案 B');
    const out = draw(picked);
    const rows = out.split('\n').filter((row) => row.includes('方案 '));
    const marked = rows.filter((row) => row.includes('◉'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('方案 B');
  });

  it('marks a skipped question as settled rather than unanswered', () => {
    const state = { ...createQuestionState(), drafts: { q1: skipQuestion() } };
    expect(draw(state)).toContain('已跳过');
  });

  it('marks a question with no options as free-text only', () => {
    const none: AskUserQuestionItem[] = [{ id: 'only', question: '叫什么？' }];
    const out = questionCard({ cols: 80, questions: none, state: createQuestionState(), palette: plainPalette() }).join('\n');
    expect(out).toContain('叫什么？');
    expect(out).toContain('直接输入你的答案');
  });

  it('keeps every card row inside the terminal width', () => {
    // A row that overflows wraps in a real terminal and corrupts the frame —
    // this is the one invariant a card must never break, so it is asserted with
    // a narrow terminal rather than the comfortable 80 above.
    for (const cols of [40, 60, 120]) {
      const rows = questionCard({ cols, questions: batch, state: createQuestionState(), palette: plainPalette() });
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(cols);
    }
  });
});

describe('the question hint keys', () => {
  it('offers multi-select and custom entry only when they are available', () => {
    const single = questionHintKeys({ multiSelect: false, typing: false, hasOptions: true, questions: 1 });
    expect(single.map(([key]) => key)).not.toContain('Space');
    expect(single.map(([key]) => key)).toContain('i');

    const multi = questionHintKeys({ multiSelect: true, typing: false, hasOptions: true, questions: 2 });
    expect(multi.map(([key]) => key)).toContain('Space');
  });

  it('switches to the text-editing set while typing', () => {
    const typing = questionHintKeys({ multiSelect: true, typing: true, hasOptions: true, questions: 1 });
    expect(typing.map(([key]) => key)).toEqual(['Enter', 'Backspace', 'Esc']);
  });

  it('drops the custom key for a question with no options', () => {
    // With no menu, the text row IS the answer — offering "i" to enter it would
    // be telling the user to press a key for the only thing they can do.
    const keys = questionHintKeys({ multiSelect: false, typing: false, hasOptions: false, questions: 1 });
    expect(keys.map(([key]) => key)).not.toContain('i');
  });
});
