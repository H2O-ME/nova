/**
 * The question flow: the state machine the TUI gained so `ask_user_question`
 * cannot hang a terminal run.
 *
 * These are the tests that would have caught the three defects this feature was
 * written to avoid, all of them already paid for on the web surface:
 *
 *  1. **No card at all.** Before this, the TUI replayed `pendingApprovals()` on
 *     attach but not `pendingQuestions()`, and its reducer had no
 *     `question_request` case — so a batch arriving while the surface was up
 *     rendered nothing and the run waited forever. A terminal run that cannot be
 *     answered is worse than one that refuses the ask.
 *  2. **A skip that is a dead end.** Gating submission on "answered" alone makes
 *     a skipped question permanently unsettleable, so the batch can never be
 *     submitted. `isComplete` is what keeps a skip a decision.
 *  3. **Option and free text sent together.** The wire prefers the text, so
 *     leaving a stale selection behind shows the user one answer and sends the
 *     model another.
 */
import { describe, expect, it } from 'vitest';
import type { AskUserQuestionItem } from '@nova-agent/core';
import {
  allComplete,
  appendCustom,
  backspaceCustom,
  buildAnswer,
  createQuestionState,
  draftOf,
  firstIncomplete,
  isAnswered,
  isComplete,
  rowCount,
  onCustomRow,
  skipQuestion,
  stepCursor,
  toggleOption,
} from '../src/question.js';
import { reduce, initialTranscript } from '../src/blocks.js';
import { createUiState, handleKey } from '../src/keys.js';
import type { Key } from '@nova-agent/tui';

const single: AskUserQuestionItem = {
  id: 'q1',
  question: '用哪个方案？',
  options: [{ label: '方案 A' }, { label: '方案 B' }],
};

const multi: AskUserQuestionItem = {
  id: 'q2',
  question: '包含哪些？',
  multiSelect: true,
  options: [{ label: 'X' }, { label: 'Y' }],
};

const typed = (ch: string): Key => ({ type: 'char', ch });
const ENTER: Key = { type: 'enter' };
const ESC: Key = { type: 'esc' };
const DOWN: Key = { type: 'down' };
const UP: Key = { type: 'up' };

function ctx(questions: readonly AskUserQuestionItem[], state = createUiState()) {
  return {
    state,
    key: (key: Key) =>
      handleKey(state, key, {
        running: true,
        pending: undefined,
        question: { id: 'ask-1', questions },
        commands: [],
        canSwitchMode: false,
        entryAt: () => undefined,
      }),
  };
}

describe('the question reducer puts a card on screen', () => {
  it('records a pending batch and clears it when resolved', () => {
    const ctx0 = { tools: () => [], now: 0 };
    const withQ = reduce(initialTranscript, { type: 'question_request', request: { id: 'ask-1', questions: [single] } }, ctx0);
    expect(withQ.question?.id).toBe('ask-1');
    const resolved = reduce(withQ, { type: 'question_resolved', id: 'ask-1', resolution: { source: 'cancelled' } }, ctx0);
    expect(resolved.question).toBeNull();
  });

  it('does not clear the card for a different batch id', () => {
    // A stale `question_resolved` (an older ask settling late) must not take
    // down the card for the batch that is actually up.
    const ctx0 = { tools: () => [], now: 0 };
    const withQ = reduce(initialTranscript, { type: 'question_request', request: { id: 'ask-1', questions: [single] } }, ctx0);
    const other = reduce(withQ, { type: 'question_resolved', id: 'ask-OLD', resolution: { source: 'cancelled' } }, ctx0);
    expect(other.question?.id).toBe('ask-1');
  });

  it('keeps a question and an approval independent', () => {
    // They are separate kernel seams and can both be outstanding; collapsing
    // them into one field would let either hide the other.
    const ctx0 = { tools: () => [], now: 0 };
    const s = reduce(initialTranscript, { type: 'question_request', request: { id: 'ask-1', questions: [single] } }, ctx0);
    expect(s.question).not.toBeNull();
    expect(s.pending).toBeNull();
  });
});

describe('skip is a decision, not an absence', () => {
  it('treats a skipped question as complete', () => {
    expect(isAnswered(skipQuestion())).toBe(false);
    expect(isComplete(skipQuestion())).toBe(true);
  });

  it('lets a batch be submitted once every question is skipped', () => {
    // The dead end this guards: with `isAnswered` as the gate, a skipped
    // question can never become answered and `allComplete` is never true.
    const drafts = { q1: skipQuestion(), q2: skipQuestion() };
    expect(allComplete([single, multi], drafts)).toBe(true);
    expect(firstIncomplete([single, multi], drafts)).toBe(-1);
  });

  it('sends a skipped question as an empty answer, and reports every question', () => {
    const answer = buildAnswer([single, multi], { q1: skipQuestion() });
    expect(answer.answers).toHaveLength(2);
    expect(answer.answers[0]).toEqual({ id: 'q1', selected: [] });
    // Not answered at all — reported as unanswered rather than omitted, so the
    // model learns which one by reading `selected: []` instead of inferring it.
    expect(answer.answers[1]).toEqual({ id: 'q2', selected: [] });
  });

  it('skips with Esc and lands on the next open question', () => {
    const c = ctx([single, multi]);
    const first = c.key(ESC);
    expect(first.state.questions?.at).toBe(1);
    expect(draftOf(first.state.questions!.drafts, 'q1').skipped).toBe(true);
  });

  it('submits the batch on the last question once all are settled', () => {
    const c = ctx([single]);
    // Enter on option 0 picks it; single-select is a decision, so it advances
    // and — the batch being complete — resolves immediately.
    const r = c.key(ENTER);
    expect(r.action).toEqual({ kind: 'answerQuestions', id: 'ask-1', answers: { answers: [{ id: 'q1', selected: ['方案 A'] }] } });
  });
});

describe('the option list and the free-text row are alternatives', () => {
  it('clears the free text when a single-select option is picked', () => {
    let state = createQuestionState();
    state = appendCustom(state, single, '自');
    state = appendCustom(state, single, '定义');
    state = toggleOption(state, single, '方案 B');
    const draft = draftOf(state.drafts, 'q1');
    expect(draft.selected).toEqual(['方案 B']);
    expect(draft.custom).toBe('');
  });

  it('builds an answer that never carries both a selection and custom text', () => {
    // The wire prefers the text; a stale selection left behind would mean the
    // card shows one answer and the model reads another.
    const answer = buildAnswer([single], { q1: { selected: ['方案 A'], custom: '其实用 C', skipped: false } });
    expect(answer.answers[0]).toEqual({ id: 'q1', selected: [], custom: '其实用 C' });
  });

  it('accumulates on multi-select and keeps the text alongside', () => {
    let state = createQuestionState();
    state = toggleOption(state, multi, 'X');
    state = toggleOption(state, multi, 'Y');
    expect(draftOf(state.drafts, 'q2').selected).toEqual(['X', 'Y']);
    // Multi-select legitimately sends both, so its text is not cleared.
    const answer = buildAnswer([multi], { q2: { selected: ['X', 'Y'], custom: 'and Z', skipped: false } });
    expect(answer.answers[0]).toEqual({ id: 'q2', selected: ['X', 'Y'], custom: 'and Z' });
  });

  it('unpicks with a second toggle', () => {
    let state = toggleOption(createQuestionState(), multi, 'X');
    state = toggleOption(state, multi, 'X');
    expect(draftOf(state.drafts, 'q2').selected).toEqual([]);
  });

  it('edits the custom text with append and backspace', () => {
    let state = createQuestionState();
    state = appendCustom(state, single, 'ab');
    state = backspaceCustom(state, single);
    expect(draftOf(state.drafts, 'q1').custom).toBe('a');
  });

  it('treats whitespace-only text as unanswered', () => {
    expect(isAnswered({ selected: [], custom: '   ', skipped: false })).toBe(false);
    expect(isComplete({ selected: [], custom: '   ', skipped: false })).toBe(false);
  });
});

describe('key routing for questions', () => {
  it('answers on Enter after choosing an option', () => {
    const c = ctx([single]);
    const first = c.key(ENTER); // picks option 0 and, single-select, resolves
    expect(first.action.kind).toBe('answerQuestions');
  });

  it('opens the free-text row with i and types there', () => {
    const state = createUiState();
    const c = ctx([single], state);
    const opened = c.key(typed('i'));
    expect(opened.state.questions?.typing).toBe(true);
    const after = handleKey(opened.state, typed('C'), {
      running: true,
      pending: undefined,
      question: { id: 'ask-1', questions: [single] },
      commands: [],
      canSwitchMode: false,
      entryAt: () => undefined,
    });
    expect(draftOf(after.state.questions!.drafts, 'q1').custom).toBe('C');
  });

  it('does not swallow stray characters into an answer', () => {
    // There is no visible text field while the option list has focus, so
    // accepting a character would put text in an answer the user cannot see.
    const c = ctx([single]);
    const r = c.key(typed('z'));
    expect(draftOf(r.state.questions!.drafts, 'q1').custom).toBe('');
  });

  it('moves the option cursor with the arrows', () => {
    const c = ctx([single]);
    const down = c.key(DOWN);
    expect(down.state.questions?.cursor).toBe(1);
    const up = c.key(UP);
    expect(up.state.questions?.cursor).toBe(0);
  });

  it('cancels the whole batch on Ctrl+C, not Esc', () => {
    // Esc must not discard answers already typed into other questions of the
    // same batch; cancelling is a separate, deliberate key.
    const c = ctx([single, multi]);
    expect(c.key({ type: 'ctrl+c' }).action).toEqual({ kind: 'cancelQuestions', id: 'ask-1' });
    expect(c.key(ESC).action.kind).toBe('none');
  });

  it('does not let a question batch intercept the approval card', () => {
    // The permission gate is the security decision: a question must never be
    // answerable by keystrokes meant for an approval, nor the reverse.
    const state = createUiState();
    const r = handleKey(state, ENTER, {
      running: true,
      pending: {
        id: 'appr-1',
        kind: 'execute',
        call: { id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{}' },
        preview: [],
      } as never,
      question: { id: 'ask-1', questions: [single] },
      commands: [],
      canSwitchMode: false,
      entryAt: () => undefined,
    });
    expect(r.action).toEqual({ kind: 'resolve', id: 'appr-1', answer: 'allow' });
  });
});

describe('cursor geometry', () => {
  it('includes the free-text row in the navigable rows', () => {
    expect(rowCount(single)).toBe(3); // two options + "Other"
    expect(rowCount({ id: 'q', question: 'q' })).toBe(1); // "Other" only
    expect(onCustomRow(single, 0)).toBe(false);
    expect(onCustomRow(single, 2)).toBe(true);
  });

  it('clamps the cursor to the question rows', () => {
    expect(stepCursor(single, 2, 1)).toBe(2);
    expect(stepCursor(single, 0, -1)).toBe(0);
  });
});

describe('hostile question ids', () => {
  it('does not resolve an inherited member for an id like __proto__', () => {
    // Ids come from the model. A plain `drafts[id] ?? EMPTY` would return a
    // function here, and the next `.selected.length` would throw inside the
    // render loop — reachable from a malformed tool call.
    for (const id of ['__proto__', 'constructor', 'toString']) {
      const draft = draftOf({}, id);
      expect(draft.selected).toEqual([]);
      expect(isAnswered(draft)).toBe(false);
    }
  });
});
