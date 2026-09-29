/**
 * Turning a typed terminal line into a kernel answer — for both kinds of ask.
 *
 * Extracted from `repl.ts` because it is one responsibility (line → answer) with
 * two shapes, and because the REPL's event/render machinery is a different reader
 * with a different failure mode: a bad parser here means the model reads a verdict
 * or an answer the human did not give, which is why both functions are pure and
 * directly tested.
 *
 * Both are deliberately permissive about FORM and strict about MEANING: the
 * interactive lane is a person at a keyboard, so an unrecognized line resolves to
 * the safe end (a denial, an empty answer) rather than throwing — and for
 * approvals that resolution is `deny`, matching the kernel's own fail-closed bias.
 */
import type { AskResult, AskUserQuestionAnswer, AskUserQuestionItem } from '@nova-agent/core';

/** 终端着色端口（`lines.ts` 的 `Paint` 的一个子集，避免这里依赖整个呈现层）。 */
export interface AnswerPaint {
  cyan(text: string): string;
  dim(text: string): string;
  yellow(text: string): string;
}

/**
 * 行内审批答案解析：y/a 前缀=允许/总是，否定词（n/no/nope/nah）后跟的整句作为拒绝
 * 理由回流给模型（与 WebUI 同一 AskResult 形态）；其余输入一律 fail-closed 拒绝。
 */
export function parseApprovalAnswer(raw: string): AskResult {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith('a')) return 'always';
  if (lower.startsWith('y')) return 'allow';
  const tokens = text.split(/\s+/);
  const head = (tokens[0] ?? '').toLowerCase();
  if (head === 'n' || head === 'no' || head === 'nope' || head === 'nah') {
    const reason = tokens.slice(1).join(' ').trim();
    return reason.length > 0 ? { answer: 'deny', reason } : 'deny';
  }
  return 'deny';
}

/**
 * 行内问题答案解析：把一行文本按当前问题转成内核的答案项。
 *
 * 三种输入，按优先级：
 *  1. 空行 = 跳过这题（`selected: []`，无 custom）——用户明确表示不答，模型从
 *     「这一题的 selected 为空」就能看出，不需要猜；
 *  2. 与该题任一选项标签（或其在列表里的序号）匹配 = 选中它。多选时用逗号分隔；
 *  3. 其余整行 = 自定义答案。
 *
 * 序号是必要的：终端里敲一整个中文选项标签很痛苦，而 `1` 在屏幕上是明确的。
 * 匹配**先按标签精确匹配再按序号**——一个选项的标签恰好是 "1" 时，标签优先，
 * 屏幕上的字面量永远胜过位置。
 * @param question - 正在回答的题目（提供选项与多选标志）。
 * @param raw - 用户敲的那一行。
 * @returns 该题的内核答案项。
 */
export function parseQuestionAnswer(
  question: AskUserQuestionItem,
  raw: string,
): AskUserQuestionAnswer['answers'][number] {
  const text = raw.trim();
  const options = question.options ?? [];
  if (text.length === 0) return { id: question.id, selected: [] };
  const labels = options.map((option) => option.label);
  const parts = text.split(/[,，]/).map((part) => part.trim()).filter((part) => part.length > 0);
  // Multi-select reads a comma-separated list; single-select reads the whole line
  // as one token so a custom answer containing a comma is not split in half.
  const tokens = question.multiSelect === true ? parts : [text];
  const picked: string[] = [];
  for (const token of tokens) {
    const byLabel = labels.find((label) => label === token);
    if (byLabel !== undefined) {
      picked.push(byLabel);
      continue;
    }
    const index = Number.parseInt(token, 10);
    const byIndex = Number.isInteger(index) && index >= 1 ? labels[index - 1] : undefined;
    if (byIndex !== undefined) picked.push(byIndex);
  }
  return picked.length > 0
    ? { id: question.id, selected: picked }
    : { id: question.id, selected: [], custom: text };
}

/**
 * 把一个问题批次画成终端能读的一屏。
 *
 * 整批一次印出而不是逐题刷新：终端没有 composer 座去「翻页」，而滚回去看上一题
 * 的成本很高。每条选项前的序号就是答题时要敲的东西（与
 * {@link parseQuestionAnswer} 的序号识别成对）。
 * @param paint - 终端着色端口。
 * @param questions - 内核发来的批次。
 * @param at - 当前正在回答的题号（0 起），用来标出焦点。
 */
export function questionBatchLines(
  paint: AnswerPaint,
  questions: readonly AskUserQuestionItem[],
  at: number,
): string[] {
  const out: string[] = [paint.yellow(`  模型需要你确认${questions.length > 1 ? `（共 ${questions.length} 题）` : ''}`)];
  questions.forEach((question, index) => {
    const marker = index === at ? paint.cyan('›') : ' ';
    const ordinal = questions.length > 1 ? `${String(index + 1)}. ` : '';
    out.push(`  ${marker} ${ordinal}${question.question}${question.multiSelect === true ? paint.dim('（可多选，逗号分隔）') : ''}`);
    for (const [optionIndex, option] of (question.options ?? []).entries()) {
      const suffix = option.description !== undefined ? paint.dim(` — ${option.description}`) : '';
      out.push(`      ${String(optionIndex + 1)}) ${option.label}${suffix}`);
    }
    if ((question.options ?? []).length === 0) out.push(paint.dim('      （直接输入你的答案）'));
  });
  out.push(paint.dim('  输入序号或选项内容作答，回车跳过；多选首题可一次敲多个序号'));
  return out;
}

/**
 * 组装一整批答案并交给内核。每个问题都必须出现在答案里（含被跳过的），这样模型
 * 看到的是「哪几题没答」，而不是要从不出现的 id 去推断。
 * @param questions - 批次。
 * @param answers - 已答的题（id → 答案项）。
 * @returns 内核形态的整批答案。
 */
export function assembleAnswers(
  questions: readonly AskUserQuestionItem[],
  answers: readonly AskUserQuestionAnswer['answers'][number][],
): AskUserQuestionAnswer {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  return {
    answers: questions.map((question) => byId.get(question.id) ?? { id: question.id, selected: [] }),
  };
}
