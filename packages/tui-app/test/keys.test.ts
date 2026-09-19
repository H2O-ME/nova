/**
 * The key chain's contract: whoever owns the keyboard gets every key, the
 * palette is derived from the draft rather than remembered, and the exit
 * prompt takes two presses. Each of these is a rule that reads as obvious and
 * breaks silently, so they are asserted directly.
 */
import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, ToolCall } from '@nova-agent/core';
import { createUiState, handleKey, type KeyContext, type UiState } from '../src/keys.js';

const COMMANDS = [
  { name: '/help', usage: '/help', description: '命令清单' },
  { name: '/model', usage: '/model', description: '切换模型' },
  { name: '/session', usage: '/session', description: '会话信息' },
];

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  running: false,
  pending: undefined,
  commands: COMMANDS,
  canSwitchMode: false,
  entryAt: () => undefined,
  ...over,
});

function call(command: string): ToolCall {
  return { id: 'c1', name: 'bash', args: { command }, rawArgs: `{"command":"${command}"}` };
}

const pending: ApprovalRequest = { id: 'apr1', call: call('git status --short'), kind: 'execute' };

function type(state: UiState, text: string, context = ctx()): { state: UiState; action: ReturnType<typeof handleKey>['action'] } {
  let current = state;
  let action: ReturnType<typeof handleKey>['action'] = { kind: 'none' };
  for (const ch of text) {
    const result = handleKey(current, { type: 'char', ch }, context);
    current = result.state;
    action = result.action;
  }
  return { state: current, action };
}

describe('an approval owns the keyboard', () => {
  const context = ctx({ pending });

  it('cycles the three options and refuses to leave the ends', () => {
    let state = createUiState();
    state = handleKey(state, { type: 'up' }, context).state;
    expect(state.approval.cursor).toBe(0);
    state = handleKey(state, { type: 'down' }, context).state;
    state = handleKey(state, { type: 'down' }, context).state;
    state = handleKey(state, { type: 'down' }, context).state;
    expect(state.approval.cursor).toBe(2);
  });

  it('narrows the always grant with the arrows, inside the command', () => {
    let state = handleKey(createUiState(), { type: 'down' }, context).state;
    expect(state.approval.cursor).toBe(1);
    state = handleKey(state, { type: 'right' }, context).state;
    expect(state.approval.scopeWords).toBe(2);
    state = handleKey(state, { type: 'right' }, context).state;
    expect(state.approval.scopeWords).toBe(3);
    state = handleKey(state, { type: 'right' }, context).state;
    expect(state.approval.scopeWords).toBe(3); // three words, no further
    state = handleKey(state, { type: 'left' }, context).state;
    state = handleKey(state, { type: 'left' }, context).state;
    state = handleKey(state, { type: 'left' }, context).state;
    expect(state.approval.scopeWords).toBe(1);
  });

  it('answers with the scope it previewed, and with a typed reason', () => {
    let state = handleKey(createUiState(), { type: 'down' }, context).state;
    state = handleKey(state, { type: 'right' }, context).state;
    expect(handleKey(state, { type: 'enter' }, context).action).toEqual({
      kind: 'resolve',
      id: 'apr1',
      answer: { answer: 'always', scopeWords: 2 },
    });

    let deny = createUiState();
    deny = handleKey(deny, { type: 'down' }, context).state;
    deny = handleKey(deny, { type: 'down' }, context).state;
    deny = type(deny, '改用别的分支', context).state;
    expect(handleKey(deny, { type: 'enter' }, context).action).toEqual({
      kind: 'resolve',
      id: 'apr1',
      answer: { answer: 'deny', reason: '改用别的分支' },
    });
  });

  it('ignores typing on the first two rows and Esc always denies', () => {
    const typed = type(createUiState(), 'nope', context).state;
    expect(typed.approval.denyReason).toBe('');
    expect(typed.composer.text).toBe('');
    expect(handleKey(createUiState(), { type: 'esc' }, context).action).toEqual({
      kind: 'resolve',
      id: 'apr1',
      answer: 'deny',
    });
  });

  it('lets nothing else through while it waits', () => {
    const result = handleKey(createUiState(), { type: 'ctrl+c' }, ctx({ pending, running: true }));
    expect(result.action).toEqual({ kind: 'none' });
  });

  it('offers no scope when the command has one word or is compound', () => {
    const single: ApprovalRequest = { ...pending, call: call('ls') };
    const compound: ApprovalRequest = { ...pending, call: call('git status && rm -rf /') };
    for (const request of [single, compound]) {
      let state = handleKey(createUiState(), { type: 'down' }, ctx({ pending: request })).state;
      state = handleKey(state, { type: 'right' }, ctx({ pending: request })).state;
      expect(state.approval.scopeWords).toBe(1);
    }
  });
});

describe('a panel owns the keyboard', () => {
  it('moves, selects and closes', () => {
    let state = type(createUiState(), '/', ctx()).state;
    expect(state.panel?.kind).toBe('commands');
    expect(state.panel?.rows.map((row) => row.label)).toEqual(['/help', '/model', '/session']);
    state = handleKey(state, { type: 'down' }, ctx()).state;
    expect(state.panel?.cursor).toBe(1);
    expect(handleKey(state, { type: 'enter' }, ctx()).action).toEqual({ kind: 'panelSelect', index: 1 });
    const closed = handleKey(state, { type: 'esc' }, ctx()).state;
    expect(closed.panel).toBeUndefined();
    expect(closed.paletteDismissed).toBe(true);
  });

  it('filters as the draft grows and steps aside for an exact command', () => {
    let state = type(createUiState(), '/m', ctx()).state;
    expect(state.panel?.rows.map((row) => row.label)).toEqual(['/model']);
    state = type(state, 'odel', ctx()).state;
    expect(state.panel).toBeUndefined();
    expect(handleKey(state, { type: 'enter' }, ctx()).action).toEqual({ kind: 'submit', text: '/model' });
  });

  it('runs the command under the cursor, not the prefix typed so far', () => {
    const state = type(createUiState(), '/s', ctx()).state;
    expect(state.panel?.rows[0]?.label).toBe('/session');
    // The reducer names the row; the shell is what turns a palette selection
    // into a submitted command.
    expect(handleKey(state, { type: 'enter' }, ctx()).action).toEqual({ kind: 'panelSelect', index: 0 });
  });
});

describe('global keys', () => {
  it('aborts a run on Esc or Ctrl+C, and exits only on the second Ctrl+C', () => {
    expect(handleKey(createUiState(), { type: 'esc' }, ctx({ running: true })).action).toEqual({ kind: 'abort' });
    expect(handleKey(createUiState(), { type: 'ctrl+c' }, ctx({ running: true })).action).toEqual({ kind: 'abort' });

    const armed = handleKey(createUiState(), { type: 'ctrl+c' }, ctx());
    expect(armed.action).toEqual({ kind: 'none' });
    expect(armed.state.transient).toBe('再按 Ctrl+C 退出');
    expect(handleKey(armed.state, { type: 'ctrl+c' }, ctx()).action).toEqual({ kind: 'exit' });
  });

  it('disarms the exit prompt on any other key', () => {
    const armed = handleKey(createUiState(), { type: 'ctrl+c' }, ctx()).state;
    const typed = handleKey(armed, { type: 'char', ch: 'a' }, ctx()).state;
    expect(typed.exitArmed).toBe(false);
    expect(typed.transient).toBeUndefined();
  });

  it('clears a draft before it will consider exiting', () => {
    const draft = type(createUiState(), 'half a thought').state;
    const cleared = handleKey(draft, { type: 'ctrl+c' }, ctx());
    expect(cleared.action).toEqual({ kind: 'none' });
    expect(cleared.state.composer.text).toBe('');
  });

  it('scrolls by rows and toggles the entry a click lands on', () => {
    expect(handleKey(createUiState(), { type: 'pageup' }, ctx()).action).toEqual({ kind: 'scroll', delta: 12 });
    expect(handleKey(createUiState(), { type: 'wheeldown' }, ctx()).action).toEqual({ kind: 'scroll', delta: -3 });
    const click = handleKey(createUiState(), { type: 'click', x: 5, y: 4 }, ctx({ entryAt: (row) => (row === 3 ? 't7' : undefined) }));
    expect(click.action).toEqual({ kind: 'toggle', entryId: 't7' });
    expect(handleKey(createUiState(), { type: 'click', x: 5, y: 9 }, ctx()).action).toEqual({ kind: 'none' });
  });

  it('prints Tab only where a mode switch is offered', () => {
    expect(handleKey(createUiState(), { type: 'tab' }, ctx()).action).toEqual({ kind: 'none' });
    expect(handleKey(createUiState(), { type: 'tab' }, ctx({ canSwitchMode: true })).action).toEqual({ kind: 'cycleMode' });
  });
});

describe('the composer', () => {
  it('submits the draft and keeps it in history', () => {
    const typed = type(createUiState(), 'hello'); 
    const submitted = handleKey(typed.state, { type: 'enter' }, ctx());
    expect(submitted.action).toEqual({ kind: 'submit', text: 'hello' });
    expect(submitted.state.composer.text).toBe('');
    expect(submitted.state.history).toEqual(['hello']);
  });

  it('does not submit an empty or whitespace draft', () => {
    expect(handleKey(createUiState(), { type: 'enter' }, ctx()).action).toEqual({ kind: 'none' });
    const blank = type(createUiState(), '   ').state;
    expect(handleKey(blank, { type: 'enter' }, ctx()).action).toEqual({ kind: 'none' });
  });

  it('recalls history and restores the draft that was set aside', () => {
    const first = handleKey(type(createUiState(), 'one').state, { type: 'enter' }, ctx()).state;
    const second = handleKey(type(first, 'two').state, { type: 'enter' }, ctx()).state;
    const draft = type(second, 'in progress').state;
    const back = handleKey(draft, { type: 'up' }, ctx()).state;
    expect(back.composer.text).toBe('two');
    const further = handleKey(back, { type: 'up' }, ctx()).state;
    expect(further.composer.text).toBe('one');
    const forward = handleKey(further, { type: 'down' }, ctx()).state;
    const live = handleKey(forward, { type: 'down' }, ctx()).state;
    expect(live.composer.text).toBe('in progress');
    expect(live.historyIndex).toBe(-1);
  });

  it('edits with the composer vocabulary, folds included', () => {
    const pasted = handleKey(createUiState(), { type: 'paste', text: 'a\n'.repeat(4) }, ctx()).state;
    expect(pasted.composer.text).toBe('a\n'.repeat(4));
    expect(pasted.composer.folds).toHaveLength(1);
    const cleared = handleKey(pasted, { type: 'ctrl+u' }, ctx()).state;
    expect(cleared.composer.text).toBe('');
  });
});