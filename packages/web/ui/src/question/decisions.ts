/**
 * The question card's decisions as pure functions: what the pager shows, what a
 * draft means, and how the drafts are assembled into the wire answer.
 *
 * The card is a takeover while it is up, so every rule that decides "can the
 * user advance" and "what does submitting send" is asserted without a DOM
 * (`test/question-decisions.test.ts`), the same discipline `decisions.ts`
 * follows for the approval card.
 *
 * Two invariants the reference establishes and this file keeps:
 *  - **The answer carries option labels verbatim.** The recommendation suffix
 *    (`(Recommended)` / `（推荐）`) is display sugar only; the kernel validates a
 *    selected label against the labels the asker offered, so stripping it from
 *    the VALUE would make a legitimate answer fail validation.
 *  - **A question with no options is answered by its custom text alone** — it has
 *    no menu, and an empty answer would be a silent "yes" to nothing.
 */
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '../types.js';

/**
 * Split the conventional recommendation suffix from an option label for
 * DISPLAY only. Ported from the reference (`parseRecommendedLabel`): both the
 * ASCII and the full-width parenthesis forms, in either language, since the
 * model writes the suffix in the language it is answering in.
 * @param label - the option label as the asker wrote it.
 * @returns the label to draw, plus whether it was flagged as recommended.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false };
}

/**
 * The direction the pager's arrows step, clamped at both ends.
 * @param index - the current question.
 * @param delta - +1 / -1.
 * @param count - questions in the batch.
 * @returns the index to show.
 */
export function stepQuestion(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** One question's half-typed answer. */
export interface QuestionDraft {
  /** Option labels the user picked (at most one unless `multiSelect`). */
  selected: readonly string[];
  /** The free-text answer. */
  custom: string;
  /**
   * The human dismissed THIS question. A skip is a decision, not an absence: it
   * is what lets a batch be submitted while one question goes unanswered, and
   * the model still learns which one by reading `selected: []`.
   */
  skipped: boolean;
}

/** An untouched draft. */
export const EMPTY_DRAFT: QuestionDraft = { selected: [], custom: '', skipped: false };

/**
 * One question's draft, or the untouched one.
 *
 * `Object.hasOwn` and not `drafts[id] ?? EMPTY_DRAFT`: the drafts map is a plain
 * object literal, so a question id the MODEL chose (`constructor`, `toString`,
 * `__proto__`, …) resolves to an inherited member instead of `undefined`, the
 * `??` fallback is therefore never taken, and the caller gets a function where a
 * draft was promised — `isComplete` then throws `Cannot read properties of
 * undefined (reading 'length')` and the card crashes. Ids are only
 * length-bounded upstream (`parseQuestions`), so this is reachable from a
 * malformed or hostile tool call. Same discipline as the label tables.
 * @param drafts - the drafts by question id.
 * @param id - the question's id.
 * @returns that question's draft, or {@link EMPTY_DRAFT}.
 */
export function draftOf(
  drafts: Readonly<Record<string, QuestionDraft>>,
  id: string,
): QuestionDraft {
  return Object.hasOwn(drafts, id) ? drafts[id] as QuestionDraft : EMPTY_DRAFT;
}

/**
 * Is this draft an answer? A chosen option or non-blank custom text; a question
 * with no options therefore needs the text. Whitespace-only text is not an
 * answer — it would tell the model the human said something when they typed a
 * space.
 * @param draft - the question's half-typed answer.
 * @returns whether it holds an answer.
 */
export function isAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || draft.custom.trim().length > 0;
}

/**
 * May the batch be submitted with this question as it stands? Answered OR
 * explicitly skipped — the reference's `completed`. Gating submission on
 * `isAnswered` alone is a dead end: a skipped question can never become
 * answered, so the submit control stays disabled forever.
 * @param draft - the question's draft.
 * @returns whether the question is settled either way.
 */
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
 * @param questions - the batch, in the order it was asked.
 * @param drafts - the drafts by question id.
 * @returns the index to show, or -1.
 */
export function firstIncomplete(
  questions: readonly AskUserQuestionItem[],
  drafts: Readonly<Record<string, QuestionDraft>>,
): number {
  return questions.findIndex((question) => !isComplete(draftOf(drafts, question.id)));
}

/**
 * Toggle one option in a draft, honoring `multiSelect`.
 *
 * A single-select pick CLEARS the free text, mirroring {@link withCustom} in the
 * other direction: the two are alternatives for one question, not two slots. The
 * reference does the same. Keeping the old text would also be actively wrong —
 * `buildAnswer` sends the text in preference to the selection, so the card would
 * show one option checked while the model was told something else.
 *
 * @param question - the question that owns the option.
 * @param draft - the draft so far.
 * @param label - the option label's VALUE (never the display label).
 * @returns the next draft.
 */
export function toggleOption(
  question: AskUserQuestionItem,
  draft: QuestionDraft,
  label: string,
): QuestionDraft {
  const multi = question.multiSelect === true;
  if (draft.selected.includes(label)) {
    return { ...draft, selected: draft.selected.filter((item) => item !== label), skipped: false };
  }
  // Single-select replaces rather than accumulates; the kernel refuses a
  // multi-label answer for such a question, so accumulating would build an
  // answer the wire would reject.
  const selected = multi ? [...draft.selected, label] : [label];
  const custom = multi ? draft.custom : '';
  return { ...draft, selected, custom, skipped: false };
}

/**
 * Set one draft's free text. On a single-select question the text is an "Other"
 * answer, so it REPLACES any picked option — the reference does the same, and
 * sending both would put two contradictory answers in one slot.
 * @param question - the question being answered.
 * @param draft - the draft so far.
 * @param custom - the field's text.
 * @returns the next draft.
 */
export function withCustom(
  question: AskUserQuestionItem,
  draft: QuestionDraft,
  custom: string,
): QuestionDraft {
  const selected = question.multiSelect === true ? draft.selected : [];
  return { ...draft, selected, custom, skipped: false };
}

/** Mark one question skipped: it is settled, and it carries no answer. */
export function skipQuestion(): QuestionDraft {
  return { ...EMPTY_DRAFT, skipped: true };
}

/**
 * Assemble the wire answer from the drafts. Every question is reported — one the
 * user skipped travels as `selected: []` with no `custom`, which is how the
 * model learns it went unanswered instead of inferring it from an absence.
 * @param questions - the batch, in the order it was asked.
 * @param drafts - the drafts by question id.
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
      // Same rule as `withCustom`, applied at the wire so a draft assembled some
      // other way cannot smuggle an option and an "Other" answer out together.
      const selected = custom === '' || question.multiSelect === true ? [...draft.selected] : [];
      return { id: question.id, selected, ...(custom.length > 0 ? { custom } : {}) };
    }),
  };
}

/** The card's header text: the question's own heading, or its ordinal in the batch. */
export function questionTitle(question: AskUserQuestionItem, index: number, count: number): string {
  if (question.header !== undefined && question.header.length > 0) return question.header;
  return count > 1 ? `问题 ${String(index + 1)} / ${String(count)}` : '需要确认';
}
