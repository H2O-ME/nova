/**
 * The question card's pure decisions and its static markup. No DOM in this lane,
 * so the panel is rendered with `renderToStaticMarkup` and every assertion is
 * about a contract: what a draft means, what the wire answer carries, and which
 * strings are on screen.
 *
 * The invariant this file exists for is the LABEL/VALUE split: the recommendation
 * suffix is stripped for display but the answer carries the option label verbatim
 * — the kernel validates a selected label against the labels the asker offered, so
 * sending the display form would make a legitimate answer fail validation.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  allComplete,
  buildAnswer,
  draftOf,
  firstIncomplete,
  isAnswered,
  isComplete,
  parseRecommendedLabel,
  questionTitle,
  skipQuestion,
  stepQuestion,
  toggleOption,
  withCustom,
} from '../src/question/decisions.js';
import { QuestionPanel } from '../src/question/QuestionPanel.js';
import type { AskUserQuestionItem, ClientFrame, QuestionRequest } from '../src/types.js';

const SINGLE: AskUserQuestionItem = {
  id: 'mode',
  question: '选哪种模式？',
  options: [{ label: '快速' }, { label: '彻底 (Recommended)', description: '慢但更完整' }],
};
const BATCH: AskUserQuestionItem[] = [
  SINGLE,
  { id: 'extra', question: '还有别的吗？', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] },
];

describe('parseRecommendedLabel', () => {
  it('strips the suffix in either language and either parenthesis form', () => {
    expect(parseRecommendedLabel('彻底 (Recommended)')).toEqual({ label: '彻底', recommended: true });
    expect(parseRecommendedLabel('Thorough（推荐）')).toEqual({ label: 'Thorough', recommended: true });
    expect(parseRecommendedLabel('Fast')).toEqual({ label: 'Fast', recommended: false });
    // A label that merely CONTAINS the word is not flagged.
    expect(parseRecommendedLabel('Recommended reading')).toEqual({ label: 'Recommended reading', recommended: false });
  });

  it('never changes the label it is given', () => {
    // The VALUE handed to `toggleOption` stays `option.label`; this function only
    // produces the display form, which is why it returns the original when there
    // is no suffix.
    const raw = '彻底 (Recommended)';
    expect(parseRecommendedLabel(raw).label).not.toBe(raw);
    expect(parseRecommendedLabel(raw).label).toBe('彻底');
  });
});

describe('drafts', () => {
  it('counts a picked option or real text as an answer, and whitespace as none', () => {
    expect(isAnswered(EMPTY_DRAFT)).toBe(false);
    expect(isAnswered({ selected: [], custom: '   ', skipped: false })).toBe(false);
    expect(isAnswered({ selected: ['快速'], custom: '', skipped: false })).toBe(true);
    expect(isAnswered({ selected: [], custom: '别的', skipped: false })).toBe(true);
  });

  it('a skip is settled without being an answer', () => {
    // The distinction is the whole reason `skipped` exists: `isAnswered` decides
    // whether the model hears from the human, `isComplete` decides whether the
    // batch may be submitted. Collapsing them is what made Skip a dead end.
    const skipped = skipQuestion();
    expect(isAnswered(skipped)).toBe(false);
    expect(isComplete(skipped)).toBe(true);
    expect(isComplete(EMPTY_DRAFT)).toBe(false);
  });

  it('replaces on single-select and accumulates on multi-select', () => {
    // Single-select must not accumulate: the kernel refuses a two-label answer
    // for such a question, so building one would produce an answer the wire
    // rejects.
    const one = toggleOption(SINGLE, EMPTY_DRAFT, '快速');
    expect(one.selected).toEqual(['快速']);
    const swapped = toggleOption(SINGLE, one, '彻底 (Recommended)');
    expect(swapped.selected).toEqual(['彻底 (Recommended)']);
    const off = toggleOption(SINGLE, swapped, '彻底 (Recommended)');
    expect(off.selected).toEqual([]);

    const multi = BATCH[1] as AskUserQuestionItem;
    const both = toggleOption(multi, toggleOption(multi, EMPTY_DRAFT, 'a'), 'b');
    expect(both.selected).toEqual(['a', 'b']);
  });

  it('picking an option clears a skip, and text and options are mutually exclusive', () => {
    const skipped = toggleOption(SINGLE, skipQuestion(), '快速');
    expect(skipped.skipped).toBe(false);
    expect(isAnswered(skipped)).toBe(true);
    // A single-select "Other" REPLACES the option, and picking an option clears
    // the text: sending both would put two contradictory answers in one slot.
    // Without the second direction the card would show one option checked while
    // `buildAnswer` sent the leftover text instead — the UI and the wire would
    // disagree about what the human answered.
    const other = withCustom(SINGLE, toggleOption(SINGLE, EMPTY_DRAFT, '快速'), '别的');
    expect(other.selected).toEqual([]);
    expect(isAnswered(other)).toBe(true);
    const repicked = toggleOption(SINGLE, other, '快速');
    expect(repicked.custom).toBe('');
    expect(repicked.selected).toEqual(['快速']);
    expect(buildAnswer([SINGLE], { mode: repicked }).answers[0]).toEqual({
      id: 'mode',
      selected: ['快速'],
    });
    // Multi-select keeps its checked labels alongside the text.
    const multi = BATCH[1] as AskUserQuestionItem;
    const kept = withCustom(multi, toggleOption(multi, EMPTY_DRAFT, 'a'), '补充');
    expect(kept.selected).toEqual(['a']);
    const untoggled = toggleOption(multi, kept, 'a');
    expect(untoggled.selected).toEqual([]);
    expect(untoggled.custom).toBe('补充');
  });

  it('reports EVERY question, so an unanswered one is stated rather than inferred', () => {
    const drafts = { mode: { selected: ['快速'], custom: '', skipped: false } };
    expect(allComplete(BATCH, drafts)).toBe(false);
    expect(firstIncomplete(BATCH, drafts)).toBe(1);
    expect(buildAnswer(BATCH, drafts)).toEqual({
      answers: [
        { id: 'mode', selected: ['快速'] },
        // No `custom` key at all for the untouched question: an empty string
        // would read as "the user typed nothing", which is not the same fact.
        { id: 'extra', selected: [] },
      ],
    });
  });

  it('a submitted batch is submittable — every question settled is enough', () => {
    // The regression this pins: with the skip unrecorded, `allComplete` stayed
    // false forever and the submit control could never be enabled.
    const drafts = {
      mode: skipQuestion(),
      extra: { selected: ['a'], custom: '', skipped: false },
    };
    expect(allComplete(BATCH, drafts)).toBe(true);
    expect(firstIncomplete(BATCH, drafts)).toBe(-1);
    expect(buildAnswer(BATCH, drafts).answers).toEqual([
      { id: 'mode', selected: [] },
      { id: 'extra', selected: ['a'] },
    ]);
  });

  it('trims custom text and carries it only when non-empty', () => {
    const draft = withCustom(SINGLE, EMPTY_DRAFT, '  我的答案  ');
    expect(buildAnswer([SINGLE], { mode: draft }).answers[0]).toEqual({
      id: 'mode',
      selected: [],
      custom: '我的答案',
    });
    expect(buildAnswer([SINGLE], { mode: { selected: ['快速'], custom: '  ', skipped: false } }).answers[0]).toEqual({
      id: 'mode',
      selected: ['快速'],
    });
  });
});

describe('pager helpers', () => {
  it('clamps at both ends', () => {
    expect(stepQuestion(0, -1, 3)).toBe(0);
    expect(stepQuestion(2, 1, 3)).toBe(2);
    expect(stepQuestion(1, 1, 3)).toBe(2);
    expect(stepQuestion(0, 1, 0)).toBe(0);
  });

  it('names the question that stopped a submit, or -1 when none did', () => {
    expect(firstIncomplete(BATCH, {})).toBe(0);
    expect(firstIncomplete(BATCH, { mode: skipQuestion() })).toBe(1);
    expect(firstIncomplete(BATCH, {
      mode: { selected: ['快速'], custom: '', skipped: false },
      extra: skipQuestion(),
    })).toBe(-1);
  });

  it('uses the question\'s own header, else an ordinal, else a single-question label', () => {
    expect(questionTitle({ ...SINGLE, header: '确认' }, 0, 2)).toBe('确认');
    expect(questionTitle(SINGLE, 0, 2)).toBe('问题 1 / 2');
    expect(questionTitle(SINGLE, 0, 1)).toBe('需要确认');
  });
});

describe('QuestionPanel', () => {
  const request: QuestionRequest = { id: 'qst_1', questions: BATCH };
  const sent: ClientFrame[] = [];
  const draw = (over: Partial<QuestionRequest> = {}, connected = true): string =>
    renderToStaticMarkup(createElement(QuestionPanel, {
      request: { ...request, ...over },
      send: (f: ClientFrame) => { sent.push(f); },
      connected,
    }));

  it('renders the title, the option labels and the recommendation badge', () => {
    const html = draw();
    // The question ITSELF is the card title (the reference's h2), so the dialog
    // name and the heading say the same thing.
    expect(html).toContain('<h2');
    expect(html).toContain('选哪种模式？');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="等待回答：选哪种模式？"');
    // The footer pager states where in the batch we are.
    expect(html).toContain('1 / 2');
    // The badge is display-only; the option still shows its stripped label.
    expect(html).toContain('彻底');
    expect(html).toContain('推荐');
    expect(html).not.toContain('(Recommended)');
    expect(html).toContain('放弃整组问题');
  });

  it('titles a single-question batch with the question itself', () => {
    const html = draw({ questions: [SINGLE] });
    expect(html).toContain('aria-label="等待回答：选哪种模式？"');
    // A single question has no pager progress to show.
    expect(html).not.toContain('1 / 1');
  });

  it('renders the collapse control open and the body visible by default', () => {
    const html = draw();
    // The header's promote/collapse button starts EXPANDED, so the body and the
    // footer actions (skip / submit) are rendered. Collapsing is click-only, which
    // the static lane cannot drive; what it can pin is the starting state.
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('title="折叠"');
    expect(html).toContain('aria-label="放弃整组问题"');
    // Body + footer are present while open (not folded to the header strip).
    expect(html).toContain('role="group"');
    expect(html).toContain('>跳过<');
  });

  it('renders a supplied detail as MARKDOWN, not as a preformatted blob', () => {
    // A plan under review arrives as structure; the reference feeds it through
    // its markdown renderer, so `<pre>` would show the source instead of the
    // plan. The compact variant matches the folded-process typography there.
    const html = draw({ questions: [{ ...SINGLE, detail: '# 计划\n\n- 第一步' }] });
    expect(html).not.toContain('<pre');
    expect(html).toContain('data-markdown-variant="compact"');
    expect(html).toContain('第一步');
    expect(html).toContain('<li>');
  });

  it('states the widget role of the option list, not just "button"', () => {
    // A single-select is a radiogroup and a multi-select a checkbox group; a
    // screen reader announcing "button" for each option hides which kind of
    // choice is being made and whether more than one is allowed.
    const single = draw();
    expect(single).toContain('role="radiogroup"');
    expect(single).toContain('role="radio"');
    expect(single).toContain('aria-checked="false"');
    expect(single).not.toContain('role="checkbox"');

    const multi = draw({ questions: [BATCH[1] as AskUserQuestionItem] });
    expect(multi).toContain('role="group"');
    expect(multi).toContain('role="checkbox"');
  });

  it('gates the pager: prev is disabled on the first question', () => {
    const html = draw();
    // The pager's prev/next are icon-only buttons labeled by aria-label; the
    // skip/submit actions are text buttons. Read the open tag by its label so a
    // loose walk across the whole document (which also has the close icon) does
    // not grab the wrong element.
    const openTag = (label: string): string => {
      const at = html.indexOf(label);
      const open = html.lastIndexOf('<button', at);
      return html.slice(open, html.indexOf('>', open) + 1);
    };
    // First question: 上一题 goes nowhere. 跳过 is a text button and is enabled.
    expect(openTag('aria-label="上一题"')).toContain('disabled');
    expect(openTag('>跳过<')).not.toContain('disabled');
  });

  it('disables the primary action until this question is answered', () => {
    const html = draw();
    // Nothing drafted: the submit/next control is inert, so an empty answer
    // cannot leave the card.
    expect(html).toMatch(/disabled=""[^>]*>[^<]*(?:下一题|提交)/);
  });

  it('marks the composer read-only when the socket is closed', () => {
    const html = draw({}, false);
    expect(html).not.toContain('disabled=""\n');
    // The custom field is disabled: an answer that cannot be sent must not look
    // submittable.
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it('declares a design box on every inline svg', () => {
    // The repo-wide style guard also checks this; asserting it here keeps the
    // failure next to the component that introduces the icon.
    const html = draw();
    for (const tag of html.match(/<svg[^>]*>/g) ?? []) {
      expect(tag).toMatch(/width="?\d/);
      expect(tag).toMatch(/height="?\d/);
    }
  });
});

describe('a question id is model output, so the drafts lookup is guarded', () => {
  // The regression this pins: `drafts[id] ?? EMPTY_DRAFT` returned an INHERITED
  // member for an id the model chose, so the `??` fallback was never taken and
  // the caller got a function where a draft was promised. `isComplete` then threw
  // `Cannot read properties of undefined (reading 'length')` and the whole card
  // crashed. Ids are only length-bounded upstream (`parseQuestions`), so
  // `constructor` / `toString` / `__proto__` are all reachable from one tool call.
  const HOSTILE_IDS = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'] as const;

  it('falls back to an untouched draft for every inherited member name', () => {
    const drafts: Record<string, typeof EMPTY_DRAFT> = {};
    for (const id of HOSTILE_IDS) {
      expect(draftOf(drafts, id)).toBe(EMPTY_DRAFT);
      // And the value it hands back is usable, not just non-undefined.
      expect(isAnswered(draftOf(drafts, id))).toBe(false);
      expect(isComplete(draftOf(drafts, id))).toBe(false);
    }
  });

  it('does not throw anywhere a batch is judged, for a hostile id', () => {
    const drafts: Record<string, typeof EMPTY_DRAFT> = {};
    const questions = HOSTILE_IDS.map((id) => ({ id, question: 'pick', options: [{ label: 'a' }] }));
    // Every one of these threw before the fix.
    expect(() => allComplete(questions, drafts)).not.toThrow();
    expect(() => firstIncomplete(questions, drafts)).not.toThrow();
    expect(() => buildAnswer(questions, drafts)).not.toThrow();
    // An unanswered batch is not submittable, and the first question is where the
    // reader is sent — the fallback must behave exactly like a real empty draft.
    expect(allComplete(questions, drafts)).toBe(false);
    expect(firstIncomplete(questions, drafts)).toBe(0);
    // The wire answer echoes the model's own id back verbatim.
    expect(buildAnswer(questions, drafts).answers.map((a) => a.id)).toEqual([...HOSTILE_IDS]);
    expect(buildAnswer(questions, drafts).answers.every((a) => a.selected.length === 0)).toBe(true);
  });

  it('still reads a real draft filed under a hostile id', () => {
    // The guard must not over-reject: once the reader answers that question, the
    // draft is an OWN property and is read like any other.
    const drafts: Record<string, typeof EMPTY_DRAFT> = {};
    drafts['constructor'] = { selected: [], custom: 'my answer', skipped: false };
    expect(draftOf(drafts, 'constructor').custom).toBe('my answer');
    const questions = [{ id: 'constructor', question: 'pick', options: [{ label: 'a' }] }];
    expect(allComplete(questions, drafts)).toBe(true);
    expect(buildAnswer(questions, drafts).answers[0]).toEqual({ id: 'constructor', selected: [], custom: 'my answer' });
  });
});
