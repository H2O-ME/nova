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
});