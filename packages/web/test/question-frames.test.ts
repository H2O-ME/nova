/**
 * The question seam over the wire: the two client frames, the `ready` field that
 * lets a reattaching browser release a suspended run, and the round trip through
 * the router.
 *
 * The last test is the one that matters: a client that reattaches AFTER the ask
 * has to be able to answer it. If `ready` did not carry `pendingQuestions`, the
 * run would be parked with an idle-looking session and no card — the browser's
 * version of the "declared event, no producer" bug.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, KernelEvent, StreamEvent } from '@nova-agent/core';
import { parseClientFrame } from '../src/client-frame.js';
import { serializeServerFrame, type ClientFrame, type ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import { WebController } from '../src/controller.js';

const QUESTIONS = [
  { id: 'mode', question: 'Which mode?', options: [{ label: 'Fast' }, { label: 'Thorough (Recommended)' }] },
];

function scriptedProvider(scripts: StreamEvent[][]): ChatProvider {
  let call = 0;
  return {
    async *stream() {
      const events = scripts[call] ?? [];
      call += 1;
      for (const ev of events) yield ev;
    },
  };
}

const ASK_TURN: StreamEvent[] = [
  {
    type: 'tool_call_delta',
    index: 0,
    id: 'c1',
    name: 'ask_user_question',
    argsDelta: JSON.stringify({ questions: QUESTIONS }),
  },
  { type: 'finish', finishReason: 'tool_calls' },
];
const CLOSING: StreamEvent[] = [
  { type: 'text_delta', text: 'ok' },
  { type: 'finish', finishReason: 'stop' },
];

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  events(): KernelEvent[] {
    return this.frames.filter((f) => f.type === 'event').map((f) => (f as { event: KernelEvent }).event);
  }
  waitFor(pred: (frames: ServerFrame[]) => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, rejectPromise) => {
      const tick = (): void => {
        if (pred(this.frames)) resolve();
        else if (Date.now() - start > ms) rejectPromise(new Error('FakeConn.waitFor timed out'));
        else setTimeout(tick, 5);
      };
      tick();
    });
  }
}

async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-web-q-'));
  const prevProfile = process.env['USERPROFILE'];
  const prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn(home);
  } finally {
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
  }
}

async function makeController(scripts: StreamEvent[][]): Promise<WebController> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-q-root-'));
  return WebController.create({
    rootDir,
    provider: scriptedProvider(scripts),
    config: { approval: 'read-only' },
    providerModelLabel: 'test-model',
  });
}

async function handle(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

describe('parseClientFrame — resolve_question / cancel_question', () => {
  // The parser returns the frame itself on success and a `{ ok: false, reason }`
  // rejection otherwise, so the discriminator is the `ok` key's PRESENCE.
  const parse = (frame: unknown): { ok: true; value: ClientFrame } | { ok: false; reason: string } => {
    const out = parseClientFrame(JSON.stringify(frame));
    return 'ok' in out ? { ok: false, reason: out.reason } : { ok: true, value: out };
  };

  it('accepts a well-formed answer and a dismissal', () => {
    const answer = parse({
      type: 'resolve_question',
      id: 'qst_1',
      answer: { answers: [{ id: 'mode', selected: ['Fast'] }] },
    });
    expect(answer.ok && answer.value).toEqual({
      type: 'resolve_question',
      id: 'qst_1',
      answer: { answers: [{ id: 'mode', selected: ['Fast'] }] },
    });
    const cancel = parse({ type: 'cancel_question', id: 'qst_1' });
    expect(cancel.ok && cancel.value).toEqual({ type: 'cancel_question', id: 'qst_1' });
  });

  it('refuses a malformed id or answer with a reason, never a silent truncation', () => {
    const bad: [unknown, RegExp][] = [
      [{ type: 'resolve_question', id: '', answer: { answers: [] } }, /resolve_question\.id/],
      [{ type: 'resolve_question', id: 'q q', answer: { answers: [] } }, /resolve_question\.id/],
      [{ type: 'cancel_question', id: 7 }, /cancel_question\.id/],
      [{ type: 'resolve_question', id: 'qst_1' }, /resolve_question\.answer/],
      [{ type: 'resolve_question', id: 'qst_1', answer: {} }, /resolve_question\.answer/],
      [{ type: 'resolve_question', id: 'qst_1', answer: { answers: [{ id: 'x' }] } }, /resolve_question\.answer/],
      [{ type: 'resolve_question', id: 'qst_1', answer: { answers: [{ id: 'x', selected: ['a\u0000'] }] } }, /resolve_question\.answer/],
    ];
    for (const [frame, pattern] of bad) {
      const out = parse(frame);
      expect(out.ok, JSON.stringify(frame)).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(pattern);
    }
  });
});

describe('WebController question round trip', () => {
  it('publishes question_request, answers it, and delivers the answer to the model', async () => {
    await withFakeHome(async () => {
      const controller = await makeController([ASK_TURN, CLOSING]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'ask me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_request'));
      const event = conn.events().find((e) => e.type === 'question_request');
      if (event?.type !== 'question_request') throw new Error('no question');
      // Serialization survives the round trip: the request the browser renders is
      // the one the kernel published, questions and all.
      expect(event.request.questions[0]?.question).toBe('Which mode?');

      await handle(controller, conn, {
        type: 'resolve_question',
        id: event.request.id,
        answer: { answers: [{ id: 'mode', selected: ['Fast'] }] },
      });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const result = conn.events().find((e) => e.type === 'tool_call_result');
      if (result?.type !== 'tool_call_result') throw new Error('no tool result');
      expect(result.result.content).toBe(JSON.stringify({ answers: [{ id: 'mode', selected: ['Fast'] }] }));
      expect(conn.events().some((e) => e.type === 'question_resolved')).toBe(true);
      await controller.dispose();
    });
  });

  it('restores an outstanding question in ready so a reattaching client can still answer', async () => {
    await withFakeHome(async () => {
      const controller = await makeController([ASK_TURN, CLOSING]);
      const first = new FakeConn();
      controller.attach(first);
      await handle(controller, first, { type: 'prompt', text: 'ask me' });
      await first.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_request'));
      controller.detach(first);

      // A second socket attaches while the run is suspended. Without the
      // baseline carrying the ask, this client sees an idle session and the run
      // has no way out.
      const second = new FakeConn();
      controller.attach(second);
      const ready = second.frames.find((f) => f.type === 'ready');
      if (ready?.type !== 'ready') throw new Error('no ready');
      expect(ready.info.pendingQuestions).toHaveLength(1);
      const pending = ready.info.pendingQuestions[0];
      expect(pending?.questions[0]?.question).toBe('Which mode?');

      await handle(controller, second, {
        type: 'resolve_question',
        id: pending?.id ?? '',
        answer: { answers: [{ id: 'mode', selected: ['Thorough (Recommended)'] }] },
      });
      await second.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      expect(second.info?.pendingQuestions ?? []).toEqual([]);
      await controller.dispose();
    });
  });

  it('converges a suspended ask to aborted when the run is interrupted', async () => {
    await withFakeHome(async () => {
      const controller = await makeController([ASK_TURN, CLOSING]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'ask me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_request'));
      controller.agent.abort();
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_resolved'));
      // Fail-closed over the wire: the browser learns the ask is gone, so it can
      // drop the card instead of leaving a dead dialog on screen.
      const resolved = conn.events().find((e) => e.type === 'question_resolved');
      expect(resolved).toMatchObject({ resolution: { source: 'aborted' } });
      await controller.dispose();
    });
  });

  it('unknown question ids and invalid answers get an error frame, never a settled wait', async () => {
    await withFakeHome(async () => {
      const controller = await makeController([ASK_TURN, CLOSING]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'ask me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_request'));
      const event = conn.events().find((e) => e.type === 'question_request');
      if (event?.type !== 'question_request') throw new Error('no question');

      // An answer naming a label that was never offered: refused by the broker,
      // which holds the request — the wire parser cannot see that.
      await handle(controller, conn, {
        type: 'resolve_question',
        id: event.request.id,
        answer: { answers: [{ id: 'mode', selected: ['Never offered'] }] },
      });
      expect(conn.frames.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining(event.request.id) });
      expect(controller.agent.pendingQuestions()).toHaveLength(1);

      await handle(controller, conn, { type: 'cancel_question', id: 'qst_missing' });
      expect(conn.frames.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('qst_missing') });
      await controller.dispose();
    });
  });

  it('a dismissal reaches the model as the kernel\'s cancel text', async () => {
    await withFakeHome(async () => {
      const controller = await makeController([ASK_TURN, CLOSING]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'ask me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'question_request'));
      const event = conn.events().find((e) => e.type === 'question_request');
      if (event?.type !== 'question_request') throw new Error('no question');
      await handle(controller, conn, { type: 'cancel_question', id: event.request.id });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const result = conn.events().find((e) => e.type === 'tool_call_result');
      if (result?.type !== 'tool_call_result') throw new Error('no tool result');
      expect(result.result.content).toContain('cancelled');
      expect(conn.events().find((e) => e.type === 'question_resolved')).toMatchObject({
        resolution: { source: 'cancelled' },
      });
      await controller.dispose();
    });
  });

  it('serializes both frame kinds (the wire asserts the shape)', () => {
    expect(JSON.parse(serializeServerFrame({ type: 'error', message: 'x' }))).toEqual({ type: 'error', message: 'x' });
    const answer = parseClientFrame(JSON.stringify({
      type: 'resolve_question',
      id: 'qst_1',
      answer: { answers: [{ id: 'a', selected: [], custom: 'my own answer' }] },
    }));
    expect('ok' in answer).toBe(false);
    expect(answer.type === 'resolve_question' ? answer.answer.answers[0]?.custom : undefined).toBe('my own answer');
  });
});
