/**
 * The key chain (M11 批4d): one pure function from (state, key) to (state,
 * action). The shell owns the terminal, the clock and the side effects; this
 * file owns *what a key means* — which is the part worth testing, and the part
 * that used to be scattered across every component of the old TUI.
 *
 * The order is a responsibility chain, not a switch:
 *
 *   1. **An approval owns the keyboard while it is pending.** Every key is
 *      either an option, a scope nudge, a keystroke in the denial reason, or
 *      ignored — nothing else may run while the run is blocked on a human.
 *   2. **A panel owns it while one is open** (the command palette, a list).
 *   3. **Global keys**: exit, abort, scroll, click-to-expand, mode cycling.
 *   4. **The composer**, which is where everything else goes.
 *
 * Actions are described, not performed: `{kind:'submit'}` says "this text was
 * submitted", and the shell decides whether that is a prompt, a slash command
 * or a skill invocation. So this reducer can be driven by a fake clock and a
 * list of keys in a test, with no terminal anywhere.
 */
import type { AskResult, ApprovalRequest, AskUserQuestionAnswer, QuestionRequest } from '@nova-agent/core';
import type { Key } from '@nova-agent/tui';
import {
  backspace,
  createComposer,
  deleteForward,
  deleteWord,
  insert,
  isEmpty,
  move,
  paste,
  submitText,
  type Composer,
} from './composer.js';
import { APPROVAL_OPTIONS, approvalScopeOf, type ApprovalScope } from './panels.js';
import { questionKey } from './question-keys.js';
import type { QuestionState } from './question.js';

/** Rows a wheel notch or a PageUp moves the transcript. */
export const WHEEL_ROWS = 3;
export const PAGE_ROWS = 12;

/** A slash command, as the palette needs it (`name` is what gets submitted). */
export interface CommandSpec {
  name: string;
  usage: string;
  description: string;
}

export interface PanelRow {
  label: string;
  detail?: string | undefined;
}

export interface PanelState {
  kind: 'commands' | 'modal';
  title: string;
  rows: readonly PanelRow[];
  cursor: number;
}

export interface ApprovalState {
  cursor: number;
  denyReason: string;
  /** Words the "always" grant would memorize. */
  scopeWords: number;
}

export interface UiState {
  composer: Composer;
  approval: ApprovalState;
  /** The question batch being answered, or `undefined` when none is up. */
  questions: QuestionState | undefined;
  panel: PanelState | undefined;
  /** Esc closed the palette for this draft; typing '/' again reopens it. */
  paletteDismissed: boolean;
  history: readonly string[];
  /** -1 = editing the live draft, 0 = the newest history entry. */
  historyIndex: number;
  /** The draft set aside while browsing history. */
  draftStash: string;
  exitArmed: boolean;
  transient: string | undefined;
}

export function createUiState(): UiState {
  return {
    composer: createComposer(),
    approval: { cursor: 0, denyReason: '', scopeWords: 1 },
    questions: undefined,
    panel: undefined,
    paletteDismissed: false,
    history: [],
    historyIndex: -1,
    draftStash: '',
    exitArmed: false,
    transient: undefined,
  };
}

export type TuiAction =
  | { kind: 'none' }
  | { kind: 'exit' }
  | { kind: 'abort' }
  | { kind: 'cycleMode' }
  | { kind: 'submit'; text: string }
  | { kind: 'resolve'; id: string; answer: AskResult }
  | { kind: 'answerQuestions'; id: string; answers: AskUserQuestionAnswer }
  | { kind: 'cancelQuestions'; id: string }
  | { kind: 'scroll'; delta: number }
  | { kind: 'toggle'; entryId: string }
  | { kind: 'panelSelect'; index: number }
  | { kind: 'panelClose' };

export interface KeyContext {
  /** A run is in flight (Enter queues, Esc aborts). */
  running: boolean;
  /** The outstanding approval, if the run is blocked on the user. */
  pending: ApprovalRequest | undefined;
  /** The outstanding question batch, if the run is blocked on a human. */
  question: QuestionRequest | undefined;
  /** Slash-command source for the palette filter. */
  commands: readonly CommandSpec[];

  /** Tab may cycle the execution mode (idle, before any turn). */
  canSwitchMode: boolean;
  /** Entry ids of the frame on screen, indexed by screen row (`owners` → id). */
  entryAt: (row: number) => string | undefined;
}

export function handleKey(state: UiState, key: Key, ctx: KeyContext): { state: UiState; action: TuiAction } {
  const none: TuiAction = { kind: 'none' };
  if (key.type === 'focusin' || key.type === 'focusout' || key.type === 'mousemove') return { state, action: none };
  // Any key disarms the exit prompt: the arming is a question, and it is
  // answered by the *next* Ctrl+C. So the armed flag is read before this.
  const armed = state.exitArmed;
  const calm: UiState = armed ? { ...state, exitArmed: false, transient: undefined } : state;

  if (ctx.pending !== undefined) return approvalKey(calm, key, ctx.pending);
  // Then a question batch: it blocks the same run, so it takes the keyboard the
  // same way. Below the approval on purpose — the permission gate is the
  // security decision, and it must never be answerable by keystrokes meant for
  // a question card.
  if (ctx.question !== undefined) return questionKey(calm, key, ctx.question);
  // A modal panel owns the keyboard. The command palette does NOT: it is a
  // filter over the draft, so typing must keep reaching the composer — it only
  // claims the keys that mean something to a list (plus Tab, which completes).
  if (calm.panel?.kind === 'modal') return panelKey(calm, key);
  if (calm.panel?.kind === 'commands' && PALETTE_KEYS.has(key.type)) return panelKey(calm, key);

  const global = globalKey(calm, key, ctx, armed);
  return global ?? composerKey(calm, key, ctx);
}

/** Keys that mean the same thing wherever the draft is: exit, abort, scroll, expand, mode. */
function globalKey(state: UiState, key: Key, ctx: KeyContext, armed: boolean): { state: UiState; action: TuiAction } | undefined {
  switch (key.type) {
    case 'ctrl+c':
      return ctrlC(state, ctx, armed);
    case 'esc':
      return { state, action: ctx.running ? { kind: 'abort' } : { kind: 'none' } };
    case 'ctrl+d':
      return { state, action: isEmpty(state.composer) ? { kind: 'exit' } : { kind: 'none' } };
    case 'pageup':
      return { state, action: { kind: 'scroll', delta: PAGE_ROWS } };
    case 'pagedown':
      return { state, action: { kind: 'scroll', delta: -PAGE_ROWS } };
    case 'wheelup':
      return { state, action: { kind: 'scroll', delta: WHEEL_ROWS } };
    case 'wheeldown':
      return { state, action: { kind: 'scroll', delta: -WHEEL_ROWS } };
    case 'click': {
      const id = ctx.entryAt(key.y - 1);
      return { state, action: id === undefined ? { kind: 'none' } : { kind: 'toggle', entryId: id } };
    }
    case 'tab':
    case 'shifttab':
      return { state, action: ctx.canSwitchMode ? { kind: 'cycleMode' } : { kind: 'none' } };
    default:
      return undefined;
  }
}

/**
 * Ctrl+C in three acts: abort a run, clear a draft, then exit on the second
 * press — `armed` is the previous press's flag, and the arming shows as the
 * transient hint so the question is visible while it waits to be answered.
 */
function ctrlC(state: UiState, ctx: KeyContext, armed: boolean): { state: UiState; action: TuiAction } {
  if (ctx.running) return { state, action: { kind: 'abort' } };
  if (!isEmpty(state.composer)) return { state: { ...state, composer: createComposer(), panel: undefined }, action: { kind: 'none' } };
  if (armed) return { state, action: { kind: 'exit' } };
  return { state: { ...state, exitArmed: true, transient: '再按 Ctrl+C 退出' }, action: { kind: 'none' } };
}

// ------------------------------------------------------------------ approvals

function approvalKey(state: UiState, key: Key, pending: ApprovalRequest): { state: UiState; action: TuiAction } {
  const approval = state.approval;
  const scope = approvalScopeOf(pending, approval.scopeWords);
  const last = APPROVAL_OPTIONS.length - 1;
  switch (key.type) {
    case 'up':
      return { state: { ...state, approval: { ...approval, cursor: Math.max(0, approval.cursor - 1) } }, action: { kind: 'none' } };
    case 'down':
      return { state: { ...state, approval: { ...approval, cursor: Math.min(last, approval.cursor + 1) } }, action: { kind: 'none' } };
    case 'left':
    case 'right': {
      if (approval.cursor !== 1 || scope === undefined) return { state, action: { kind: 'none' } };
      const delta = key.type === 'left' ? -1 : 1;
      const count = Math.min(Math.max(1, approval.scopeWords + delta), scope.words.length);
      return { state: { ...state, approval: { ...approval, scopeWords: count } }, action: { kind: 'none' } };
    }
    case 'enter':
      return { state, action: { kind: 'resolve', id: pending.id, answer: answerFor(state, scope) } };
    case 'esc':
      return { state, action: { kind: 'resolve', id: pending.id, answer: 'deny' } };
    case 'backspace':
      return { state: { ...state, approval: { ...approval, denyReason: approval.denyReason.slice(0, -1) } }, action: { kind: 'none' } };
    case 'char':
      // Typing is meaningful on the denial row only: a reason rides back to the
      // model as an instruction, so it must not be reachable by accident.
      return approval.cursor === 2
        ? { state: { ...state, approval: { ...approval, denyReason: approval.denyReason + key.ch } }, action: { kind: 'none' } }
        : { state, action: { kind: 'none' } };
    default:
      return { state, action: { kind: 'none' } };
  }
}

function answerFor(state: UiState, scope: ApprovalScope | undefined): AskResult {
  switch (APPROVAL_OPTIONS[state.approval.cursor]) {
    case 'allow':
      return 'allow';
    case 'always':
      return scope === undefined ? 'always' : { answer: 'always', scopeWords: Math.max(1, state.approval.scopeWords) };
    default: {
      const reason = state.approval.denyReason.trim();
      return reason.length === 0 ? 'deny' : { answer: 'deny', reason };
    }
  }
}


// --------------------------------------------------------------------- panels

/** Keys a command palette claims; everything else still edits the draft. */
const PALETTE_KEYS = new Set<Key['type']>(['up', 'down', 'enter', 'esc', 'tab']);

function panelKey(state: UiState, key: Key): { state: UiState; action: TuiAction } {
  const panel = state.panel!;
  const last = Math.max(0, panel.rows.length - 1);
  switch (key.type) {
    case 'up':
      return { state: { ...state, panel: { ...panel, cursor: Math.max(0, panel.cursor - 1) } }, action: { kind: 'none' } };
    case 'down':
      return { state: { ...state, panel: { ...panel, cursor: Math.min(last, panel.cursor + 1) } }, action: { kind: 'none' } };
    case 'tab': {
      // Tab completes: the draft becomes the command under the cursor, which
      // also closes the palette (an exact command is no longer a prefix).
      const usage = panel.rows[panel.cursor]?.label;
      if (panel.kind !== 'commands' || usage === undefined) return { state, action: { kind: 'none' } };
      return {
        state: { ...state, panel: undefined, composer: { ...createComposer(), text: usage, cursor: usage.length } },
        action: { kind: 'none' },
      };
    }
    case 'enter':
      return panel.rows.length === 0
        ? { state, action: { kind: 'panelClose' } }
        : { state, action: { kind: 'panelSelect', index: panel.cursor } };
    case 'esc':
      return {
        state: { ...state, panel: undefined, paletteDismissed: panel.kind === 'commands' },
        action: panel.kind === 'commands' ? { kind: 'none' } : { kind: 'panelClose' },
      };
    default:
      return { state, action: { kind: 'none' } };
  }
}

// ------------------------------------------------------------------- composer

function composerKey(state: UiState, key: Key, ctx: KeyContext): { state: UiState; action: TuiAction } {
  const composer = state.composer;
  const withComposer = (next: Composer, action: TuiAction = { kind: 'none' }): { state: UiState; action: TuiAction } => ({
    state: { ...state, composer: next, panel: paletteFor(next, state, ctx) },
    action,
  });
  switch (key.type) {
    case 'char':
      return withComposer(insert(composer, key.ch));
    case 'paste':
      return withComposer(paste(composer, key.text));
    case 'newline':
      return withComposer(insert(composer, '\n'));
    case 'enter': {
      const text = submitText(composer).trim();
      if (text.length === 0) return { state, action: { kind: 'none' } };
      const history = [text, ...state.history.filter((entry) => entry !== text)].slice(0, 100);
      return {
        state: {
          ...state,
          composer: createComposer(),
          panel: undefined,
          paletteDismissed: false,
          history,
          historyIndex: -1,
          draftStash: '',
        },
        action: { kind: 'submit', text },
      };
    }
    case 'backspace':
      return withComposer(backspace(composer));
    case 'delete':
      return withComposer(deleteForward(composer));
    case 'ctrl+w':
      return withComposer(deleteWord(composer));
    case 'ctrl+u':
      return withComposer(createComposer());
    case 'left':
      return withComposer(move(composer, 'left'));
    case 'right':
      return withComposer(move(composer, 'right'));
    case 'ctrl+left':
      return withComposer(move(composer, 'wordLeft'));
    case 'ctrl+right':
      return withComposer(move(composer, 'wordRight'));
    case 'home':
      return withComposer(move(composer, 'lineStart'));
    case 'end':
      return withComposer(move(composer, 'lineEnd'));
    case 'up':
      return history(composer, state, 1);
    case 'down':
      return history(composer, state, -1);
    default:
      return { state, action: { kind: 'none' } };
  }
}

/**
 * Up/Down recall history, shell-style: the live draft is set aside on the way
 * in and restored on the way back out, so browsing never costs what you typed.
 */
function history(composer: Composer, state: UiState, delta: number): { state: UiState; action: TuiAction } {
  if (state.history.length === 0) return { state, action: { kind: 'none' } };
  const index = state.historyIndex;
  const next = index === -1 && delta > 0 ? 0 : index + delta;
  if (next < 0) return { state: { ...state, composer: { ...createComposer(), text: state.draftStash, cursor: state.draftStash.length }, historyIndex: -1 }, action: { kind: 'none' } };
  if (next >= state.history.length) return { state, action: { kind: 'none' } };
  const text = state.history[next]!;
  return {
    state: {
      ...state,
      composer: { ...createComposer(), text, cursor: text.length },
      historyIndex: next,
      draftStash: index === -1 ? composer.text : state.draftStash,
    },
    action: { kind: 'none' },
  };
}

/** The command palette: derived from the draft, never a second source of truth. */
function paletteFor(composer: Composer, state: UiState, ctx: KeyContext): PanelState | undefined {
  if (state.paletteDismissed || ctx.commands.length === 0) return state.panel?.kind === 'modal' ? state.panel : undefined;
  const text = composer.text;
  if (!text.startsWith('/') || text.includes(' ') || text.includes('\n')) {
    return state.panel?.kind === 'modal' ? state.panel : undefined;
  }
  const matches = ctx.commands.filter((spec) => spec.name.startsWith(text));
  if (matches.some((spec) => spec.name === text)) return undefined; // an exact command: let Enter submit it
  if (matches.length === 0) return undefined;
  const rows = matches.map((spec) => ({
    label: spec.name,
    detail: spec.usage === spec.name ? spec.description : `${spec.usage} · ${spec.description}`,
  }));
  const cursor = state.panel?.kind === 'commands' ? Math.min(state.panel.cursor, rows.length - 1) : 0;
  return { kind: 'commands', title: '命令', rows, cursor };
}

export { createComposer };
