import { describe, expect, it } from 'vitest';
import type { ServerFrame } from '../../src/protocol.js';
import { emptyTotals } from '../../src/totals.js';
import { frameAction } from '../src/frame-actions.js';

/**
 * The routing table between the socket and the reducer. Its value is
 * exhaustiveness — a `ServerFrame` variant with no mapper fails to compile — so
 * these tests check the routing itself: each frame lands as the action the
 * reducer expects, fields survive, and nothing is routed to `null` by accident.
 */
describe('frameAction', () => {
  it('routes a trace page into the trace slice', () => {
    // The regression this table was built for: the frame existed, the reducer
    // case existed, and the socket routed it nowhere.
    const frame: ServerFrame = {
      type: 'trace',
      rows: [{ kind: 'workspace', ts: 7, path: 'D:/w' }],
      total: 3,
    };
    expect(frameAction(frame)).toEqual({ type: 'trace', rows: frame.rows, total: 3 });
  });

  it('carries a ready baseline through whole', () => {
    const frame: ServerFrame = {
      type: 'ready',
      info: {
        rootDir: 'D:/w',
        sessionFile: 's.jsonl',
        model: 'm',
        approvalMode: 'read-only',
        codeMode: 'native',
        history: [],
        historyTotal: 0,
        traceTotal: 2,
        pendingApprovals: [],
        pendingQuestions: [],
        jobs: [],
        usedTokens: 0,
        modelSwitching: false,
        commands: [],
        runTotals: emptyTotals,
      },
    };
    const action = frameAction(frame);
    expect(action).toMatchObject({ type: 'ready' });
    expect(action?.type === 'ready' ? action.info.traceTotal : -1).toBe(2);
  });

  it('keeps the optional halves of an event frame optional', () => {
    const action = frameAction({ type: 'event', event: { type: 'turn_start' } } as ServerFrame);
    expect(action).toMatchObject({ type: 'event' });
    expect(action?.type === 'event' ? action.view : 'x').toBeUndefined();
  });

  it('routes the pagination and state answers', () => {
    expect(frameAction({ type: 'history_earlier', blocks: [], total: 5 })).toEqual({
      type: 'history_earlier',
      blocks: [],
      total: 5,
    });
    expect(frameAction({ type: 'state', approvalMode: 'full', codeMode: 'ptc', model: 'm' })).toEqual({
      type: 'state',
      approvalMode: 'full',
      codeMode: 'ptc',
      model: 'm',
    });
    expect(frameAction({ type: 'error', message: 'boom' })).toEqual({ type: 'error', message: 'boom' });
  });

  it('routes a context reading, and a null reading as a real value', () => {
    // The Context panel's on/off travels as `null` — the plugin is off — and
    // must not be routed as "no action" (the pane would keep drawing a snapshot
    // that stopped moving, and its tab would never go away).
    expect(frameAction({ type: 'context', timeline: null })).toEqual({ type: 'context', timeline: null });
    const timeline = {
      truncated: false,
      live: { cats: { system: 1, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0 }, total: 1, elements: [] },
      counts: { requests: 0, turns: 0, toolCalls: 0, compactions: 0 },
      points: [],
      events: [],
      files: [],
    };
    expect(frameAction({ type: 'context', timeline })).toEqual({ type: 'context', timeline });
  });

  it('routes a listed directory level whole, optional parent preserved', () => {
    const frame: ServerFrame = {
      type: 'directory',
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
    expect(frameAction(frame)).toEqual({
      type: 'directory',
      level: {
        path: 'D:/home/proj',
        home: 'D:/home',
        parent: 'D:/home',
        crumbs: frame.crumbs,
        roots: frame.roots,
        entries: frame.entries,
        truncated: false,
      },
    });
  });

  it('routes a directory refusal as the error action', () => {
    expect(frameAction({ type: 'directory_error', message: '目录不存在：D:/nope' })).toEqual({
      type: 'directory_error',
      message: '目录不存在：D:/nope',
    });
  });

  it('ignores a frame whose type is an inherited member name', () => {
    // The regression this pins: the lookup was a bare `MAPPERS[frame.type]`, and
    // nothing validates the discriminant between `JSON.parse` and here
    // (`client.ts` casts the socket payload). For a `type` naming an
    // `Object.prototype` member the lookup returned a FUNCTION and called it as a
    // mapper: `valueOf` / `hasOwnProperty` threw `TypeError: Cannot convert
    // undefined or null to object` from inside the socket's `onmessage`, and
    // `constructor` returned a bogus action that fell off the reducer's `switch`,
    // leaving state `undefined`. An unrecognized frame must be ignored.
    for (const hostile of ['constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'toString', '__proto__']) {
      const frame = { type: hostile } as unknown as ServerFrame;
      expect(() => frameAction(frame), hostile).not.toThrow();
      expect(frameAction(frame), hostile).toBeNull();
    }
  });

  it('still routes recognized frames and ignores merely unknown ones', () => {
    // The guard must not over-reject: a real frame and a plain unknown string
    // both behave as before (route / ignore).
    expect(frameAction({ type: 'error', message: 'boom' })).toEqual({ type: 'error', message: 'boom' });
    expect(frameAction({ type: 'not_a_real_frame' } as unknown as ServerFrame)).toBeNull();
  });
});