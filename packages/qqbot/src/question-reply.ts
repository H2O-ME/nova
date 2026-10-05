/**
 * `ask_user_question` over a chat window: how a question is SHOWN and how prose
 * becomes an answer.
 *
 * A chat window is not a form. The browser renders the batch as cards with real
 * controls; a peer gets text, so the two halves of this file are the whole
 * adaptation:
 *
 *  - `renderQuestions` numbers the options, because "the third one" has to be
 *    sayable and a label may be long or ambiguous;
 *  - `parseAnswer` turns what came back into the kernel's structured batch —
 *    numbers for the options, anything else as free text.
 *
 * Both are pure and live here rather than inline in the orchestrator, because the
 * mapping is where the whole feature can be silently wrong: an answer that does
 * not fit the questions it was asked is REJECTED by the broker (see core's
 * `validateQuestionAnswer`), so a mis-mapped reply does not fail loudly — it
 * leaves the run parked and the peer believing they answered.
 */
import {
  MAX_CUSTOM_ANSWER_CHARS,
  type AskUserQuestionAnswer,
  type AskUserQuestionAnswerItem,
  type AskUserQuestionItem,
} from '@nova-agent/core';

/** One question's options, numbered from 1 as the peer sees them. */
interface Choice {
  /** 1-based number the peer types. */
  number: number;
  label: string;
}

/** The rendering of one question, and the choices it offers. */
interface RenderedQuestion {
  question: AskUserQuestionItem;
  choices: Choice[];
}

/** The whole batch, in the shape both the renderer and the parser need. */
export function layoutQuestions(questions: readonly AskUserQuestionItem[]): RenderedQuestion[] {
  return questions.map((question) => ({
    question,
    choices: (question.options ?? []).map((option, index) => ({ number: index + 1, label: option.label })),
  }));
}

/**
 * The message a peer receives for one outstanding question batch.
 * @param questions - the batch, as the asker normalized it.
 * @returns the text to send.
 */
export function renderQuestions(questions: readonly AskUserQuestionItem[]): string {
  const lines = ['需要你回答：'];
  for (const { question, choices } of layoutQuestions(questions)) {
    const heading = question.header !== undefined && question.header.length > 0 ? `【${question.header}】` : '';
    lines.push(`${heading}${question.question}`);
    if (question.detail !== undefined && question.detail.length > 0) lines.push(`  ${question.detail}`);
    for (const choice of choices) {
      lines.push(`  ${choice.number}. ${choice.label}${optionHint(question, choice.number)}`);
    }
    lines.push(choices.length === 0
      ? '  （直接回复文字即可）'
      : `  回复 /answer ${question.multiSelect === true ? '1,3' : '1'} 选择，或 /answer 你的文字 作为自由回答。`);
  }
  return lines.join('\n');
}

/** A one-line reminder on the first option of a multi-select question. */
function optionHint(question: AskUserQuestionItem, number: number): string {
  return question.multiSelect === true && number === 1 ? '（可多选，用逗号分隔）' : '';
}

/** An answer the parser accepted, or why it refused. */
export type AnswerParse =
  | { ok: true; answer: AskUserQuestionAnswer }
  | { ok: false; reason: string };

/**
 * Turn one peer's `/answer` text into the kernel's answer batch.
 *
 * The rules, in the order they are applied:
 *
 *  - a batch of ONE question takes the whole line, so `/answer 2` or `/answer 用
 *    postgres` both mean what they look like;
 *  - a batch of SEVERAL questions takes `id=答案` segments (`ui=1,3 db=postgres`),
 *    because free-form prose cannot be attributed to one of them and guessing
 *    would answer the wrong question;
 *  - a number selects that option by POSITION (1-based), which is what the
 *    rendered menu promised;
 *  - anything else is free text (`custom`), and a question with no options has
 *    nothing else it could be.
 *
 * Every refusal names what to do instead: a bare "invalid" leaves the operator
 * staring at a parked run.
 * @param questions - the batch the peer is answering.
 * @param text - the peer's line, verbatim.
 * @returns the batch, or a reason it cannot be used.
 */
export function parseAnswer(questions: readonly AskUserQuestionItem[], text: string): AnswerParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: '回答是空的。' };
  const rendered = layoutQuestions(questions);
  if (rendered.length === 0) return { ok: false, reason: '这个提问已经不在等待了。' };

  const segments = rendered.length === 1
    ? [{ target: rendered[0]!, body: trimmed }]
    : splitSegments(rendered, trimmed);
  if (typeof segments === 'string') return { ok: false, reason: segments };

  const answers: AskUserQuestionAnswerItem[] = [];
  for (const { target, body } of segments) {
    const item = answerOne(target, body);
    if (typeof item === 'string') return { ok: false, reason: item };
    answers.push(item);
  }
  // Unmentioned questions in a batch are SKIPPED rather than invented: the kernel
  // accepts an empty selection, and inventing one would put words in the peer's
  // mouth.
  for (const question of rendered) {
    if (!answers.some((answer) => answer.id === question.question.id)) {
      answers.push({ id: question.question.id, selected: [] });
    }
  }
  return { ok: true, answer: { answers } };
}

/** `id=body id=body`, or a reason the line cannot be read that way. */
function splitSegments(
  rendered: RenderedQuestion[],
  text: string,
): { target: RenderedQuestion; body: string }[] | string {
  const segments: { target: RenderedQuestion; body: string }[] = [];
  // Split on whitespace-introduced `key=` starts, so a free-text answer containing
  // spaces stays whole.
  const parts = text.split(/\s+(?=[A-Za-z0-9_-]+=)/u);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      return `这批有 ${rendered.length} 个问题，请按「编号=回答」逐项回答，例如：`
        + `${rendered.map((_question, index) => `${index + 1}=…`).join(' ')}（也可以直接用问题的 id）。`;
    }
    const key = part.slice(0, eq).trim();
    const body = part.slice(eq + 1).trim();
    const byNumber = /^\d+$/u.test(key) ? rendered[Number(key) - 1] : undefined;
    const found = byNumber ?? rendered.find((q) => q.question.id === key);
    if (found === undefined) {
      return `不认得「${key}」：请用问题编号（1..${rendered.length}）或它的 id。`;
    }
    segments.push({ target: found, body });
  }
  return segments;
}

/** One question's answer: numbers pick options, anything else is free text. */
function answerOne(target: RenderedQuestion, body: string): AskUserQuestionAnswerItem | string {
  const id = target.question.id;
  const trimmed = body.trim();
  if (trimmed.length === 0) return { id, selected: [] };
  if (target.choices.length === 0) {
    // Nothing to pick from: the line IS the answer.
    return { id, selected: [], custom: trimmed.slice(0, MAX_CUSTOM_ANSWER_CHARS) };
  }
  const numbers = /^[\d,，\s]+$/u.test(trimmed)
    ? trimmed.split(/[,，\s]+/u).filter((part) => part.length > 0)
    : undefined;
  if (numbers === undefined) {
    // Prose against a menu: the kernel accepts a free-text answer, and that is
    // what the peer meant.
    return { id, selected: [], custom: trimmed.slice(0, MAX_CUSTOM_ANSWER_CHARS) };
  }
  const selected: string[] = [];
  for (const raw of numbers) {
    const index = Number(raw) - 1;
    const choice = target.choices[index];
    if (choice === undefined) {
      return `「${raw}」不是这道题的选项（可选 1..${target.choices.length}）。`;
    }
    if (!selected.includes(choice.label)) selected.push(choice.label);
  }
  if (selected.length === 0) return { id, selected: [] };
  if (target.question.multiSelect !== true && selected.length > 1) {
    return `这道题只能选一个（回复 /answer ${numbers[0]}）。`;
  }
  return { id, selected };
}

