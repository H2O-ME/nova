/**
 * The question card: `ask_user_question` rendered for a terminal.
 *
 * A question batch blocks the run the same way an approval does, so it needs the
 * same takeover — but its shape is a **pager over N questions**, not a fixed
 * three-option verdict, and the composer cannot be used to answer it (the batch
 * owns the keyboard while it is up).
 *
 * Kept out of `panels.ts` for two reasons: that file is at its line ceiling, and
 * the subject is genuinely separate — `panels.ts` owns the *fixed* bottom-stack
 * regions, while this is a modal that replaces them.
 *
 * The card is drawn with the same edge helpers as every other card, because the
 * one-left-edge/one-right-edge rule is what makes a popup read as part of the
 * same screen rather than as a second application stacked on top.
 */
import { wrapLine } from '@nova-agent/tui';
import type { AskUserQuestionItem } from '@nova-agent/core';
import { COMPOSER_PAD_COLS, chromeWidth } from './layout.js';
import { cardBottom, cardRow, cardTop, fit } from './panels.js';
import { paint, type Palette } from './theme.js';
import { draftOf, isAnswered, type QuestionDraft, type QuestionState } from './question.js';

/** Rows of question body drawn per question before the text is cut. */
const BODY_ROWS = 4;

export interface QuestionCardInput {
  cols: number;
  questions: readonly AskUserQuestionItem[];
  state: QuestionState;
  palette: Palette;
}

/**
 * The batch, as a card: the focused question in full, the rest folded to one
 * line each, so the pager always shows how much is left without scrolling.
 */
export function questionCard(input: QuestionCardInput): string[] {
  const { palette, questions } = input;
  const width = chromeWidth(input.cols);
  const inner = width - 2;
  const bodyWidth = Math.max(8, inner - 2 * COMPOSER_PAD_COLS);
  const at = Math.min(Math.max(0, input.state.at), Math.max(0, questions.length - 1));
  const caption = `${paint(palette, palette.warn, '?')} ${paint(palette, palette.text, '模型需要你确认')} ${
    questions.length > 1 ? paint(palette, palette.gray, `[${at + 1}/${questions.length}]`) : ''
  }`.trimEnd();
  const lines = [cardTop(width, caption, palette)];
  const push = (content: string): void => {
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${fit(content, bodyWidth)}`, width, palette));
  };

  questions.forEach((question, index) => {
    const draft = draftOf(input.state.drafts, question.id);
    const focused = index === at;
    // Unfocused questions collapse to one line — their whole point here is to
    // show the batch's size and which ones are still open.
    if (!focused) {
      push(questionSummary(question, draft, palette));
      return;
    }
    const marker = paint(palette, palette.accent, '❯');
    const multi = question.multiSelect === true ? paint(palette, palette.dim, '（可多选）') : '';
    // A skipped question stays marked even while it has focus: skipping is a
    // decision the user made, and losing the record of it the moment the cursor
    // lands back on the question would make the card deny what just happened.
    const skipped = draft.skipped ? ` ${paint(palette, palette.gray, '[已跳过]')}` : '';
    push(`${marker} ${paint(palette, palette.text, question.question)}${multi}${skipped}`);
    if (question.detail !== undefined && question.detail.length > 0) {
      for (const line of wrapLine(question.detail, bodyWidth - 2).slice(0, BODY_ROWS)) {
        push(`  ${paint(palette, palette.textSecondary, line)}`);
      }
    }
    const options = question.options ?? [];
    if (options.length === 0) {
      // No menu: this question is answered by typing alone, so the text row is
      // the only control and the card must say so.
      push(`  ${paint(palette, palette.gray, '直接输入你的答案，回车确认')}`);
      push(`  ${customRow(input.state, draft, palette)}`);
      return;
    }
    for (const option of options) {
      const picked = draft.selected.includes(option.label);
      const box = picked ? paint(palette, palette.ok, '◉') : paint(palette, palette.grayDim, '○');
      const label = picked ? paint(palette, palette.text, option.label) : paint(palette, palette.textSecondary, option.label);
      const description = option.description === undefined ? '' : ` ${paint(palette, palette.gray, `— ${option.description}`)}`;
      push(`  ${box} ${label}${description}`);
    }
    // The free-text row is always offered ("Other"), and is what the card shows
    // as focused while the user types into it.
    push(`  ${customRow(input.state, draft, palette)}`);
  });

  lines.push(cardBottom(width, footer(input.state, questions, palette), palette));
  return lines;
}

/** The focused question's free-text row: a caret while typing, a hint otherwise. */
function customRow(state: QuestionState, draft: QuestionDraft, palette: Palette): string {
  const typing = state.typing;
  const marker = typing ? paint(palette, palette.accent, '❯') : ' ';
  if (draft.custom.length > 0) {
    // Reverse video is the caret everywhere else in this UI; ASCII-only inside,
    // because SGR 7 changes the font fallback (see `theme.ts`).
    const caret = typing ? `${paint(palette, palette.reset, '\x1b[7m')} ${paint(palette, palette.reset, '\x1b[0m')}` : '';
    return `${marker} ${paint(palette, palette.text, draft.custom)}${caret}`;
  }
  if (typing) return `${marker} ${paint(palette, palette.reset, '\x1b[7m')} ${paint(palette, palette.reset, '\x1b[0m')}`;
  return `${marker} ${paint(palette, palette.grayDim, '其他（按 i 输入自定义答案）')}`;
}

/** One folded line for an unfocused question: its state and its heading. */
function questionSummary(question: AskUserQuestionItem, draft: QuestionDraft, palette: Palette): string {
  const mark = draft.skipped
    ? paint(palette, palette.grayDim, '—')
    : isAnswered(draft)
      ? paint(palette, palette.ok, '✓')
      : paint(palette, palette.warn, '·');
  const title = question.header !== undefined && question.header.length > 0 ? question.header : question.question;
  const answer = answerSummary(draft);
  const tail = answer === '' ? '' : ` ${paint(palette, palette.gray, `→ ${answer}`)}`;
  return `  ${mark} ${paint(palette, palette.textSecondary, title)}${tail}`;
}

function answerSummary(draft: QuestionDraft): string {
  if (draft.skipped) return '已跳过';
  const custom = draft.custom.trim();
  if (custom.length > 0) return custom;
  return draft.selected.join('、');
}

/**
 * The card's bottom edge: what submitting would do right now. It states the
 * blockers rather than only refusing, because "Enter" doing nothing with no
 * reason given is the failure mode this line exists to prevent.
 */
function footer(state: QuestionState, questions: readonly AskUserQuestionItem[], palette: Palette): string | undefined {
  const at = Math.min(Math.max(0, state.at), Math.max(0, questions.length - 1));
  const current = questions[at];
  if (current !== undefined && !isAnswered(draftOf(state.drafts, current.id))) {
    return paint(palette, palette.gray, '回车跳过这一题');
  }
  const last = at >= questions.length - 1;
  return paint(palette, palette.gray, last ? '回车提交全部答案' : '回车下一题');
}

/** The hint-bar key set while a question batch owns the keyboard. */
export function questionHintKeys(input: {
  multiSelect: boolean;
  typing: boolean;
  hasOptions: boolean;
  questions: number;
}): readonly [string, string][] {
  if (input.typing) {
    return [
      ['Enter', '确认'],
      ['Backspace', '删字'],
      ['Esc', '取消输入'],
    ];
  }
  const keys: [string, string][] = [['↑↓', '选择']];
  if (input.multiSelect) keys.push(['Space', '多选']);
  if (input.hasOptions) keys.push(['i', '自定义']);
  keys.push(['Enter', input.questions > 1 ? '下一题' : '提交']);
  keys.push(['Esc', '跳过']);
  return keys;
}
