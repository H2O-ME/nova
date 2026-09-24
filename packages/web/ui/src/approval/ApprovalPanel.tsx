/**
 * The approval card: deepseek-harness `ui-approval` ApprovalPanel, ported value
 * for value (the warn strip, the 20px card and its scroll body, the action row
 * whose reject button turns danger on hover) and then answered through OUR
 * kernel's protocol: three verdicts (`allow` / `deny` / `always`), a denial that
 * may carry the user's reason, and an "always" grant that may be pinned to a
 * word prefix of the command — all sent as one `resolve_approval` frame.
 *
 * The reference has two answers where our engine has three, so the action row
 * keeps the reference's order (reject on the left of the affirmative) and gains
 * the quiet "always" capsule between them, next to the scope chooser it needs.
 * The scope chooser is the reference's own pager idiom (24px icon buttons
 * around a value) applied to `ApprovalRequest.scopeWords`; the reason field is
 * `ui-user-questions`'s auto-growing answer field, seated where our card has
 * always had it.
 *
 * It is a real dialog, not a card that looks like one: `role="dialog"` with an
 * accessible name, focus moved to the frame on arrival, a focusable scroll
 * region for long previews (`role="group"`, the reference's own contract), and
 * the REPL key contract (y / a / n) wired to actual keystrokes rather than
 * printed as decoration. One request at a time — the permission engine
 * serializes asks.
 *
 * The dialog never auto-focuses an answer OR the reason field: focus lands on
 * the frame, so a stray Enter (typed at the composer a moment ago) grants
 * nothing and `y` / `a` / `n` are keys from the first keystroke — a caret
 * parked in the reason field would make them letters. Every key decision is
 * `decisions.ts` (pure, directly tested); this file owns the DOM and the
 * `answered` lock.
 */
import { useEffect, useRef, useState } from 'react';
import { PreviewBlock } from './PreviewBlock.js';
import { ReasonInput } from './ReasonInput.js';
import { alwaysAnswer, approvalKey, denyAnswer, scopeLimit, stepScope } from './decisions.js';
import { toolCardModel } from '../card-view.js';
import { COMPOSING_GRACE_MS, composing } from '../composer-keys.js';
import { scopedGrant } from '../format.js';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons.js';
import { hasPreview } from './preview-model.js';
import type { ApprovalRequest, AskResult, ClientFrame } from '../types.js';
import css from './ApprovalPanel.module.css';

/** Permission kinds in the surface's own words (never the wire's vocabulary). */
const KIND_LABELS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

/**
 * How long an answered card stays locked before it unlocks itself. The lock
 * normally ends when the card leaves (`approval_resolved` clears the request);
 * if that round trip never lands — the socket closed mid-answer — unlocking is
 * better than a dead dialog with no way back.
 */
const ANSWER_UNLOCK_MS = 6000;

/**
 * Render the pending approval and answer it.
 * @param props.request - the request the kernel published, verbatim.
 * @param props.send - the socket's frame sink.
 * @param props.connected - without a socket an answer cannot land: the card goes read-only.
 * @returns The approval card in the composer seat.
 */
export function ApprovalPanel({
  request,
  send,
  connected,
}: {
  request: ApprovalRequest;
  send: (f: ClientFrame) => void;
  /** Without a socket an answer cannot land: the card goes read-only. */
  connected: boolean;
}): JSX.Element {
  const words = request.scopeWords;
  const limit = scopeLimit(words);
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState(1);
  const [answered, setAnswered] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // Composition watch: true while composing and for a beat after
  // `compositionend` (Safari closes the composition with a later keydown), so
  // the Enter that picks an IME candidate never sends the denial.
  const composingUntilRef = useRef(0);
  const locked = answered || !connected;

  // Focus the frame (never a button — see the header note).
  useEffect(() => {
    frameRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!answered) return;
    const timer = setTimeout(() => setAnswered(false), ANSWER_UNLOCK_MS);
    return () => clearTimeout(timer);
  }, [answered]);

  // The frame carries a kernel `AskResult` verbatim: a bare verdict, a grant
  // pinned to the first N words, or a denial the model reads as an instruction.
  const answer = (value: AskResult): void => {
    if (locked) return;
    setAnswered(true);
    send({ type: 'resolve_approval', id: request.id, answer: value });
  };

  // Every key the card owns is decided in one place, on the card itself: the
  // reason field's own keydowns bubble here with their target intact, and the
  // `inField` flag they carry is the whole difference between prose and an
  // answer (`n` is a letter in a sentence and a denial everywhere else).
  const route = (event: React.KeyboardEvent): void => {
    const inField = event.target instanceof HTMLTextAreaElement;
    if (inField && composing({
      key: event.key,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      keyCode: event.keyCode,
      isComposing: event.nativeEvent.isComposing,
      recentlyComposing: Date.now() < composingUntilRef.current,
    })) return;
    const action = approvalKey({ key: event.key, shiftKey: event.shiftKey, inField, words, scope, reason });
    if (action.kind === 'none') return;
    // Every other branch is ours: the arrows would scroll the body, the letters
    // would type into nothing, and Enter would re-fire the focused control.
    event.preventDefault();
    if (action.kind === 'scope') setScope(action.scope);
    else if (action.kind === 'clear-reason') setReason('');
    else answer(action.answer);
  };

  // The same model the transcript row uses, so the card names the call the way
  // the row that asked for it does ("运行 git status", not the tool's id).
  const headline = toolCardModel({
    name: request.call.name,
    args: request.call.rawArgs,
    view: request.view ?? { card: 'generic', kind: 'other', title: request.call.name },
    result: undefined,
    idle: false,
  }).headline;

  return (
    <div className={css.root} data-approval-key={request.id}>
      <div
        className={css.card}
        ref={frameRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={`等待审批：${headline}`}
        onKeyDown={route}
      >
        <ApprovalDetail
          preview={request.preview}
          args={request.call.rawArgs}
          toolName={request.call.name}
          kindLabel={KIND_LABELS[request.kind] ?? request.kind}
          headline={headline}
          words={words}
          scope={scope}
          limit={limit}
          locked={locked}
          onScope={setScope}
        />
        <ApprovalActions
          words={words}
          scope={scope}
          reason={reason}
          locked={locked}
          onReason={setReason}
          onAnswer={answer}
          onCompositionStart={() => { composingUntilRef.current = 0; }}
          onCompositionEnd={() => { composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS; }}
        />
      </div>
    </div>
  );
}

/** The warn strip and the scroll body: what is being asked, and for what. */
function ApprovalDetail({
  preview,
  args,
  toolName,
  kindLabel,
  headline,
  words,
  scope,
  limit,
  locked,
  onScope,
}: {
  preview: readonly string[] | undefined;
  args: string;
  /** The raw tool name, for the kind chip's tooltip (the headline is prose). */
  toolName: string;
  kindLabel: string;
  headline: string;
  words: readonly string[] | undefined;
  scope: number;
  limit: number;
  /** Answering is closed: the scope stepper freezes with the rest. */
  locked: boolean;
  onScope: (scope: number) => void;
}): JSX.Element {
  // The raw args, single-lined: rawArgs is a JSON blob, and the fallback body
  // is a "what is being asked" line, not a pretty-printed document.
  const flatArgs = args.replace(/\s+/g, ' ').trim();
  return (
    <>
      <div className={css.strip}>
        <span className={css.dot} />
        等待审批
        <span className={css.badge} title={toolName}>{kindLabel}</span>
      </div>
      <div
        className={css.body}
        data-approval-scroll=""
        tabIndex={0}
        role="group"
        aria-label="审批详情"
      >
        <div className={css.headline}>{headline}</div>
        {hasPreview(preview)
          ? <PreviewBlock preview={preview} />
          : flatArgs !== '' && <div className={css.command}>{flatArgs}</div>}
        {limit > 0 && (
          <div className={css.scope}>
            <span className={css.scopeLabel}>总是允许范围</span>
            <button
              type="button"
              className={css.iconButton}
              aria-label="缩小授权范围"
              disabled={locked || scope <= 1}
              onClick={() => onScope(stepScope(scope, limit, -1))}
            >
              <ChevronLeftIcon />
            </button>
            <code className={css.progress}>{scopedGrant(words ?? [], scope)}</code>
            <button
              type="button"
              className={css.iconButton}
              aria-label="扩大授权范围"
              disabled={locked || scope >= limit}
              onClick={() => onScope(stepScope(scope, limit, 1))}
            >
              <ChevronRightIcon />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** The reason field and the three verdicts, in the reference's order. */
function ApprovalActions({
  words,
  scope,
  reason,
  locked,
  onReason,
  onAnswer,
  onCompositionStart,
  onCompositionEnd,
}: {
  words: readonly string[] | undefined;
  scope: number;
  reason: string;
  locked: boolean;
  onReason: (reason: string) => void;
  onAnswer: (answer: AskResult) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}): JSX.Element {
  const scoped = scopeLimit(words) > 0;
  return (
    <div className={css.actionRow}>
      <ReasonInput
        value={reason}
        disabled={locked}
        onChange={onReason}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
      <button
        type="button"
        className={`${css.button} ${css.outline} ${css.reject}`}
        title="拒绝本次调用，理由随结果回给模型"
        disabled={locked}
        onClick={() => onAnswer(denyAnswer(reason))}
      >
        拒绝 <kbd className={css.kbd} aria-hidden="true">n</kbd>
      </button>
      <button
        type="button"
        className={`${css.button} ${css.ghost}`}
        title={scoped ? `总是允许，记住「${scopedGrant(words ?? [], scope)}」` : '总是允许，记住该命令'}
        disabled={locked}
        onClick={() => onAnswer(alwaysAnswer(words, scope))}
      >
        总是允许 <kbd className={css.kbd} aria-hidden="true">a</kbd>
      </button>
      <button
        type="button"
        className={`${css.button} ${css.primary}`}
        title="只允许本次调用"
        disabled={locked}
        onClick={() => onAnswer('allow')}
      >
        允许一次 <kbd className={css.kbd} aria-hidden="true">y</kbd>
      </button>
    </div>
  );
}