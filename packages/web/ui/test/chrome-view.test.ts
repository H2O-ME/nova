/**
 * The frame's view model: the rules the shell used to keep inline, pinned in
 * one place. Every case here was previously a conditional inside App's JSX —
 * which is exactly why "waiting on an approval still counts as running" could
 * have been lost in a refactor without a test noticing.
 */
import { describe, expect, it } from 'vitest';
import { chromeView, composerDisabled } from '../src/chrome-view.js';
import { initialState, reduce, type UiState } from '../src/state.js';
import type { ReadyInfo } from '../../src/protocol.js';
import { emptyTotals } from '../../src/totals.js';

function ready(over: Partial<ReadyInfo> = {}): UiState {
  return reduce(initialState, {
    type: 'ready',
    info: {
      rootDir: 'D:/proj',
      sessionFile: 'D:/proj/s.jsonl',
      model: 'test-model',
      approvalMode: 'read-only',
      codeMode: 'native',
      history: [],
      historyTotal: 0,
      traceTotal: 0,
      pendingApprovals: [],
      jobs: [],
      usedTokens: 0,
      modelSwitching: false,
      commands: [],
      runTotals: emptyTotals,
      ...over,
    },
  });
}

describe('chromeView', () => {
  it('falls back to placeholders before the first ready', () => {
    const view = chromeView(initialState, null);
    expect(view).toMatchObject({ rootDir: '', title: '', detail: undefined });
  });

  it('keeps the model out of the header (it belongs to the composer seat)', () => {
    // The model is state, not chrome: `state.model` is what the seat renders,
    // and a second copy here would be a place for the two to disagree.
    const state = ready({ model: 'test-model' });
    expect(state.model).toBe('test-model');
    expect(chromeView(state, null)).not.toHaveProperty('model');
  });

  it('titles the session from the first user block, not the newest one', () => {
    const state = reduce(ready(), { type: 'event', event: { type: 'user_message', message: { id: 'm1', ts: 0, role: 'user', content: '第一句' } } });
    const later = reduce(state, { type: 'event', event: { type: 'user_message', message: { id: 'm2', ts: 0, role: 'user', content: '第二句' } } });
    expect(chromeView(later, null).title).toBe('第一句');
  });

  it('counts an unanswered approval as a running turn', () => {
    const asking = reduce(ready(), {
      type: 'event',
      event: { type: 'approval_request', request: { id: 'ap1', call: { id: 'c1', name: 'bash', args: {}, rawArgs: '{}' }, kind: 'execute' } },
    });
    const view = chromeView(asking, null);
    expect(view).toMatchObject({ running: true, idle: false, phase: 'waiting_approval' });
  });

  it('reports the idle phases as idle, including a dropped socket', () => {
    expect(chromeView(ready(), null).idle).toBe(true);
    const down = reduce(ready(), { type: 'connection', connected: false });
    expect(chromeView(down, null)).toMatchObject({ idle: true, phase: 'disconnected' });
  });

  it('reports how much of the baseline is still unloaded, never a negative', () => {
    const state = ready({ history: [{ kind: 'user', text: 'q' }], historyTotal: 40 });
    expect(chromeView(state, null).hidden).toBe(39);
    // A host that reports fewer total blocks than the client holds (a stale
    // baseline) must not render "还有 -3 条".
    expect(chromeView(ready({ historyTotal: 0 }), null).hidden).toBe(0);
  });

  it('opens the detail panel only on a tool block with that call id', () => {
    const state = reduce(ready(), {
      type: 'event',
      event: { type: 'tool_call_start', turn: 1, call: { id: 'c1', name: 'bash', args: {}, rawArgs: '{}' } },
    });
    expect(chromeView(state, 'c1').detail).toMatchObject({ callId: 'c1' });
    expect(chromeView(state, 'nope').detail).toBeUndefined();
    expect(chromeView(state, null).detail).toBeUndefined();
  });

  it('gates the composer on the socket and on a pending approval', () => {
    expect(composerDisabled(initialState)).toBe(true);
    expect(composerDisabled(ready())).toBe(false);
    const asking = reduce(ready(), {
      type: 'event',
      event: { type: 'approval_request', request: { id: 'ap1', call: { id: 'c1', name: 'bash', args: {}, rawArgs: '{}' }, kind: 'execute' } },
    });
    expect(composerDisabled(asking)).toBe(true);
  });
});
describe('lastToolCallId', () => {
  it('is undefined until the session has a tool call', () => {
    // The header corner's expand control renders nothing then: an empty panel
    // is not a surface worth offering a way into.
    expect(chromeView(ready(), null).lastToolCallId).toBeUndefined();
  });

  it('names the NEWEST call, even while the panel shows an older one', () => {
    const state = reduce(ready(), {
      type: 'event',
      view: { card: 'terminal', command: 'ls' },
      event: { type: 'tool_call_start', turn: 1, call: { id: 'c1', name: 'bash', args: {}, rawArgs: '{}' } },
    });
    const two = reduce(state, {
      type: 'event',
      view: { card: 'terminal', command: 'pwd' },
      event: { type: 'tool_call_start', turn: 1, call: { id: 'c2', name: 'bash', args: {}, rawArgs: '{}' } },
    });
    const view = chromeView(two, 'c1');
    expect(view.lastToolCallId).toBe('c2');
    expect(view.detail?.callId).toBe('c1');
  });
});
