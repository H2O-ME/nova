/**
 * The frame's view model: the rules the shell used to keep inline, pinned in
 * one place. Every case here was previously a conditional inside App's JSX —
 * which is exactly why "waiting on an approval still counts as running" could
 * have been lost in a refactor without a test noticing.
 */
import { describe, expect, it } from 'vitest';
import { chromeView, composerDisabled, modeControlsLocked, workspaceLabel } from '../src/chrome-view.js';
import { initialState, reduce, type UiState } from '../src/state.js';
import type { ReadyInfo } from '../../src/protocol.js';
import { emptyTotals } from '@nova-agent/core';

function ready(over: Partial<ReadyInfo> = {}): UiState {
  return reduce(initialState, {
    type: 'ready',
    info: {
      rootDir: 'D:/proj',
      sessionFile: 'D:/proj/s.jsonl',
      model: 'test-model',
      approvalMode: 'read-only',
      history: [],
      historyTotal: 0,
      traceTotal: 0,
      pendingApprovals: [],
      pendingQuestions: [],
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
    const view = chromeView(initialState);
    expect(view).toMatchObject({ rootDir: '', title: '' });
  });

  it('keeps the model out of the header (it belongs to the composer seat)', () => {
    // The model is state, not chrome: `state.model` is what the seat renders,
    // and a second copy here would be a place for the two to disagree.
    const state = ready({ model: 'test-model' });
    expect(state.model).toBe('test-model');
    expect(chromeView(state)).not.toHaveProperty('model');
  });

  it('titles the session from the first user block, not the newest one', () => {
    const state = reduce(ready(), { type: 'event', event: { type: 'user_message', message: { id: 'm1', ts: 0, role: 'user', content: '第一句' } } });
    const later = reduce(state, { type: 'event', event: { type: 'user_message', message: { id: 'm2', ts: 0, role: 'user', content: '第二句' } } });
    expect(chromeView(later).title).toBe('第一句');
  });

  it('counts an unanswered approval as a running turn', () => {
    const asking = reduce(ready(), {
      type: 'event',
      event: { type: 'approval_request', request: { id: 'ap1', call: { id: 'c1', name: 'bash', args: {}, rawArgs: '{}' }, kind: 'execute' } },
    });
    const view = chromeView(asking);
    expect(view).toMatchObject({ running: true, idle: false, phase: 'waiting_approval' });
  });

  it('counts an unanswered question as a running turn too', () => {
    // The run is SUSPENDED inside the ask, so the shell must keep offering the
    // abort control. Missing this would show an idle composer for a run that
    // cannot proceed without an answer.
    const asking = reduce(ready(), {
      type: 'event',
      event: { type: 'question_request', request: { id: 'q1', questions: [{ id: 'a', question: 'q' }] } },
    });
    expect(chromeView(asking)).toMatchObject({ running: true, idle: false, phase: 'waiting_question' });
    expect(composerDisabled(asking)).toBe(true);
    // Answering clears both the phase and the block.
    const answered = reduce(asking, {
      type: 'event',
      event: { type: 'question_resolved', id: 'q1', resolution: { source: 'user', answer: { answers: [] } } },
    });
    expect(chromeView(answered).phase).not.toBe('waiting_question');
    expect(composerDisabled(answered)).toBe(false);
  });

  it('reports the idle phases as idle, including a dropped socket', () => {
    expect(chromeView(ready()).idle).toBe(true);
    const down = reduce(ready(), { type: 'connection', connected: false });
    expect(chromeView(down)).toMatchObject({ idle: true, phase: 'disconnected' });
  });

  it('reports how much of the baseline is still unloaded, never a negative', () => {
    const state = ready({ history: [{ kind: 'user', text: 'q' }], historyTotal: 40 });
    expect(chromeView(state).hidden).toBe(39);
    // A host that reports fewer total blocks than the client holds (a stale
    // baseline) must not render "还有 -3 条".
    expect(chromeView(ready({ historyTotal: 0 })).hidden).toBe(0);
  });

  it('labels the hero chip with the workspace basename on either separator', () => {
    expect(workspaceLabel('D:\\web\\agent')).toBe('agent');
    expect(workspaceLabel('/home/user/nova')).toBe('nova');
    expect(workspaceLabel('/')).toBe('/');
    expect(chromeView(ready()).workspace).toBe('proj');
    expect(chromeView(initialState).workspace).toBe('');
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

describe('modeControlsLocked', () => {
  it('locks the mode controls for the WHOLE run, not just when an ask is up', () => {
    // The regression this pins: the settings panel's two mode rows were wired to
    // `composerDisabled`, which has no run term, so both stayed enabled mid-run
    // while the composer seat's chips were locked. The click could only produce a
    // refusal from the router, reported as a transcript hint rather than in the
    // panel the reader was looking at. A mode is a promise about the whole run
    // (the execution mode picks the toolset, which is part of the cached prefix),
    // so the rule must hold at every site the control appears.
    const idle = ready();
    expect(composerDisabled(idle)).toBe(false);
    expect(modeControlsLocked(idle)).toBe(false);

    // Mid-run with no ask pending: the case the settings panel got wrong.
    const running = reduce(idle, { type: 'event', event: { type: 'phase', phase: 'thinking' } });
    expect(composerDisabled(running)).toBe(false);
    expect(modeControlsLocked(running)).toBe(true);

    // Every phase that means a turn is in flight locks it.
    for (const phase of ['thinking', 'writing', 'tool', 'compacting', 'retrying'] as const) {
      const state = reduce(idle, { type: 'event', event: { type: 'phase', phase } });
      expect(modeControlsLocked(state)).toBe(true);
    }
  });

  it('is never weaker than composerDisabled', () => {
    // The two rules are nested by construction; this states it so an edit to
    // either cannot invert the relationship silently.
    const offline = reduce(ready(), { type: 'connection', connected: false });
    expect(composerDisabled(offline)).toBe(true);
    expect(modeControlsLocked(offline)).toBe(true);
  });
});
