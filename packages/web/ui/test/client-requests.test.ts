/**
 * The request hub: the three invariants that make it safe to have no correlation
 * id on most reply frames.
 *
 * This module is what four `fetch()` calls became, so a wrong answer here is a
 * silent "the dashboard card never loads" rather than a crash — exactly the
 * class of bug that needs a contract test instead of a manual smoke.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearFrameSender,
  deliverServerFrame,
  dropPendingRequests,
  requestFrame,
  setFrameSender,
} from '../src/client/requests.js';

const sent: unknown[] = [];
const sender = (frame: unknown): boolean => {
  sent.push(frame);
  return true;
};

beforeEach(() => {
  sent.length = 0;
  dropPendingRequests();
  setFrameSender(sender);
});

afterEach(() => {
  // Order matters: the sender is cleared by identity, so it has to be the same
  // reference that was registered — a fresh arrow would leave the old one live.
  clearFrameSender(sender);
  dropPendingRequests();
});

describe('requestFrame', () => {
  it('resolves with the reply of its own type', async () => {
    const pending = requestFrame({ type: 'dashboard' }, 'dashboard');
    // The send happens inside the promise executor, so let the microtask run
    // before asserting on what left.
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'dashboard' }]);
    // A frame of another type must not settle it.
    expect(deliverServerFrame({ type: 'sessions', items: [] })).toBe(false);
    expect(deliverServerFrame({ type: 'dashboard', ok: true, aggregate: { sessions: 3 } })).toBe(true);
    const reply = await pending;
    expect(reply).toMatchObject({ ok: true });
  });

  it('serializes replies of a kind that carries no correlation id', async () => {
    // `context_window` has no id field, so two in-flight requests would be
    // ambiguous. The hub queues them instead, and the FIRST reply must settle
    // the FIRST request — not whoever happened to arrive last.
    const first = requestFrame({ type: 'context_window', session: '/a.jsonl', seq: 1 }, 'context_window');
    const second = requestFrame({ type: 'context_window', session: '/b.jsonl', seq: 2 }, 'context_window');
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    deliverServerFrame({ type: 'context_window', ok: true, snapshot: { seq: 1 } });
    expect(await first).toMatchObject({ snapshot: { seq: 1 } });
    // The queued one is sent only once the first settled.
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    deliverServerFrame({ type: 'context_window', ok: true, snapshot: { seq: 2 } });
    expect(await second).toMatchObject({ snapshot: { seq: 2 } });
  });

  it('lets a matched kind run concurrently, keyed by the reply itself', async () => {
    // `image_data` echoes the id, so two image reads may overlap — and a reply
    // must land on ITS request, not the oldest.
    const a = requestFrame({ type: 'image_bytes', id: 'sha256:a' }, 'image_data', {
      match: (frame) => frame.id === 'sha256:a',
    });
    const b = requestFrame({ type: 'image_bytes', id: 'sha256:b' }, 'image_data', {
      match: (frame) => frame.id === 'sha256:b',
    });
    await Promise.resolve();
    expect(sent).toHaveLength(2);
    deliverServerFrame({ type: 'image_data', ok: true, id: 'sha256:b', data: 'B' });
    expect(await b).toMatchObject({ data: 'B' });
    deliverServerFrame({ type: 'image_data', ok: true, id: 'sha256:a', data: 'A' });
    expect(await a).toMatchObject({ data: 'A' });
  });

  it('resolves undefined instead of hanging when the frame cannot be sent', async () => {
    setFrameSender(() => false);
    expect(await requestFrame({ type: 'dashboard' }, 'dashboard')).toBeUndefined();
  });

  it('resolves undefined on timeout, and drops the pending entry', async () => {
    const reply = await requestFrame({ type: 'dashboard' }, 'dashboard', { timeoutMs: 10 });
    expect(reply).toBeUndefined();
    // The dead entry must not swallow a later, unrelated reply.
    expect(deliverServerFrame({ type: 'dashboard', ok: true })).toBe(false);
  });

  it('fails every in-flight request at once on disconnect', async () => {
    const a = requestFrame({ type: 'dashboard' }, 'dashboard');
    const b = requestFrame({ type: 'image_bytes', id: 'sha256:c' }, 'image_data', {
      match: (frame) => frame.id === 'sha256:c',
    });
    dropPendingRequests();
    expect(await a).toBeUndefined();
    expect(await b).toBeUndefined();
  });
});
