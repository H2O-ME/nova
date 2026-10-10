import { describe, expect, it } from 'vitest';
import type { ApprovalRequest, KernelEvent, QuestionRequest, ToolCallView, ToolResultView } from '@nova-agent/core';
import type { ReadyInfo, WireBlock, WireTraceRow } from '../../src/protocol.js';
import type { ContextTimeline } from '../src/types.js';
import { emptyTotals } from '@nova-agent/core';
import { initialState, reduce, type Block, type UiState } from '../src/state.js';
import { isIgnoredEvent } from '../src/state-events.js';

/**
 * The reducer is the browser's whole brain: frames in, blocks out. These tests
 * pin the contracts it lives by — streaming coalescing, view-carrying tool
 * rows, approval clearing, the reconnect baseline — without a DOM in sight.
 */

const CALL = { id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{"command":"ls"}' };
const TERMINAL_CALL: ToolCallView = { card: 'terminal', kind: 'execute', command: 'ls' };

type Frame = { event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView };

/** Fold a scripted frame stream through the reducer — what the socket does. */
function fold(frames: Frame[], state: UiState = initialState): UiState {
  return frames.reduce((acc, frame) => reduce(acc, { type: 'event', ...frame }), state);
}

function toolResult(content: string, id = 'c1'): KernelEvent {
  return { type: 'tool_call_result', turn: 1, call: { ...CALL, id }, result: { id: 'r1', ts: 0, role: 'tool', toolCallId: id, name: 'bash', content } };
}

const EMPTY_STATS = { turns: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, missTokens: 0, missTurns: 0 };

/** A `run_stats` event with the uninteresting fields filled in. */
function runStats(over: Partial<Extract<KernelEvent, { type: 'run_stats' }>['stats']>): KernelEvent {
  return {
    type: 'run_stats',
    stats: {
      startedAt: 1_700_000_000_000,
      durationMs: 1_000,
      llmMs: 1_000,
      toolMs: 0,
      requests: 1,
      toolCalls: 1,
      retries: 0,
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 40,
      ...over,
    },
  };
}

function readyInfo(over: Partial<ReadyInfo> = {}): ReadyInfo {
  return {
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
  };
}

function approvalRequest(id: string): ApprovalRequest {
  return { id, call: CALL, kind: 'read' };
}

/** A one-question batch, the shape the browser renders from `question_request`. */
function questionRequest(id: string): QuestionRequest {
  return { id, questions: [{ id: 'mode', question: '哪条路？', options: [{ label: '快' }, { label: '稳' }] }] };
}

/** A state that has seen one `ready` — the precondition every seat test has. */
function baselined(over: Partial<ReadyInfo> = {}): UiState {
  return reduce(initialState, { type: 'ready', info: readyInfo({ modelSwitching: true, ...over }) });
}

function texts(blocks: Block[]): string[] {
  return blocks.map((b) => (b.kind === 'text' ? b.text : `<${b.kind}>`));
}

describe('reduce / connection', () => {
  it('marks the transcript disconnected without dropping it; only `ready` reconnects', () => {
    const live = fold([{ event: { type: 'text_delta', messageId: 'm', text: 'hi' } }]);
    const down = reduce(live, { type: 'connection', connected: false });
    expect(down.phase).toBe('disconnected');
    expect(down.connected).toBe(false);
    expect(texts(down.blocks)).toEqual(['hi']);
    // A socket that is open is not a session that answers: there is no
    // `connected: true` arm at all (compile-time), so the reconnect's `ready`
    // is the only thing that lights the room back up.
    const back = reduce(down, { type: 'ready', info: readyInfo() });
    expect(back.connected).toBe(true);
    expect(back.phase).toBe('idle');
  });
});

describe('reduce / send echo accounting', () => {
  const userMsg = (id: string, text: string) => ({ id, ts: 0, role: 'user' as const, content: text });

  it('parks the echo wait on a prompt/command send and settles it on the kernel echo', () => {
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'prompt', text: '跑' } });
    expect(sent.awaitingEcho).toBe(true);
    const echoed = reduce(sent, { type: 'event', event: { type: 'user_message', message: userMsg('m1', '跑') } });
    expect(echoed.awaitingEcho).toBe(false);
  });

  it('a queued prompt also settles: its user_message commits before the queue branch', () => {
    // Queued prompts echo immediately (session.prompt publishes user_message
    // before the running/compaction queue check), so the same echo settles a
    // send that the kernel is still queueing.
    const first = reduce(initialState, { type: 'sent', frame: { type: 'prompt', text: '一' } });
    const queued = reduce(first, { type: 'sent', frame: { type: 'prompt', text: '二' } });
    expect(queued.awaitingEcho).toBe(true);
    expect(reduce(queued, { type: 'event', event: { type: 'user_message', message: userMsg('m2', '二') } }).awaitingEcho).toBe(false);
  });

  it('a command run row echoes a command send', () => {
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'command', name: 'compact', args: '' } });
    expect(sent.awaitingEcho).toBe(true);
    const done = reduce(sent, { type: 'event', event: { type: 'command', name: 'compact', phase: 'run' } });
    expect(done.awaitingEcho).toBe(false);
  });

  it('an error before any echo rings sendRejected exactly once per rejected send', () => {
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'prompt', text: '跑' } });
    const rejected = reduce(sent, { type: 'error', message: 'not attached' });
    expect(rejected.sendRejected).toBe(1);
    expect(rejected.awaitingEcho).toBe(false);
    // A second `error` frame with nothing newly sent must NOT ring again —
    // otherwise the composer restores a draft the user already has.
    expect(reduce(rejected, { type: 'error', message: 'still bad' }).sendRejected).toBe(1);
    // A new send re-arms: the next rejection is observable again.
    const resent = reduce(rejected, { type: 'sent', frame: { type: 'prompt', text: '再' } });
    expect(reduce(resent, { type: 'error', message: 'no' }).sendRejected).toBe(2);
  });

  it('after the echo, a later error is not mistaken for a rejected send', () => {
    const live = reduce(
      reduce(initialState, { type: 'sent', frame: { type: 'prompt', text: '跑' } }),
      { type: 'event', event: { type: 'user_message', message: userMsg('m1', '跑') } },
    );
    const after = reduce(live, { type: 'error', message: 'provider blew up mid-run' });
    expect(after.sendRejected).toBe(0);
  });

  it('non-echo frames (list_sessions) never park the echo wait', () => {
    expect(reduce(initialState, { type: 'sent', frame: { type: 'list_sessions' } }).awaitingEcho).toBe(false);
  });
});

describe('reduce / plugin answers', () => {
  const answer = (plugin: string, id: number, result: unknown) => ({
    type: 'plugin_answer' as const,
    plugin,
    id,
    op: 'page',
    ok: true,
    result,
  });

  it('keeps the newest answer per plugin and drops a late one from a previous mount', () => {
    // Ids are globally monotonic (settings/plugin-request-id.ts), so a slow
    // reply to a request the page has moved past must not overwrite the fresh
    // page the operator is looking at.
    const fresh = reduce(initialState, answer('demo', 9, { title: '新页' }));
    expect(fresh.pluginAnswers.demo).toMatchObject({ id: 9 });
    expect(reduce(fresh, answer('demo', 3, { title: '旧页' })).pluginAnswers.demo).toMatchObject({ id: 9 });
    // A genuinely newer answer still lands, and another plugin is untouched.
    const next = reduce(fresh, answer('demo', 10, { title: '更新页' }));
    expect(next.pluginAnswers.demo).toMatchObject({ id: 10 });
    expect(next.pluginAnswers.other).toBeUndefined();
  });
});

describe('reduce / ready replay', () => {
  it('replaces the transcript with the host-projected baseline', () => {
    const history: WireBlock[] = [
      { kind: 'user', text: '问一句' },
      { kind: 'text', text: '答一句' },
      { kind: 'tool', callId: 'c1', name: 'bash', args: '{"command":"ls"}', view: TERMINAL_CALL, result: { card: 'terminal', output: 'ok', exitCode: 0 } },
      { kind: 'tool', callId: 'c2', name: 'read_file', args: '{"path":"a"}', view: { card: 'generic', kind: 'read', title: 'a' } },
    ];
    const state = reduce(fold([{ event: { type: 'text_delta', messageId: 'm', text: 'stale' } }]), {
      type: 'ready',
      info: readyInfo({ history, usedTokens: 1234, contextWindow: 200_000 }),
    });
    expect(state.connected).toBe(true);
    expect(state.blocks.map((b) => b.kind)).toEqual(['user', 'text', 'tool', 'tool']);
    expect(state.blocks[2]).toMatchObject({ kind: 'tool', callId: 'c1', result: { exitCode: 0 } });
    expect(state.blocks[3]).toMatchObject({ kind: 'tool', callId: 'c2' });
    expect(state.blocks[3]).not.toHaveProperty('result'); // no result logged for it
    expect(state.usedTokens).toBe(1234);
    expect(state.contextWindow).toBe(200_000);
  });

  it('carries a replayed context section through as its own block', () => {
    // The host decides the form (core read it off the section's syntax); the
    // reducer only carries it, so a form this build has never seen still lands.
    const history: WireBlock[] = [
      { kind: 'context', tag: 'environment', form: 'snapshot', sections: [{ name: 'cwd', text: '/w' }], text: 'cwd=/w' },
      { kind: 'user', text: '问一句' },
    ];
    const state = reduce(initialState, { type: 'ready', info: readyInfo({ history }) });
    expect(state.blocks.map((b) => b.kind)).toEqual(['context', 'user']);
    expect(state.blocks[0]).toMatchObject({
      kind: 'context',
      tag: 'environment',
      form: 'snapshot',
      sections: [{ name: 'cwd', text: '/w' }],
      text: 'cwd=/w',
    });
    // Absent optionals stay absent rather than arriving as undefined keys.
    expect(state.blocks[0]).not.toHaveProperty('entries');
    expect(state.blocks[0]).not.toHaveProperty('note');
  });

  it('adopts the reported modes, keeps the session list and restores a pending approval', () => {
    const opened = reduce(fold([], initialState), { type: 'sessions', items: [{ file: 'f.jsonl', title: 't', mtime: 1 }] });
    expect(opened.sessions).toHaveLength(1);
    const state = reduce(opened, {
      type: 'ready',
      info: readyInfo({ approvalMode: 'full', pendingApprovals: [approvalRequest('ap1')] }),
    });
    // An attach re-states the transcript, not the sidebar: the rows the user is
    // looking at stay put, and the list only ASKS again (stale, not empty) —
    // otherwise every switch blinks the panel into "loading" and back.
    expect(state).toMatchObject({ approvalMode: 'full', sessionsStale: true });
    expect(state.sessions).toHaveLength(1);
    expect(state.pendingApproval?.id).toBe('ap1');
  });

  it('restores a suspended question from the baseline, not an idle session', () => {
    // The load-bearing case for a reattach: the run is parked INSIDE the ask, so
    // a baseline that dropped `pendingQuestions` would show an idle session whose
    // run can never be released from the browser.
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({ pendingQuestions: [questionRequest('q1')] }),
    });
    expect(state.pendingQuestion?.id).toBe('q1');
    expect(state.phase).toBe('waiting_question');
    // And the baseline is authoritative the other way too: a plain attach must
    // clear a card the client was holding when its socket dropped.
    const cleared = reduce(state, { type: 'ready', info: readyInfo() });
    expect(cleared.pendingQuestion).toBeNull();
    expect(cleared.phase).toBe('idle');
  });

  it('holds one list request in flight at a time (the answer settles it)', () => {
    const asked = reduce(initialState, { type: 'sent', frame: { type: 'list_sessions' } });
    expect(asked).toMatchObject({ sessionsPending: true, sessionsStale: false });
    const answered = reduce(asked, { type: 'sessions', items: [{ file: 'f.jsonl', title: 't', mtime: 1 }] });
    expect(answered).toMatchObject({ sessionsPending: false, sessionsStale: false });
    // A failed ask settles the flag too: a stuck in-flight flag would block
    // every later re-ask (the error frame IS the reply).
    const failed = reduce(asked, { type: 'error', message: 'nope' });
    expect(failed.sessionsPending).toBe(false);
  });

  it('replays a run measurement from the baseline and takes the host totals', () => {
    const stats = {
      startedAt: 1_700_000_000_000,
      durationMs: 4_000,
      firstTokenMs: 2_300,
      llmMs: 3_000,
      toolMs: 0,
      requests: 2,
      toolCalls: 0,
      retries: 0,
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 40,
    };
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({
        history: [
          { kind: 'text', text: 'ok', ts: 1 },
          { kind: 'meta', stats, ts: stats.startedAt },
        ],
        runTotals: { ...emptyTotals, runs: 3, completionTokens: 60 },
      }),
    });
    expect(state.blocks.map((b) => b.kind)).toEqual(['text', 'meta']);
    expect(state.blocks[1]).toMatchObject({ kind: 'meta', stats });
    expect(state.totals).toMatchObject({ runs: 3, completionTokens: 60 });
  });

  it('a state frame updates the modes without touching the transcript', () => {
    const live = fold([{ event: { type: 'text_delta', messageId: 'm', text: 'x' } }]);
    const switched = reduce(live, { type: 'state', approvalMode: 'auto-edit', model: 'test-model' });
    expect(switched).toMatchObject({ approvalMode: 'auto-edit' });
    expect(texts(switched.blocks)).toEqual(['x']);
  });
});

describe('reduce / trace view', () => {
  const row = (ts: number): WireTraceRow => ({ kind: 'workspace', ts, path: `p${ts}` });
  /** The pane's own sequence: opening the view sends `have: 0`, then a page sends the count. */
  function opened(): UiState {
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'load_trace', have: 0 } });
    return reduce(sent, { type: 'trace', rows: [row(3), row(4)], total: 5 });
  }

  it('keeps the in-flight read visible and settles it with the rows', () => {
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'load_trace', have: 0 } });
    expect(sent.trace).toMatchObject({ pending: true, have: 0, rows: [], total: 0 });
    const done = reduce(sent, { type: 'trace', rows: [row(1)], total: 1 });
    expect(done.trace).toMatchObject({ pending: false, total: 1, have: 1 });
    expect(done.trace?.rows.map((r) => (r.kind === 'workspace' ? r.ts : 0))).toEqual([1]);
  });

  it('folds an older page in FRONT, and a fresh read replaces the rows', () => {
    const paged = reduce(reduce(opened(), { type: 'sent', frame: { type: 'load_trace', have: 2 } }), {
      type: 'trace',
      rows: [row(1), row(2)],
      total: 5,
    });
    expect(paged.trace?.rows.map((r) => (r.kind === 'workspace' ? r.ts : 0))).toEqual([1, 2, 3, 4]);
    expect(paged.trace?.have).toBe(4);
    // Opening the view again (or its refresh) says "I hold nothing": the answer
    // is the newest tail, so the old rows must not survive beside it.
    const refreshed = reduce(reduce(paged, { type: 'sent', frame: { type: 'load_trace', have: 0 } }), {
      type: 'trace',
      rows: [row(5)],
      total: 5,
    });
    expect(refreshed.trace?.rows.map((r) => (r.kind === 'workspace' ? r.ts : 0))).toEqual([5]);
  });

  it('drops the rows on a re-baseline: they belong to the session that closed', () => {
    const rebased = reduce(opened(), { type: 'ready', info: readyInfo() });
    expect(rebased.trace).toBeNull();
    expect(rebased.meta?.traceTotal).toBe(0);
  });

  it('unblocks a page when the socket drops, and keeps the rows on screen', () => {
    const sent = reduce(opened(), { type: 'sent', frame: { type: 'load_trace', have: 2 } });
    const dropped = reduce(sent, { type: 'connection', connected: false });
    expect(dropped.trace).toMatchObject({ pending: false, total: 5 });
    expect(dropped.trace?.rows).toHaveLength(2);
  });

  it('unblocks the directory picker when the socket drops', () => {
    // The regression this pins: `historyPending` and `trace.pending` were both
    // cleared here but `directory.pending` was not, and that flag is
    // load-bearing — the dialog gates its own opening ask on `!pending` and
    // disables both 新建文件夹 and 打开 while it is set. A disconnect during a
    // listing therefore left a dead end that only closing and reopening could
    // escape, with no frame able to arrive and clear it.
    // Opened first: only an OPEN picker can be mid-ask (see the directory
    // browser's own suite — an answer alone no longer opens it).
    const asked = reduce(
      reduce(opened(), { type: 'directory_open', open: true }),
      { type: 'directory_ask' },
    );
    expect(asked.directory).toMatchObject({ pending: true });
    const dropped = reduce(asked, { type: 'connection', connected: false });
    expect(dropped.directory).toMatchObject({ pending: false });
    // A level already drawn stays on screen: only the in-flight flag is dropped.
    const listed = reduce(asked, {
      type: 'directory',
      level: { path: '/w', home: '/h', crumbs: [], roots: [], entries: [], truncated: false },
    });
    const droppedAfterList = reduce(listed, { type: 'connection', connected: false });
    expect(droppedAfterList.directory?.level?.path).toBe('/w');
    expect(droppedAfterList.directory).toMatchObject({ pending: false });
  });

  it('selects a view locally, without touching the transcript', () => {
    const live = fold([{ event: { type: 'text_delta', messageId: 'm', text: 'x' } }]);
    const switched = reduce(live, { type: 'select_view', view: 'trace' });
    expect(switched.view).toBe('trace');
    expect(texts(switched.blocks)).toEqual(['x']);
  });
});

describe('reduce / view follows the session', () => {
  it('drops a pane view on a session switch — a carried view stacked the new pane under the hero', () => {
    // The reported overlay: reading 轨迹 (or 上下文), clicking 新会话, and the
    // new session's pane rendered under the hero — the hero phase hides the
    // tab strip, so a surviving view had no way back. The view is chrome for
    // ONE session, so a switch lands on the conversation.
    const switchTo = readyInfo({ sessionFile: 'D:/proj/other.jsonl' });
    const fromTrace = reduce(reduce(baselined(), { type: 'select_view', view: 'trace' }), {
      type: 'ready',
      info: switchTo,
    });
    expect(fromTrace.view).toBe('chat');
    const fromContext = reduce(reduce(baselined(), { type: 'select_view', view: 'context' }), {
      type: 'ready',
      info: switchTo,
    });
    expect(fromContext.view).toBe('chat');
  });

  it('keeps the pane view across a re-attach to the same session', () => {
    // A reconnect re-baselines the SAME session; it must not kick the reader
    // out of the pane they were reading.
    const onTrace = reduce(baselined(), { type: 'select_view', view: 'trace' });
    expect(reduce(onTrace, { type: 'ready', info: readyInfo() }).view).toBe('trace');
  });
});

describe('reduce / context view', () => {
  const reading = (seq: number): ContextTimeline => ({
    truncated: false,
    live: { cats: { system: 0, tools: 0, injected: 0, user: seq, assistant: 0, tool: 0 }, total: seq, elements: [] },
    counts: { requests: seq, turns: seq, toolCalls: 0, compactions: 0 },
    points: [],
    events: [],
    files: [],
  });

  it('holds the reading from a frame, and from the baseline', () => {
    const framed = reduce(initialState, { type: 'context', timeline: reading(4) });
    expect(framed.context?.counts.requests).toBe(4);
    const based = reduce(initialState, { type: 'ready', info: { ...readyInfo(), context: reading(7) } });
    expect(based.context?.counts.requests).toBe(7);
    // A baseline with no reading (the plugin off) must leave the panel empty,
    // not keep the previous session's numbers.
    expect(reduce(framed, { type: 'ready', info: readyInfo() }).context).toBeNull();
  });

  it('drops a view left on the panel when the reading goes away', () => {
    // The plugin was switched off: the pane has nothing to draw, and a view
    // stuck on `context` would render an empty column with no way out but the
    // header — which the reducer would have to keep offering.
    const open = reduce(reduce(initialState, { type: 'context', timeline: reading(2) }), {
      type: 'select_view',
      view: 'context',
    });
    expect(open.view).toBe('context');
    const cleared = reduce(open, { type: 'context', timeline: null });
    expect(cleared.context).toBeNull();
    expect(cleared.view).toBe('chat');
  });
});

describe('reduce / streaming blocks', () => {
  it('coalesces consecutive deltas into one block and closes it on tool start', () => {
    const state = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'he' } },
      { event: { type: 'text_delta', messageId: 'm', text: 'llo' } },
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'text_delta', messageId: 'm', text: 'after' } },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['text', 'tool', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'hello', streaming: false });
    expect(state.blocks[2]).toMatchObject({ text: 'after', streaming: true });
  });

  it('keeps reasoning in its own block, never merged into text', () => {
    const state = fold([
      { event: { type: 'reasoning_delta', text: 'think' } },
      { event: { type: 'text_delta', messageId: 'm', text: 'say' } },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['reasoning', 'text']);
    expect(state.blocks[0]).toMatchObject({ text: 'think', streaming: false });
  });

  it('closes the open stream on done', () => {
    const state = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'x' } },
      { event: { type: 'done', stopReason: 'complete' } },
    ]);
    expect(state.blocks[0]).toMatchObject({ streaming: false });
  });
});

describe('reduce / tool rows carry server-resolved views', () => {
  it('stores the view the host sent with the call', () => {
    const state = fold([{ event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'terminal', kind: 'execute', command: 'ls' } });
    expect(state.blocks[0]).not.toHaveProperty('result');
  });

  it('falls back to a generic card when the host sent no view at all', () => {
    const state = fold([{ event: { type: 'tool_call_start', turn: 1, call: CALL } }]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', view: { card: 'generic', kind: 'other', title: 'bash' } });
  });

  it('attaches the result view by call id and leaves siblings running', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'tool_call_start', turn: 1, call: { ...CALL, id: 'c2' } }, view: TERMINAL_CALL },
      { event: toolResult('exit: 1\nboom'), resultView: { card: 'terminal', output: 'boom', exitCode: 1 } },
    ]);
    expect(state.blocks[0]).toMatchObject({ callId: 'c1', result: { exitCode: 1 } });
    expect(state.blocks[1]).toMatchObject({ callId: 'c2' });
    expect(state.blocks[1]).not.toHaveProperty('result');
  });

  it('feeds the last non-empty progress line to unfinished rows only', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'tool_progress', callId: 'c1', text: 'line 1\nline 2\n' } },
      { event: toolResult('exit: 0\nok'), resultView: { card: 'terminal', output: 'ok', exitCode: 0 } },
      { event: { type: 'tool_progress', callId: 'c1', text: 'late' } },
    ]);
    expect(state.blocks[0]).toMatchObject({ tail: 'line 2' });
  });
});

describe('reduce / approvals, queue, phases', () => {
  it('clears only the approval that was resolved', () => {
    const pending = fold([{ event: { type: 'approval_request', request: approvalRequest('ap1') } }]);
    expect(pending.pendingApproval?.id).toBe('ap1');
    const other = fold([{ event: { type: 'approval_resolved', id: 'other', resolution: { source: 'aborted' } } }], pending);
    expect(other.pendingApproval?.id).toBe('ap1');
    const answered = fold(
      [{ event: { type: 'approval_resolved', id: 'ap1', resolution: { source: 'user', answer: 'deny' } } }],
      pending,
    );
    expect(answered.pendingApproval).toBeNull();
  });

  it('tracks the prompt queue and the phase verbatim', () => {
    const state = fold([
      { event: { type: 'queue_update', items: ['second', 'third'] } },
      { event: { type: 'phase', phase: 'tool' } },
    ]);
    expect(state.queued).toEqual(['second', 'third']);
    expect(state.phase).toBe('tool');
  });

  it('holds the pending question and clears only the one that was resolved', () => {
    const pending = fold([{ event: { type: 'question_request', request: questionRequest('q1') } }]);
    expect(pending.pendingQuestion?.id).toBe('q1');
    expect(pending.pendingQuestion?.questions[0]?.question).toBe('哪条路？');
    // A late resolution for a batch the user already moved past must not clear
    // the card currently on screen.
    const other = fold(
      [{ event: { type: 'question_resolved', id: 'other', resolution: { source: 'aborted' } } }],
      pending,
    );
    expect(other.pendingQuestion?.id).toBe('q1');
    const answered = fold(
      [{ event: { type: 'question_resolved', id: 'q1', resolution: { source: 'user', answer: { answers: [] } } } }],
      pending,
    );
    expect(answered.pendingQuestion).toBeNull();
    // The user's own answer needs no hint: the tool row carries it.
    expect(answered.blocks.some((b) => b.kind === 'hint')).toBe(false);
  });

  it('says why a question went away when it was not the user who closed it', () => {
    const pending = fold([{ event: { type: 'question_request', request: questionRequest('q1') } }]);
    const aborted = fold(
      [{ event: { type: 'question_resolved', id: 'q1', resolution: { source: 'aborted' } } }],
      pending,
    );
    expect(aborted.pendingQuestion).toBeNull();
    expect(aborted.blocks.at(-1)).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('取消') });
    const cancelled = fold(
      [{ event: { type: 'question_resolved', id: 'q1', resolution: { source: 'cancelled' } } }],
      pending,
    );
    expect(cancelled.pendingQuestion).toBeNull();
    expect(cancelled.blocks.at(-1)).toMatchObject({ kind: 'hint', tone: 'info' });
  });

  it('feeds the gauge from the last request consumption, not the cumulative total', () => {
    const state = fold([
      {
        event: {
          type: 'usage',
          usage: { promptTokens: 4200, completionTokens: 30, cachedTokens: 4000 },
          stats: { turns: 3, promptTokens: 99_000, completionTokens: 900, cachedTokens: 90_000, missTokens: 0, missTurns: 0 },
        },
      },
    ]);
    expect(state).toMatchObject({ usedTokens: 4200 });
  });
});

describe('reduce / hints', () => {
  it('renders compaction start and done as info hints', () => {
    const state = fold([
      { event: { type: 'compaction', progress: { state: 'start', trigger: 'auto' } } },
      { event: { type: 'compaction', progress: { state: 'done', trigger: 'auto', retained: 7 } } },
    ]);
    expect(state.blocks.map((b) => (b.kind === 'hint' ? b.tone : b.kind))).toEqual(['info', 'info']);
    expect(state.blocks[1]).toMatchObject({ text: expect.stringContaining('7 条消息') });
  });

  it('maps the fuse notice to a warning and other notices to info', () => {
    expect(fold([{ event: { type: 'notice', code: 'compact_fused', text: '已停用自动压缩' } }]).blocks[0]).toMatchObject({ tone: 'warn' });
    expect(fold([{ event: { type: 'notice', code: 'compacted', text: '已自动压缩' } }]).blocks[0]).toMatchObject({ tone: 'info' });
  });

  it('distinguishes an abort from a failure', () => {
    const aborted = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'partial' } },
      { event: { type: 'run_failed', message: 'aborted by user', aborted: true } },
    ]);
    expect(aborted.blocks.map((b) => b.kind)).toEqual(['text', 'hint']);
    expect(aborted.blocks[0]).toMatchObject({ streaming: false });

    const failed = fold([{ event: { type: 'run_failed', message: 'provider 500', aborted: false } }]);
    expect(failed.blocks[0]).toMatchObject({ text: expect.stringContaining('provider 500'), tone: 'warn' });
  });

  it('surfaces host errors as a warning hint', () => {
    const state = reduce(initialState, { type: 'error', message: 'bad frame' });
    expect(state.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn' });
  });

  it('phrases an unknown frame type as "restart the host", not jargon', () => {
    // An older nova process answers a newer page with this exact sentence.
    // The reader's fix is restarting the host — the frame name is ours to
    // know, not theirs to parse.
    const state = reduce(initialState, { type: 'error', message: 'unknown frame type: shell_read' });
    expect(state.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn' });
    expect((state.blocks[0] as { text: string }).text).toContain('重新启动');
    expect((state.blocks[0] as { text: string }).text).not.toContain('shell_read');

    // Any other error keeps the host's own words.
    const other = reduce(initialState, { type: 'error', message: 'git clone failed: 404' });
    expect((other.blocks[0] as { text: string }).text).toContain('git clone failed: 404');
  });
});

describe('reduce / git clone in flight', () => {
  it('raises the flag on the request and settles it on either reply', () => {
    // The clone's SUCCESS reply is the re-stated `ready` (it changed what is
    // open); its failure reply is the ordinary error frame. Both settle.
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'git_clone', url: 'https://example.com/x.git' } });
    expect(sent.clonePending).toBe(true);

    const failed = reduce(sent, { type: 'error', message: '仓库 URL 含有控制字符' });
    expect(failed.clonePending).toBe(false);

    const adopted = reduce(reduce(initialState, { type: 'sent', frame: { type: 'git_clone', url: 'u' } }), {
      type: 'ready',
      info: readyInfo(),
    });
    expect(adopted.clonePending).toBe(false);
  });
});

describe('reduce / turn bookkeeping', () => {
  it('counts turns and ignores events with no transcript effect', () => {
    const state = fold([
      { event: { type: 'turn_start', turn: 1 } },
      { event: { type: 'turn_start', turn: 2 } },
      { event: { type: 'phase', phase: 'thinking' } },
      { event: { type: 'usage', usage: { promptTokens: 5, completionTokens: 1, cachedTokens: 0 }, stats: EMPTY_STATS } },
    ]);
    expect(state.turnCount).toBe(2);
    expect(state.blocks).toHaveLength(0);
    expect(state.usedTokens).toBe(5);
  });

  it('shows a re-request and an empty completion as warning hints', () => {
    const retried = fold([
      { event: { type: 'llm_retry', attempt: 2, maxRetries: 5, error: 'socket hang up', stats: EMPTY_STATS } },
    ]);
    expect(retried.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('2/5') });

    const empty = fold([{ event: { type: 'empty_completion', attempt: 1, maxRetries: 3, finishReason: 'stop' } }]);
    expect(empty.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('空补全') });
  });
});

describe('reduce / run stats', () => {
  it('records a run as one meta row and folds it into the session totals', () => {
    const first = fold([{ event: runStats({ durationMs: 12_000, firstTokenMs: 900, completionTokens: 40, llmMs: 2_000 }) }]);
    expect(first.blocks[0]).toMatchObject({ kind: 'meta' });
    expect(first.totals).toMatchObject({ runs: 1, requests: 1, toolCalls: 1, llmMs: 2_000, firstTokenMs: 900, firstTokenRuns: 1 });

    const second = fold([{ event: runStats({ durationMs: 3_000, completionTokens: 10, llmMs: 1_000 }) }], first);
    expect(second.totals).toMatchObject({ runs: 2, llmMs: 3_000, firstTokenRuns: 1, completionTokens: 50 });
    // A run that never streamed a token contributes no latency sample.
    expect(second.totals.firstTokenMs).toBe(900);
  });

  it('re-baselines the totals on ready: a resumed session does not inherit them', () => {
    const ran = fold([{ event: runStats({}) }]);
    expect(ran.totals.runs).toBe(1);
    const resumed = reduce(ran, { type: 'ready', info: readyInfo() });
    expect(resumed.totals.runs).toBe(0);
  });
});

describe('reduce / tool detail and jobs', () => {
  it('keeps the result text so the detail panel can show it', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: toolResult('line one\nline two') },
    ]);
    expect(state.blocks[0]).toMatchObject({ kind: 'tool', output: 'line one\nline two' });
    expect(state.blocks[0]).toHaveProperty('ts');
  });

  it('upserts a background job in place instead of appending a row per update', () => {
    const job = (status: 'running' | 'completed', progress?: string): KernelEvent => ({
      type: 'job_update',
      job: { id: 'bash-1', kind: 'bash', label: 'pnpm build', status, sessionId: 'sess_test', ...(progress !== undefined ? { progress } : {}) },
    });
    const started = fold([{ event: job('running', 'starting') }]);
    expect(started.blocks).toHaveLength(1);
    const settled = fold([{ event: job('running', 'still going') }, { event: job('completed') }], started);
    expect(settled.blocks).toHaveLength(1);
    expect(settled.blocks[0]).toMatchObject({ kind: 'job', job: { id: 'bash-1', status: 'completed' } });
  });

  it('keeps an open tasks list in step with the live updates', () => {
    // The 任务 page reads `state.jobs`, which `list_jobs` answers once. Without
    // the fold, a page opened before the job started would never show it and an
    // opened page would never see a row settle — the reader would have to press
    // refresh to watch work finish.
    const job = (status: 'running' | 'completed', progress?: string): KernelEvent => ({
      type: 'job_update',
      job: { id: 'bash-1', kind: 'bash', label: 'pnpm build', status, sessionId: 'sess_test', ...(progress !== undefined ? { progress } : {}) },
    });
    const opened = reduce(fold([{ event: job('running', 'starting') }]), {
      type: 'jobs',
      items: [{ id: 'bash-1', kind: 'bash', label: 'pnpm build', status: 'running', progress: 'starting' }],
    });
    const settled = fold([{ event: job('completed', 'done') }], opened);
    expect(settled.jobs).toEqual([{ id: 'bash-1', kind: 'bash', label: 'pnpm build', status: 'completed', sessionId: 'sess_test', progress: 'done' }]);
    // A page nobody opened stays unopened: the transcript row still appears,
    // but `jobs: null` must not turn into rows behind the reader's back.
    const closed = fold([{ event: job('running') }]);
    expect(closed.jobs).toBeNull();
  });
});

describe('reduce / history pagination', () => {
  it('ships the tail and reports how much is still unloaded', () => {
    const history: WireBlock[] = [{ kind: 'user', text: 'q3' }, { kind: 'text', text: 'a3' }];
    const state = reduce(initialState, { type: 'ready', info: readyInfo({ history, historyTotal: 40 }) });
    expect(state.historyLoaded).toBe(2);
    expect(state.historyTotal).toBe(40);
  });

  it('prepends an older batch and advances the cursor', () => {
    const state = reduce(
      reduce(initialState, { type: 'ready', info: readyInfo({ history: [{ kind: 'user', text: 'q3' }], historyTotal: 3 }) }),
      {
        type: 'history_earlier',
        blocks: [{ kind: 'user', text: 'q1' }, { kind: 'text', text: 'a1' }],
        total: 3,
      },
    );
    expect(state.blocks.map((b) => (b.kind === 'user' || b.kind === 'text' ? b.text : `<${b.kind}>`))).toEqual(['q1', 'a1', 'q3']);
    expect(state.historyLoaded).toBe(3);
  });

  it('marks an interrupted turn as a warning line, not as something the user said', () => {
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({ history: [{ kind: 'user', text: '跑一下' }, { kind: 'aborted' }] }),
    });
    expect(state.blocks.map((b) => b.kind)).toEqual(['user', 'hint']);
    expect(state.blocks[1]).toMatchObject({ tone: 'warn', text: expect.stringContaining('中断') });
  });

  it('rebuilds the job rows the kernel still tracks, and counts only log blocks as history', () => {
    const jobs = [{ id: 'bash-1', kind: 'bash' as const, label: 'pnpm test', status: 'running' as const, sessionId: 'sess_test' }];
    const state = reduce(initialState, {
      type: 'ready',
      info: readyInfo({ history: [{ kind: 'user', text: 'q1' }], historyTotal: 1, jobs }),
    });
    expect(state.blocks.map((b) => b.kind)).toEqual(['user', 'job']);
    expect(state.historyLoaded).toBe(1);
    // The pagination cursor counts baseline blocks, so a job row must not move it.
    expect(state.historyTotal - state.historyLoaded).toBe(0);
  });
});

describe('reduce / feed fidelity', () => {
  it('gives an unidentified progress line to the last running call, not to every one', () => {
    const state = fold([
      { event: { type: 'tool_call_start', turn: 1, call: CALL }, view: TERMINAL_CALL },
      { event: { type: 'tool_call_start', turn: 1, call: { ...CALL, id: 'c2' } }, view: TERMINAL_CALL },
      { event: { type: 'tool_progress', callId: undefined, text: 'half done' } },
    ]);
    expect(state.blocks[0]).not.toHaveProperty('tail');
    expect(state.blocks[1]).toMatchObject({ callId: 'c2', tail: 'half done' });
  });

  it('discards the partial output a re-request replaces, instead of appending to it', () => {
    const state = fold([
      { event: { type: 'text_delta', messageId: 'm', text: 'half of an answer' } },
      { event: { type: 'llm_retry', attempt: 1, maxRetries: 3, error: 'stream ended', stats: EMPTY_STATS } },
      { event: { type: 'text_delta', messageId: 'm', text: 'the whole answer' } },
    ]);
    expect(state.blocks.map((b) => b.kind)).toEqual(['hint', 'text']);
    expect(state.blocks[1]).toMatchObject({ text: 'the whole answer', streaming: true });
  });

  it('says why an unanswered approval went away, and stays quiet when the user answered', () => {
    const pending = fold([{ event: { type: 'approval_request', request: approvalRequest('ap1') } }]);
    const aborted = fold([{ event: { type: 'approval_resolved', id: 'ap1', resolution: { source: 'aborted' } } }], pending);
    expect(aborted.pendingApproval).toBeNull();
    expect(aborted.blocks.at(-1)).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('拒绝') });

    const answered = fold(
      [{ event: { type: 'approval_resolved', id: 'ap1', resolution: { source: 'user', answer: 'allow' } } }],
      pending,
    );
    expect(answered.pendingApproval).toBeNull();
    expect(answered.blocks.some((b) => b.kind === 'hint')).toBe(false);
  });

  it('labels a compaction with who asked for it and reports a failure as one', () => {
    expect(fold([{ event: { type: 'compaction', progress: { state: 'done', trigger: 'manual', retained: 3 } } }]).blocks[0]).toMatchObject({
      text: expect.stringContaining('手动'),
    });
    expect(fold([{ event: { type: 'compaction', progress: { state: 'done', trigger: 'auto', retained: 3 } } }]).blocks[0]).toMatchObject({
      text: expect.stringContaining('自动'),
    });
    const failed = fold([{ event: { type: 'compaction', progress: { state: 'error', trigger: 'auto', error: 'provider 500' } } }]);
    expect(failed.blocks[0]).toMatchObject({ kind: 'hint', tone: 'warn', text: expect.stringContaining('provider 500') });
  });

  it('names the notice before quoting the kernel, and warns about the ones that hurt', () => {
    const fused = fold([{ event: { type: 'notice', code: 'compact_fused', text: '已停用自动压缩' } }]).blocks[0];
    expect(fused).toMatchObject({ tone: 'warn', text: expect.stringContaining('压缩熔断') });
    const lagged = fold([{ event: { type: 'notice', code: 'surface_lagged', text: '窗口已重置' } }]).blocks[0];
    expect(lagged).toMatchObject({ tone: 'warn' });
    const compacted = fold([{ event: { type: 'notice', code: 'compacted', text: '已自动压缩' } }]).blocks[0];
    expect(compacted).toMatchObject({ tone: 'info' });
  });

  it('gives a nested subagent one row that grows in place, then reports its own totals', () => {
    const usage = { elapsedMs: 21_400, turns: 3, toolCalls: 2, promptTokens: 12_000, completionTokens: 800 };
    const state = fold([
      { event: { type: 'subagent_update', progress: { type: 'start', label: '探索 auth' } } },
      { event: { type: 'subagent_update', progress: { type: 'tool_call', label: '探索 auth', call: CALL } } },
      { event: { type: 'subagent_update', progress: { type: 'tool_call', label: '探索 auth', call: { ...CALL, id: 'c2' } } } },
      { event: { type: 'subagent_update', progress: { type: 'usage', label: '探索 auth', stats: EMPTY_STATS } } },
      { event: { type: 'subagent_update', progress: { type: 'done', label: '探索 auth', usage, status: 'completed' } } },
    ]);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ kind: 'sub', sub: { label: '探索 auth', status: 'completed', calls: 2, usage } });
  });

  it('keeps two concurrent delegations apart', () => {
    const state = fold([
      { event: { type: 'subagent_update', progress: { type: 'start', label: 'A' } } },
      { event: { type: 'subagent_update', progress: { type: 'start', label: 'B' } } },
      { event: { type: 'subagent_update', progress: { type: 'tool_call', label: 'A', call: CALL } } },
    ]);
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[0]).toMatchObject({ id: 'sub:A', sub: { calls: 1 } });
    expect(state.blocks[1]).toMatchObject({ id: 'sub:B', sub: { calls: 0, status: 'running' } });
  });
});

describe('reduce / model seat', () => {
  it('shows the catalog the host just sent, current model included', () => {
    const listed = reduce(baselined(), {
      type: 'models',
      groups: [{ id: 'endpoint', name: 'api.test', models: [{ id: 'm1', name: 'm1' }, { id: 'm2', name: 'Model Two', contextWindow: 4096 }] }],
      current: 'm2',
    });
    expect(listed.model).toBe('m2');
    expect(listed.modelSwitching).toBe(true);
    expect(listed.catalog).toMatchObject({ loading: false });
    expect(listed.catalog?.groups[0]?.models).toHaveLength(2);
  });

  it('marks the fetch in flight when the menu opens, and remembers a failure beside the rows', () => {
    const opened = reduce(baselined(), { type: 'sent', frame: { type: 'list_models' } });
    expect(opened.catalog).toMatchObject({ loading: true });
    const failed = reduce(opened, { type: 'models', groups: [], current: 'test-model', error: '站点未响应' });
    // The error is a state of the menu (it renders a retry), never a hint row
    // in the transcript — the transcript is the conversation, not the chrome.
    expect(failed.catalog).toMatchObject({ loading: false, error: '站点未响应' });
    expect(failed.blocks).toHaveLength(0);
  });

  it('lets the kernel event, not the pick, move the label and the gauge denominator', () => {
    const switched = fold([{ event: { type: 'model', model: 'm2', name: 'Model Two', contextWindow: 4096 } }], baselined());
    expect(switched.model).toBe('m2');
    expect(switched.modelName).toBe('Model Two');
    expect(switched.contextWindow).toBe(4096);
    // A model whose window nobody knows clears the denominator: an old model's
    // number would print a percentage that belongs to a model no longer in use.
    const unknown = fold([{ event: { type: 'model', model: 'm3' } }], switched);
    expect(unknown.model).toBe('m3');
    expect(unknown.modelName).toBeNull(); // no stale "Model Two" over m3
    expect(unknown.contextWindow).toBeNull();
  });

  it('re-baselines the seat on a session switch: ready is the authority, the catalog is stale', () => {
    const listed = reduce(baselined(), {
      type: 'models',
      groups: [{ id: 'endpoint', name: 'api.test', models: [{ id: 'm1', name: 'm1' }] }],
      current: 'm1',
    });
    const next = reduce(listed, { type: 'ready', info: readyInfo({ model: 'other-model', modelSwitching: false }) });
    expect(next.model).toBe('other-model');
    expect(next.modelSwitching).toBe(false);
    // Another session may sit behind another endpoint; the old list must not
    // survive to offer models this one cannot reach.
    expect(next.catalog).toBeNull();
  });
});

describe('reduce / directory browser', () => {
  const LEVEL = {
    path: 'D:/home/proj',
    home: 'D:/home',
    parent: 'D:/home',
    crumbs: [
      { name: 'home', path: 'D:/home' },
      { name: 'proj', path: 'D:/home/proj' },
    ],
    roots: [{ name: 'C:\\', path: 'C:\\' }, { name: 'D:\\', path: 'D:\\' }],
    entries: [{ name: 'src', path: 'D:/home/proj/src', hidden: false }],
    truncated: false,
  };

  it('opens an empty sheet: open alone asks for nothing yet', () => {
    const opened = reduce(initialState, { type: 'directory_open', open: true });
    // The dialog mounts into a placeholder and the component sends the first
    // `list_directory` itself; until that lands there is no level and nothing
    // is in flight.
    expect(opened.directory).toMatchObject({ level: null, error: null, pending: false });
  });

  it('marks the navigation in flight and lands the level whole', () => {
    const asked = reduce(
      reduce(initialState, { type: 'directory_open', open: true }),
      { type: 'directory_ask' },
    );
    expect(asked.directory).toMatchObject({ pending: true, error: null });
    const listed = reduce(asked, { type: 'directory', level: LEVEL });
    expect(listed.directory).toMatchObject({ pending: false, error: null });
    expect(listed.directory?.level?.path).toBe('D:/home/proj');
    expect(listed.directory?.level?.entries).toHaveLength(1);
  });

  it('keeps the previous level on a refusal and states the reason beside it', () => {
    // "Cannot look" and "nothing here" are different facts, so a failed
    // navigation returns the user to where they were with the reason shown,
    // never to a blank sheet.
    const listed = reduce(reduce(initialState, { type: 'directory_open', open: true }), {
      type: 'directory',
      level: LEVEL,
    });
    const refused = reduce(listed, { type: 'directory_error', message: '目录不存在：D:/nope' });
    expect(refused.directory?.level?.path).toBe('D:/home/proj');
    expect(refused.directory?.error).toBe('目录不存在：D:/nope');
    expect(refused.directory?.pending).toBe(false);
  });

  it('drops everything on close: the next open re-asks instead of showing a stale tree', () => {
    // The host may have changed underneath while the dialog was closed (another
    // tool created a folder); a tree shown as current when it is not is worse
    // than one re-asked for.
    const listed = reduce(reduce(initialState, { type: 'directory_open', open: true }), {
      type: 'directory',
      level: LEVEL,
    });
    const closed = reduce(listed, { type: 'directory_open', open: false });
    expect(closed.directory).toBeNull();
  });

  it('an answer to the TREE’s own ask does not open the picker', () => {
    // The right panel's 文件 page asks `list_directory` for the session's
    // workspace, and that answer arrives on the same frame the picker listens
    // for. Filling the picker's slot from it drew 「选择工作区文件夹」 over a session
    // that already had a workspace — the reported 「文件页面居然需要我再选择一遍」 —
    // every time the panel was opened. The tree still gets its level: one frame,
    // two readers, and only a GESTURE opens a dialog.
    const listed = reduce(initialState, { type: 'directory', level: LEVEL });
    expect(listed.directory).toBeNull();
    expect(listed.tree.levels[LEVEL.path]?.status).toBe('ready');
    const refused = reduce(initialState, { type: 'directory_error', message: '目录不存在：D:/nope' });
    expect(refused.directory).toBeNull();
  });

  it('a mid-ask marker from nowhere cannot conjure the dialog either', () => {
    // `directory_ask` has exactly one caller (the open dialog's own effect);
    // anything else dispatching it must not be able to open a dialog.
    expect(reduce(initialState, { type: 'directory_ask' }).directory).toBeNull();
  });
});

describe('reduce / native pick', () => {
  it('a pick ask marks in flight; the reply settles it and carries its reading', () => {
    const asked = reduce(initialState, {
      type: 'sent',
      frame: { type: 'pick_file' },
    });
    expect(asked.pickPending).toBe(true);
    const picked = reduce(asked, { type: 'picked', kind: 'file', path: 'D:\\notes\\a.md' });
    expect(picked.pickPending).toBe(false);
    expect(picked.pick).toEqual({ kind: 'file', path: 'D:\\notes\\a.md' });
  });
  it('unavailable and cancel are the two no-path readings, kept distinct', () => {
    const unavailable = reduce(initialState, {
      type: 'picked',
      kind: 'directory',
      error: 'spawn zenity ENOENT',
    });
    expect(unavailable.pick).toEqual({ kind: 'directory', error: 'spawn zenity ENOENT' });
    const cancelled = reduce(initialState, { type: 'picked', kind: 'file' });
    expect(cancelled.pick).toEqual({ kind: 'file' });
  });
  it('a disconnect settles a stuck pick: the reply cannot arrive', () => {
    const asked = reduce(initialState, { type: 'sent', frame: { type: 'pick_directory' } });
    const dropped = reduce(asked, { type: 'connection', connected: false });
    expect(dropped.pickPending).toBe(false);
  });
});

describe('reduce / editor documents', () => {
  const READ = { type: 'read_entry', path: 'D:/w/README.md' } as const;

  it('a read going out opens the document; the answer settles the one already open', () => {
    // The gesture has ONE owner: the reducer sees the request leave, so the doc
    // enters as `loading` HERE and the host's `entry` only settles it. Nothing
    // dispatched an `editor_open` before this, so every tree-row click sent the
    // frame and opened nothing — the preview beside the tree stayed empty and
    // the file never appeared (the reported 「点击文件后开启」 failure).
    const asked = reduce(initialState, { type: 'sent', frame: READ });
    expect(asked.editor.docs.map((doc) => doc.path)).toEqual(['D:/w/README.md']);
    expect(asked.editor.active).toBe('D:/w/README.md');
    expect(asked.editor.docs[0]).toMatchObject({ loading: true, text: '' });
    const loaded = reduce(asked, {
      type: 'entry',
      path: 'D:/w/README.md',
      text: '# hi',
      bytes: 4,
      truncated: false,
      binary: false,
    });
    expect(loaded.editor.docs[0]).toMatchObject({ loading: false, text: '# hi', bytes: 4 });
  });

  it('an answer for a path nobody opened cannot conjure a document', () => {
    // The mirror of the rule above: a frame is not a gesture. A read's answer
    // only ever settles a document that the request already put there.
    const stray = reduce(initialState, {
      type: 'entry',
      path: 'D:/w/other.md',
      text: 'x',
      bytes: 1,
      truncated: false,
      binary: false,
    });
    expect(stray.editor.docs).toEqual([]);
    const refused = reduce(initialState, { type: 'entry_error', path: 'D:/w/other.md', message: '不在工作区内' });
    expect(refused.editor.docs).toEqual([]);
  });

  it('a refusal settles the open document with its reason, and keeps it open', () => {
    const asked = reduce(initialState, { type: 'sent', frame: READ });
    const refused = reduce(asked, { type: 'entry_error', path: 'D:/w/README.md', message: '文件过大' });
    expect(refused.editor.docs[0]).toMatchObject({ loading: false, error: '文件过大' });
    expect(refused.editor.active).toBe('D:/w/README.md');
  });

  it('re-reading an open document re-activates it instead of duplicating it', () => {
    const first = reduce(initialState, { type: 'sent', frame: READ });
    const again = reduce(first, { type: 'sent', frame: READ });
    expect(again.editor.docs).toHaveLength(1);
  });
});

describe('event classification is total', () => {
  it('names every KernelEvent variant exactly once', () => {
    // This list is the contract `classifyEvent` enforces at the type level: the
    // reducer must decide what each channel does, and a variant nobody classified
    // would be a feature the user cannot see. `assertNever` in state-events.ts
    // makes an omission a COMPILE error; this test makes the same fact visible
    // here, and fails if a variant is added and this list is not updated.
    const everyVariant = [
      // AgentEvent (the 11 passthroughs)
      'turn_start', 'text_delta', 'reasoning_delta', 'message', 'tool_call_start',
      'tool_call_result', 'usage', 'turn_aborted', 'llm_retry', 'empty_completion', 'done',
      // kernel additions
      'user_message', 'phase', 'approval_request', 'approval_resolved', 'question_request',
      'question_resolved', 'tool_progress', 'subagent_update', 'job_update', 'queue_update',
      'todo', 'model', 'command', 'compaction', 'run_failed', 'run_stats', 'notice',
    ] as const;
    expect(everyVariant.length).toBe(28);
    // `message` and `turn_aborted` are the only two the reducer does not draw, and
    // each has a stated reason rather than an accidental gap.
    const ignored = everyVariant.filter((type) => isIgnoredEvent({ type } as KernelEvent));
    expect([...ignored].sort()).toEqual(['message', 'turn_aborted']);
  });

  it('labels only real notice codes, never an inherited object member', () => {
    // `NOTICE_LABELS['constructor']` returns `Object` from the prototype chain, so
    // a bare lookup guarded by an `undefined` check would pass and render
    // "undefined · <text>". A code that is not a key must fall back to the
    // kernel's own text with no label prepended.
    for (const code of ['constructor', 'toString', 'valueOf', '__proto__']) {
      const block = fold([{ event: { type: 'notice', code, text: '正文' } as KernelEvent }]).blocks.at(-1);
      expect(block).toMatchObject({ kind: 'hint' });
      expect(block?.kind === 'hint' ? block.text : '').toBe('正文');
    }
    // A real code still gets its label.
    const known = fold([{ event: { type: 'notice', code: 'compacted', text: '正文' } as KernelEvent }]).blocks.at(-1);
    expect(known?.kind === 'hint' ? known.text : '').toBe('压缩 · 正文');
  });
});