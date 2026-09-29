/**
 * The question card's decisions, as pure functions (M11 批4 + ask_user_question).
 *
 * A question batch blocks the run exactly the way an approval does, so it takes
 * over the keyboard the same way — but its *card* is a pager over N questions
 * instead of a fixed three-option verdict, and every rule that decides "can the
 * user advance" gets asserted here without a terminal.
 *
 * These rules are not invented: they mirror `web/ui/src/question/decisions.ts`
 * one for one, because the two surfaces answer the same kernel request and a
 * divergence would mean the same keystrokes produce different answers depending
 * on which surface happens to be up. The two that matter most, both learned the
 * hard way on the web side:
 *
 *  - **A skip is a decision, not an absence.** Gating submission on "answered"
 *    alone is a dead end: a skipped question can never become answered, so the
 *    submit control stays disabled forever and the batch is unsubmittable.
 *  - **Option and free text are alternatives, not two slots.** Picking an option
 *    clears the text and typing text clears the selection (on a single-select
 *    question), because the assembled answer prefers one of them — leaving the
 *    other behind would show the user one answer and send the model another.
 */
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@nova-agent/core';

/** One question's half-typed answer. */
export interface QuestionDraft {
  /** Option labels the user picked (at most one unless `multiSelect`). */
  selected: readonly string[];
  /** The free-text ("Other") answer. */
  custom: string;
  /** The human dismissed THIS question: settled, carrying no answer. */
  skipped: boolean;
}

/** An untouched draft. */
export const EMPTY_DRAFT: QuestionDraft = { selected: [], custom: '', skipped: false };

/** The ask as it is being answered: which question is focused, and each draft. */
export interface QuestionState {
  /** Index into the batch (the pager cursor). */
  at: number;
  /**
   * The focused row of the current question: an option index, or
   * `options.length` for the free-text ("Other") row.
   */
  cursor: number;
  /** Drafts by question id. */
  drafts: Readonly<Record<string, QuestionDraft>>;
  /** Whether the free-text row has the keyboard. */
  typing: boolean;
}

export function createQuestionState(): QuestionState {
  return { at: 0, cursor: 0, drafts: {}, typing: false };
}

/** How many focusable rows a question has: its options, plus the "Other" row. */
export function rowCount(question: AskUserQuestionItem): number {
  return (question.options ?? []).length + 1;
}

/** Move the option cursor, clamped to the question's rows. */
export function stepCursor(question: AskUserQuestionItem, cursor: number, delta: number): number {
  return Math.min(rowCount(question) - 1, Math.max(0, cursor + delta));
}

/** Is the cursor on the free-text row (past the last option)? */
export function onCustomRow(question: AskUserQuestionItem, cursor: number): boolean {
  return cursor >= (question.options ?? []).length;
}

/**
 * One question's draft, or the untouched one.
 *
 * `Object.hasOwn` and not `drafts[id] ?? EMPTY_DRAFT`: ids are chosen by the
 * MODEL, so `constructor` / `toString` / `__proto__` would resolve to an
 * inherited member, the `??` fallback would never be taken, and the caller would
 * get a function where a draft was promised. Same defect and same fix as the web
 * surface's `draftOf`.
 * @param drafts - drafts by question id.
 * @param id - the question's id.
 * @returns that question's draft, or {@link EMPTY_DRAFT}.
 */
export function draftOf(drafts: Readonly<Record<string, QuestionDraft>>, id: string): QuestionDraft {
  return Object.hasOwn(drafts, id) ? (drafts[id] as QuestionDraft) : EMPTY_DRAFT;
}

/** Does this draft hold an answer? Whitespace-only text is not one. */
export function isAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim().length > 0;
}

/** Is this question settled — answered OR explicitly skipped? */
export function isComplete(draft: QuestionDraft): boolean {
  return isAnswered(draft) || draft.skipped;
}

/** Every question in the batch settled (what gates the final submit). */
export function allComplete(
  questions: readonly AskUserQuestionItem[],
  drafts: Readonly<Record<string, QuestionDraft>>,
): boolean {
  return questions.every((question) => isComplete(draftOf(drafts, question.id)));
}

/**
 * The first question still needing a decision, or -1 when the batch is settled.
 * Submitting an unsettled batch lands the user on the question that stopped it
 * instead of only saying "not yet".
 */
export function firstIncomplete(
  questions: readonly AskUserQuestionItem[],
  drafts: Readonly<Record<string, QuestionDraft>>,
): number {
  return questions.findIndex((question) => !isComplete(draftOf(drafts, question.id)));
}

/** Step the pager, clamped at both ends. */
export function stepQuestion(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** Mark one question skipped: settled, and carrying no answer. */
export function skipQuestion(): QuestionDraft {
  return { ...EMPTY_DRAFT, skipped: true };
}

/** Set one question's draft in the map. */
function withDraft(
  state: QuestionState,
  question: AskUserQuestionItem,
  draft: QuestionDraft,
): QuestionState {
  return { ...state, drafts: { ...state.drafts, [question.id]: draft }, typing: false };
}

/**
 * Toggle one option, honoring `multiSelect`.
 *
 * Single-select replaces rather than accumulates (the kernel refuses a
 * multi-label answer for such a question) and clears the free text, because the
 * two are alternatives for one slot.
 * @param state - the ask so far.
 * @param question - the question that owns the option.
 * @param label - the option label's VALUE (never the display label).
 * @returns the next state.
 */
export function toggleOption(
  state: QuestionState,
  question: AskUserQuestionItem,
  label: string,
): QuestionState {
  const draft = draftOf(state.drafts, question.id);
  const multi = question.multiSelect === true;
  if (draft.selected.includes(label)) {
    return withDraft(state, question, { ...draft, selected: draft.selected.filter((item) => item !== label), skipped: false });
  }
  const selected = multi ? [...draft.selected, label] : [label];
  return withDraft(state, question, { ...draft, selected, custom: multi ? draft.custom : '', skipped: false });
}

/** Open the free-text row for this question. */
export function beginCustom(state: QuestionState): QuestionState {
  return { ...state, typing: true };
}

/** Append a character to the focused question's free text. */
export function appendCustom(state: QuestionState, question: AskUserQuestionItem, ch: string): QuestionState {
  const draft = draftOf(state.drafts, question.id);
  return withDraft(state, question, { ...draft, custom: draft.custom + ch, skipped: false });
}

/** Remove the last character of the focused question's free text. */
export function backspaceCustom(state: QuestionState, question: AskUserQuestionItem): QuestionState {
  const draft = draftOf(state.drafts, question.id);
  return withDraft(state, question, { ...draft, custom: draft.custom.slice(0, -1) });
}

/**
 * Assemble the wire answer. Every question is reported — a skipped one travels
 * as `selected: []` with no `custom`, which is how the model learns it went
 * unanswered rather than having to infer it from an absence.
 * @param questions - the batch, in ask order.
 * @param drafts - drafts by question id.
 * @returns the kernel's answer shape.
 */
export function buildAnswer(
  questions: readonly AskUserQuestionItem[],
  drafts: Readonly<Record<string, QuestionDraft>>,
): AskUserQuestionAnswer {
  return {
    answers: questions.map((question) => {
      const draft = draftOf(drafts, question.id);
      if (draft.skipped) return { id: question.id, selected: [] };
      const custom = draft.custom.trim();
      // Applied again at the wire so a draft assembled some other way cannot
      // smuggle an option and an "Other" answer out together.
      const selected = custom === '' || question.multiSelect === true ? [...draft.selected] : [];
      return { id: question.id, selected, ...(custom.length > 0 ? { custom } : {}) };
    }),
  };
}
