/**
 * The exact scenario the user reported: switch or delete a session WHILE
 * another session's run is still in flight.
 *
 * A session that is switched away from keeps running — that is deliberate (the
 * work is not lost, and resuming shows the finished result). The danger is the
 * other half: its still-live events must never paint the session now on screen.
 * These tests hold a run open with a gate so the switch provably happens
 * mid-flight, which is the only way to observe the leak.
 */
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClientFrame } from '../src/client-frame.js';
import { type ClientFrame, type ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import { WebController } from '../src/controller.js';
import { bootController } from './controller-rig.js';
import type { ChatProvider, JobOutcome, JobRegistry, StreamEvent } from '@nova-agent/core';

/**
 * A provider whose second call parks on a gate the test opens by hand, so a
 * switch can happen while a run is genuinely in flight.
 */
function gatedProvider(): {
  provider: ChatProvider;
  release: () => void;
  started: () => number;
} {
  let call = 0;
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const provider: ChatProvider = {
    async *stream(): AsyncGenerator<StreamEvent> {
      const index = call;
      call += 1;
      if (index === 0) {
        // The FIRST session's run: emit its opener, then park forever.
        yield { type: 'text_delta', text: 'A-FIRST' };
        await gate;
        yield { type: 'text_delta', text: 'A-LATE' };
        yield { type: 'finish', finishReason: 'stop' };
        return;
      }
      // Every later run answers immediately and identifies itself.
      yield { type: 'text_delta', text: 'B-REPLY' };
      yield { type: 'finish', finishReason: 'stop' };
    },
  };
  return {
    provider,
    release: () => { releaseGate?.(); },
    started: () => call,
  };
}

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  closed = 0;
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {
    this.closed += 1;
  }
  text(): string {
    return JSON.stringify(this.frames);
  }
  /** Every text delta seen, in order — the surface's visible output. */
  deltas(): string[] {
    return this.frames
      .filter((f): f is Extract<ServerFrame, { type: 'event' }> => f.type === 'event')
      .filter((f) => f.event.type === 'text_delta')
      .map((f) => (f.event as { text: string }).text);
  }
}

async function withFakeHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-mid-home-'));
  const prevProfile = process.env['USERPROFILE'];
  const prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn();
  } finally {
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
  }
}

async function send(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

/** Let queued microtasks/timers run so the stream makes progress. */
async function tick(ms = 60): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function makeController(provider: ChatProvider): Promise<WebController> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-mid-root-'));
  return bootController({
    rootDir,
    provider,
    config: { approval: 'full' },
    providerModelLabel: 'test-model',
  });
}

describe('switching while a run is in flight', () => {
  it('a switched-away session\'s LATE events never reach the surface', async () => {
    await withFakeHome(async () => {
      const { provider, release } = gatedProvider();
      const controller = await makeController(provider);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        // Session A starts a run that will park.
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        expect(conn.deltas()).toContain('A-FIRST');
        const fileA = controller.agent.session.file;

        // Switch to a FRESH session while A is still parked mid-run.
        await send(controller, conn, { type: 'new_session' });
        const afterSwitch = conn.deltas().length;

        // Now let A's run finish. Its remaining output belongs to A only.
        release();
        await tick(200);

        const late = conn.deltas().slice(afterSwitch);
        // The decisive assertion: the new session must not show A's late output.
        expect(late).not.toContain('A-LATE');
        expect(fileA).not.toBe(controller.agent.session.file);
      } finally {
        release();
        await controller.dispose();
      }
    });
  });

  it('the old session\'s finished work is still recoverable by resuming it', async () => {
    // The complement: suppressing the live leak must not mean losing the work.
    await withFakeHome(async () => {
      const { provider, release } = gatedProvider();
      const controller = await makeController(provider);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const fileA = controller.agent.session.file;
        await send(controller, conn, { type: 'new_session' });
        release();
        await tick(250);
        // Reopen A: its reply must be in the baseline.
        await send(controller, conn, { type: 'resume', file: fileA });
        await tick(120);
        expect(conn.text()).toContain('A-LATE');
      } finally {
        release();
        await controller.dispose();
      }
    });
  });

  it('deleting a session that is NOT open leaves the open one untouched', async () => {
    await withFakeHome(async () => {
      const { provider, release } = gatedProvider();
      const controller = await makeController(provider);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        // Create a second session so there is a non-open log to delete.
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const fileA = controller.agent.session.file;
        await send(controller, conn, { type: 'new_session' });
        const fileB = controller.agent.session.file;
        expect(fileA).not.toBe(fileB);

        // Delete A while B is open: B must be unaffected and stay current.
        await send(controller, conn, { type: 'delete_session', file: fileA });
        await tick(60);
        expect(controller.agent.session.file).toBe(fileB);

        // And B must still work: a prompt after the delete reaches its own log.
        await send(controller, conn, { type: 'prompt', text: 'B continues' });
        await tick(150);
        expect(conn.text()).toContain('B-REPLY');
      } finally {
        release();
        await controller.dispose();
      }
    });
  });

  it('deleting the OPEN session mid-run leaves no log for the run to resurrect', async () => {
    // The delete is the last word on the log. A switch deliberately leaves the
    // old session running (see the first test), but a DELETE of the open
    // session's log takes that work with it — so the handle must be disposed
    // before the unlink. Otherwise the still-running turn commits its assistant
    // message to the path it holds, and `appendFile` CREATES the missing file:
    // the log comes back holding only the post-delete events, listed as a
    // session that looks truncated and is not the one the user deleted.
    await withFakeHome(async () => {
      const { provider, release } = gatedProvider();
      const controller = await makeController(provider);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const fileA = controller.agent.session.file;
        expect(existsSync(fileA)).toBe(true);

        // Delete the OPEN session while its run is parked mid-flight.
        await send(controller, conn, { type: 'delete_session', file: fileA });
        expect(existsSync(fileA)).toBe(false);

        // Now let the parked run finish: its commit must not recreate the log.
        release();
        await tick(300);
        expect(existsSync(fileA)).toBe(false);

        // And the surface is on a usable session, not the deleted one.
        expect(controller.agent.session.file).not.toBe(fileA);
      } finally {
        release();
        await controller.dispose();
      }
    });
  });

  it('deleting the open session mid-run does not leak its jobs into the new one', async () => {
    // A job belongs to the session that started it, and a deleted session has
    // nowhere to report — so its running work is cancelled with it rather than
    // inherited by the replacement session.
    await withFakeHome(async () => {
      const { provider, release } = gatedProvider();
      const controller = await makeController(provider);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const idA = controller.agent.session.id;
        const registry = (controller.agent as unknown as {
          deps: { jobs: JobRegistry };
        }).deps.jobs;
        // A job that never settles on its own: the delete must cancel it. Its
        // `done` is resolved by the cancel handler, which is what makes the
        // teardown (which awaits producers) terminate instead of hanging.
        let settle: (o: JobOutcome) => void = () => undefined;
        const done = new Promise<JobOutcome>((resolve) => { settle = resolve; });
        const started = registry.start({
          kind: 'bash',
          label: 'belongs to A',
          sessionId: idA,
          cancel: () => settle({ status: 'killed' }),
          done,
        });
        const fileA = controller.agent.session.file;

        await send(controller, conn, { type: 'delete_session', file: fileA });
        await tick(150);
        const idB = controller.agent.session.id;
        expect(idB).not.toBe(idA);
        // The new session does not inherit A's job.
        expect(controller.agent.jobSnapshots().map((j) => j.id)).not.toContain(started.id);
        // A's job was cancelled, not left running with nowhere to report.
        expect(registry.get(started.id)?.status).toBe('killed');
      } finally {
        release();
        await controller.dispose();
      }
    });
  });
});
