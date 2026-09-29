/**
 * The question batch's keys: what a keystroke means while `ask_user_question`
 * has the run parked.
 *
 * Split out of `keys.ts` because it answers a different question from the rest
 * of the key chain. That file routes ("who owns the keyboard now?") and this one
 * decides ("given that a question batch owns it, what did this key just do?") —
 * and the second has its own vocabulary: a pager, per-question drafts, two kinds
 * of row, and a submit that depends on the whole batch rather than the focused
 * question.
 *
 * Two rules here are the ones worth knowing:
 *
 *  - **Enter never means "I want to type".** It picks the row under the cursor;
 *    on the free-text row it opens typing, and the characters that follow are
 *    handled by the typing branch. So a stray character while the option list
 *    has focus is ignored rather than silently appended to an invisible field.
 *  - **Esc skips the focused question; Ctrl+C cancels the batch.** Skipping is
 *    what makes a batch submittable while one question goes unanswered, and it
 *    must not discard answers already typed against the *other* questions — so
 *    the destructive verb is a different, deliberate key.
 */
import type { Key } from '@nova-agent/tui';
import type { QuestionRequest } from '@nova-agent/core';
import {
  allComplete,
  appendCustom,
  backspaceCustom,
  buildAnswer,
  createQuestionState,
  draftOf,
  firstIncomplete,
  onCustomRow,
  rowCount,
  skipQuestion,
  stepCursor,
  toggleOption,
  type QuestionState,
} from './question.js';
import type { TuiAction, UiState } from './keys.js';

/** The outcome of one key: the next UI state, plus what the shell should do. */
export interface QuestionKeyResult {
  state: UiState;
  action: TuiAction;
}

/**
 * Interpret one key against the outstanding batch.
 * @param state - the UI state (its `questions` may be absent; it is materialized here).
 * @param key - the decoded key.
 * @param request - the batch the kernel is waiting on.
 * @returns the next state and the action, if any.
 */
export function questionKey(state: UiState, key: Key, request: QuestionRequest): QuestionKeyResult {
  const questions = request.questions;
  const none: TuiAction = { kind: 'none' };
  const at0 = Math.min(Math.max(0, state.questions?.at ?? 0), Math.max(0, questions.length - 1));
  const current = questions[at0];
  if (current === undefined) return { state, action: none };
  // The batch state is materialized here rather than left `undefined` for the
  // render sites to fill in: two independent `?? createQuestionState()`
  // fallbacks (the card and the hint bar) could otherwise disagree about the
  // cursor, and any key that only reads would leave the card with no state.
  const ask = state.questions ?? createQuestionState();
  const base: UiState = { ...state, questions: ask };
  const withAsk = (next: QuestionState, action: TuiAction = none): QuestionKeyResult => ({
    state: { ...base, questions: next },
    action,
  });
  const apply = (draft: ReturnType<typeof draftOf>): QuestionState => ({
    ...ask,
    drafts: { ...ask.drafts, [current.id]: draft },
  });

  if (ask.typing) {
    switch (key.type) {
      case 'char':
        return withAsk(appendCustom(ask, current, key.ch));
      case 'paste':
        // A paste goes in whole (the kernel bounds the field) rather than being
        // dropped, which would silently lose what the user pasted.
        return withAsk(
          apply({
            ...draftOf(ask.drafts, current.id),
            custom: draftOf(ask.drafts, current.id).custom + key.text,
            skipped: false,
          }),
        );
      case 'backspace':
        return withAsk(backspaceCustom(ask, current));
      case 'enter':
      case 'esc':
        return withAsk({ ...ask, typing: false });
      default:
        return { state: base, action: none };
    }
  }

  const cursor = Math.min(Math.max(0, ask.cursor), rowCount(current) - 1);
  switch (key.type) {
    case 'up':
    case 'down':
      return withAsk({ ...ask, cursor: stepCursor(current, cursor, key.type === 'up' ? -1 : 1) });
    case 'enter': {
      // Enter on an option picks it; on the "Other" row it opens typing.
      if (onCustomRow(current, cursor)) return withAsk({ ...ask, typing: true });
      const label = (current.options ?? [])[cursor]?.label;
      if (label === undefined) return { state: base, action: none };
      const next = toggleOption(ask, current, label);
      // A single-select pick is a decision, so it advances immediately — it
      // saves a keystroke per question, and the card's footer says so.
      return current.multiSelect === true ? withAsk(next) : advance(base, next, request);
    }
    case 'char':
      // `i` opens the free-text row. Nothing else is inserted: there is no
      // visible field to receive a stray character, so accepting one would put
      // text in an answer the user cannot see.
      if (key.ch === 'i') return withAsk({ ...ask, typing: true, cursor: rowCount(current) - 1 });
      return { state: base, action: none };
    case 'ctrl+c':
      return { state: base, action: { kind: 'cancelQuestions', id: request.id } };
    case 'esc':
      return advance(base, apply(skipQuestion()), request);
    default:
      return { state: base, action: none };
  }
}

/**
 * Advance the pager, submitting when the whole batch is settled.
 *
 * When it is not settled, the cursor moves to the next *open* question rather
 * than simply to the next one: landing on a question that is already answered
 * would make Enter feel like it did nothing.
 * @param state - the UI state.
 * @param ask - the batch state so far.
 * @param request - the batch.
 * @returns the next state and, once settled, the assembled answer.
 */
function advance(state: UiState, ask: QuestionState, request: QuestionRequest): QuestionKeyResult {
  const questions = request.questions;
  const settled = { ...ask, typing: false };
  if (allComplete(questions, settled.drafts)) {
    return {
      state: { ...state, questions: settled },
      action: { kind: 'answerQuestions', id: request.id, answers: buildAnswer(questions, settled.drafts) },
    };
  }
  const forward = firstIncomplete(questions.slice(settled.at + 1), settled.drafts);
  const target = forward >= 0 ? settled.at + 1 + forward : firstIncomplete(questions, settled.drafts);
  return {
    state: { ...state, questions: { ...settled, at: target < 0 ? settled.at : target, cursor: 0 } },
    action: { kind: 'none' },
  };
}
