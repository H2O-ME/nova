/**
 * The question card: the model's `ask_user_question` batch, on the composer dock
 * beside where the approval card sits.
 *
 * Ported from deepseek-harness `ui-user-questions` (MIT) — the clean header
 * (heading + title over the collapse/close actions), the option list with its
 * number / checkbox leading indicator, the recommendation badge, the
 * option-shaped custom-answer row, and the footer pager (‹ progress › plus
 * skip / submit) — but answered through OUR kernel's protocol: one
 * `resolve_question` frame carrying the whole batch, or one `cancel_question`
 * frame to dismiss it.
 *
 * Two structural notes:
 *  - **The card is a takeover, like the approval card**, for the same reason:
 *    the run is suspended inside the ask, so letting the user compose a prompt
 *    the model cannot read yet would be a lie. It takes `role="dialog"`, focus on
 *    the frame, and no answer key is fired by a stray Enter.
 *  - **Answers are sent whole, once.** The reference pages through the batch
 *    locally and submits at the end; so does this, because a partial batch would
 *    make the model re-ask. `buildAnswer` reports the skipped questions too, so
 *    "unanswered" is stated rather than inferred from an absence.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  PencilIcon,
} from '../icons.js';
import {
  EMPTY_DRAFT,
  buildAnswer,
  draftOf,
  firstIncomplete,
  isAnswered,
  parseRecommendedLabel,
  skipQuestion,
  stepQuestion,
  toggleOption,
  withCustom,
  type QuestionDraft,
} from './decisions.js';
import { AnswerField } from './answer-field.js';
import { COMPOSING_GRACE_MS, composing } from '../composer-keys.js';
import { MarkdownText } from '../chat/markdown/MarkdownText.js';
import type { ClientFrame, QuestionRequest } from '../types.js';
import css from './QuestionPanel.module.css';

/**
 * The card's copy, keyed by the reference's own locale keys
 * (`ui-user-questions/src/client/locales.ts`). Held as one record here because
 * this surface has a single locale — the names are kept so a string can be
 * traced back to the dictionary it came from.
 */
const COPY = {
  'error.incomplete': '请先完成这道问题。',
  'error.unanswered': '请选择一个选项或填写自定义答案。',
  'nav.prev': '上一题',
  'nav.next': '下一题',
  'nav.cancel': '放弃整组问题',
  'nav.minimize': '折叠',
  'nav.maximize': '展开',
  'option.recommended': '推荐',
  'custom.placeholder': '输入你的答案',
  'action.skip': '跳过',
  'submit': '提交',
  'submitting': '正在提交…',
  'dialog.label': '等待回答',
  'dialog.body': '问题详情',
} as const;

/**
 * How long an answered card stays locked before it unlocks itself. The lock
 * normally ends when the card leaves (`question_resolved` clears the request);
 * if that round trip never lands — the socket closed mid-answer — unlocking is
 * better than a dead dialog with no way back.
 */
const ANSWER_UNLOCK_MS = 6000;

/**
 * Render one pending question batch and answer it.
 * @param props.request - the request the kernel published, verbatim.
 * @param props.send - the socket's frame sink.
 * @param props.connected - without a socket an answer cannot land: the card goes read-only.
 * @returns The question card in the composer seat.
 */
export function QuestionPanel({
  request,
  send,
  connected,
}: {
  request: QuestionRequest;
  send: (f: ClientFrame) => void;
  /** Without a socket an answer cannot land: the card goes read-only. */
  connected: boolean;
}): JSX.Element {
  const questions = request.questions;
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [answered, setAnswered] = useState(false);
  // Collapsed to the header strip so the conversation above stays readable
  // while the user decides; the drafts live in the session store above.
  const [minimized, setMinimized] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const composingUntilRef = useRef(0);
  const locked = answered || !connected;

  const current = questions[index];
  const draft = current === undefined ? EMPTY_DRAFT : draftOf(drafts, current.id);
  const last = index >= questions.length - 1;
  /**
   * The reference's two feedback sentences, kept as KEYS rather than as one
   * boolean: they answer different questions, and which one applies is decided by
   * WHICH check failed, not by what the question looks like. "This question is
   * not answered" (the forward control) is `error.unanswered`; "some question in
   * the batch is still open" (the batch submit) is `error.incomplete`.
   */
  const [error, setError] = useState<'unanswered' | 'incomplete' | null>(null);

  useEffect(() => {
    frameRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!answered) return;
    const timer = setTimeout(() => setAnswered(false), ANSWER_UNLOCK_MS);
    return () => clearTimeout(timer);
  }, [answered]);

  if (current === undefined) return <></>;

  /** Replace one question's draft (the only write path into `drafts`). */
  const edit = (next: QuestionDraft): void => {
    setError(null);
    setDrafts((prev) => ({ ...prev, [current.id]: next }));
  };

  /**
   * Pick one option. A single-select choice is a whole answer, so the pager
   * advances on it (the reference does the same) — the user is not made to press
   * Next after saying what they meant. Multi-select stays put, because checking
   * one box is rarely the end of that answer.
   * @param label - the option's VALUE (never the parsed display label).
   */
  const choose = (label: string): void => {
    edit(toggleOption(current, draft, label));
    if (multi || last) return;
    setIndex((at) => stepQuestion(at, 1, questions.length));
  };

  /**
   * Send the whole batch: what the model reads as the answer to its ask.
   * @param from - the drafts to send, when the caller has just computed them
   * (React state has not landed yet, so reading `drafts` would send the previous
   * revision).
   */
  const submit = (from: Readonly<Record<string, QuestionDraft>> = drafts): void => {
    if (locked) return;
    setAnswered(true);
    send({ type: 'resolve_question', id: request.id, answer: buildAnswer(questions, from) });
  };

  /** Dismiss the whole batch: the tool fails with the kernel's cancel text. */
  const cancel = (): void => {
    if (locked) return;
    setAnswered(true);
    send({ type: 'cancel_question', id: request.id });
  };

  /**
   * Advance to the next question, or submit on the last one. An unsettled
   * question is refused with the reference's feedback line rather than silently
   * sending a blank answer — a blank answer is a statement, not an omission.
   */
  const forward = (): void => {
    if (locked) return;
    if (!isAnswered(draft)) {
      setError('unanswered');
      return;
    }
    if (last) {
      // An unsettled batch lands the reader on the question that stopped it, so
      // the feedback line names a question instead of a state.
      const at = firstIncomplete(questions, drafts);
      if (at >= 0) {
        setIndex(at);
        setError('incomplete');
        return;
      }
      submit();
      return;
    }
    setError(null);
    setIndex((at) => stepQuestion(at, 1, questions.length));
  };

  /**
   * Dismiss the current question and move on; on the last one, send the batch.
   * The skip is recorded in the draft rather than by advancing alone: without
   * it the question stays unanswered, and an unanswered question is exactly what
   * keeps the batch unsubmittable — a control that cannot do its job.
   */
  const skip = (): void => {
    if (locked) return;
    const next = { ...drafts, [current.id]: skipQuestion() };
    setDrafts(next);
    setError(null);
    // On the last question the batch is sent straight away; anywhere else the
    // pager moves on and the batch is sent from the actual submit control.
    if (!last) {
      setIndex((at) => stepQuestion(at, 1, questions.length));
      return;
    }
    const at = firstIncomplete(questions, next);
    if (at >= 0) {
      setIndex(at);
      return;
    }
    submit(next);
  };

  const route = (event: React.KeyboardEvent): void => {
    const inField = event.target instanceof HTMLTextAreaElement;
    // A composing key belongs to the IME, not to the card.
    if (composing({
      key: event.key,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      keyCode: event.keyCode,
      isComposing: event.nativeEvent.isComposing,
      recentlyComposing: Date.now() < composingUntilRef.current,
    })) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    // Arrows page the batch, but not out of a text field: there they move the
    // caret, which is what a reader typing an answer expects.
    if (!inField && questions.length > 1 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      setIndex((at) => stepQuestion(at, event.key === 'ArrowLeft' ? -1 : 1, questions.length));
    }
  };

  const options = current.options ?? [];
  const hasOptions = options.length > 0;
  const multi = current.multiSelect === true;
  // The reference renders the question itself as the card title; the optional
  // `header` rides above it as an eyebrow so the batch reads as a document.
  const title = current.question;
  // Rendered from the key the failed check stored, so the sentence matches the
  // reason the control refused.
  const feedback = error === null ? '' : COPY[`error.${error}`];

  return (
    <div className={css.root} data-question-key={request.id}>
      <div
        className={`${css.card} ${minimized ? css.cardMinimized : ''}`}
        ref={frameRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={`${COPY['dialog.label']}：${title}`}
        onKeyDown={route}
      >
        <header className={css.header}>
          <div className={css.headingBlock}>
            {current.header !== undefined && current.header.length > 0 && (
              <div className={css.eyebrow}>{current.header}</div>
            )}
            <h2 className={css.title}>{title}</h2>
          </div>
          <div className={css.headerActions}>
            <button
              type="button"
              className={css.iconButton}
              title={minimized ? COPY['nav.maximize'] : COPY['nav.minimize']}
              aria-label={minimized ? COPY['nav.maximize'] : COPY['nav.minimize']}
              aria-expanded={!minimized}
              disabled={locked}
              onClick={() => { setMinimized((at) => !at); }}
            >
              {minimized ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </button>
            <button
              type="button"
              className={css.iconButton}
              title={COPY['nav.cancel']}
              aria-label={COPY['nav.cancel']}
              disabled={locked}
              onClick={cancel}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        {!minimized && (
          <>
            <div className={css.body} tabIndex={0} role="group" aria-label={COPY['dialog.body']}>
              {current.detail !== undefined && current.detail.length > 0 && (
                /* Markdown, like the reference: a plan under review arrives as
                   structure (headings, lists), and a `<pre>` renders it as source. */
                <div className={css.detail}><MarkdownText text={current.detail} variant="compact" /></div>
              )}
              {/* One option list, two widget roles: a multi-select is a checkbox
                 group, a single-select is a radiogroup. The reference states the
                 role on the container AND on each button, which is what makes a
                 screen reader announce "radio, 2 of 3" instead of "button". */}
              <div className={css.options} role={multi ? 'group' : 'radiogroup'}>
                {hasOptions && options.map((option, optionIndex) => {
                  const parsed = parseRecommendedLabel(option.label);
                  const checked = draft.selected.includes(option.label);
                  return (
                    <button
                      type="button"
                      key={option.label}
                      className={`${css.option} ${checked && !multi ? css.optionSelected : ''}`}
                      /* The parsed label is DISPLAY only: the value sent back is
                         `option.label` verbatim, which is what the kernel
                         validates against the options it was asked to offer. */
                      role={multi ? 'checkbox' : 'radio'}
                      aria-checked={checked}
                      aria-label={parsed.label}
                      data-checked={checked}
                      data-multi={multi}
                      disabled={locked}
                      onClick={() => { choose(option.label); }}
                    >
                      {multi
                        ? (
                          <span className={`${css.checkbox} ${checked ? css.checkboxChecked : ''}`} aria-hidden="true">
                            {checked && <CheckIcon />}
                          </span>
                        )
                        : <span className={css.number} aria-hidden="true">{optionIndex + 1}</span>}
                      <span className={css.optionCopy}>
                        <span className={css.optionLine}>
                          <span className={css.optionLabel}>{parsed.label}</span>
                          {parsed.recommended && <span className={css.badge}>{COPY['option.recommended']}</span>}
                          {option.description !== undefined && (
                            <span className={css.description}>{option.description}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}

                {hasOptions
                  ? (
                    /* The custom-answer row is ANOTHER option-shaped row, so it
                       lines up with the choices it belongs to. Its leading
                       indicator mirrors what a typed answer does to the draft. */
                    <div className={`${css.customRow} ${draft.custom !== '' ? css.customRowActive : ''}`}>
                      {multi
                        ? (
                          <span className={`${css.checkbox} ${draft.custom !== '' ? css.checkboxChecked : ''}`} aria-hidden="true">
                            {draft.custom !== '' && <CheckIcon />}
                          </span>
                        )
                        : <span className={css.number} aria-hidden="true"><PencilIcon /></span>}
                      <AnswerField
                        variant="inline"
                        value={draft.custom}
                        disabled={locked}
                        placeholder={COPY['custom.placeholder']}
                        onChange={(event) => { edit(withCustom(current, draft, event.target.value)); }}
                        onCompositionStart={() => { composingUntilRef.current = 0; }}
                        onCompositionEnd={() => { composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS; }}
                        onKeyDown={(event) => {
                          // Enter submits the field (Shift+Enter breaks the line) —
                          // the composer's own contract, so the gesture means one thing.
                          if (event.key !== 'Enter' || event.shiftKey) return;
                          if (composing({
                            key: event.key,
                            shiftKey: event.shiftKey,
                            repeat: event.repeat,
                            keyCode: event.keyCode,
                            isComposing: event.nativeEvent.isComposing,
                            recentlyComposing: Date.now() < composingUntilRef.current,
                          })) return;
                          event.preventDefault();
                          forward();
                        }}
                      />
                    </div>
                  )
                  : (
                    /* An optionless question is answered by its text alone, so the
                       free-form answer is the whole body — it carries its own frame. */
                    <AnswerField
                      variant="block"
                      value={draft.custom}
                      disabled={locked}
                      placeholder={COPY['custom.placeholder']}
                      onChange={(event) => { edit(withCustom(current, draft, event.target.value)); }}
                      onCompositionStart={() => { composingUntilRef.current = 0; }}
                      onCompositionEnd={() => { composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS; }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.shiftKey) return;
                        if (composing({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          repeat: event.repeat,
                          keyCode: event.keyCode,
                          isComposing: event.nativeEvent.isComposing,
                          recentlyComposing: Date.now() < composingUntilRef.current,
                        })) return;
                        event.preventDefault();
                        forward();
                      }}
                    />
                  )}
              </div>
            </div>

            <footer className={css.footer}>
              <div className={css.pager}>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={COPY['nav.prev']}
                  disabled={locked || index === 0}
                  onClick={() => { setError(null); setIndex((at) => stepQuestion(at, -1, questions.length)); }}
                >
                  <ChevronLeftIcon />
                </button>
                {questions.length > 1 && (
                  <span className={css.progress}>{`${index + 1} / ${questions.length}`}</span>
                )}
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={COPY['nav.next']}
                  disabled={locked || last}
                  onClick={() => { setError(null); setIndex((at) => stepQuestion(at, 1, questions.length)); }}
                >
                  <ChevronRightIcon />
                </button>
              </div>
              <div className={css.feedback} role="status">{feedback}</div>
              <div className={css.footerActions}>
                <button
                  type="button"
                  className={`${css.button} ${css.outline}`}
                  disabled={locked}
                  onClick={skip}
                >
                  {COPY['action.skip']}
                </button>
                <button
                  type="button"
                  className={`${css.button} ${css.primary}`}
                  /* The reference gates this on the CURRENT question only; the batch is
                     checked on submit, which also reveals where it stopped. Requiring
                     every question here would disable the button with no way to learn
                     which one is missing. */
                  disabled={locked || !isAnswered(draft)}
                  onClick={forward}
                >
                  {last ? (answered ? COPY['submitting'] : COPY.submit) : COPY['nav.next']}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
