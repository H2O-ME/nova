/**
 * Background jobs are the one session-scoped resource that lives on a SHARED
 * registry, which is where cross-talk actually comes from.
 *
 * A bash `run_in_background` belongs to the session that started it. But the
 * registry is per-kernel (one per process, deliberately — a job outlives the
 * turn that spawned it, and survives a session switch), and the listener that
 * publishes updates resolves "which session is current" AT ANNOUNCE TIME. So a
 * job started in session A announced itself into session B the moment the user
 * switched, and B's baseline inherited A's running rows.
 *
 * These tests pin the ownership rule: a job's rows and notices go to its OWN
 * session, and only to it.
 */
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

const TURN: StreamEvent[] = [
  { type: 'text_delta', text: 'ok' },
  { type: 'finish', finishReason: 'stop' },
];

function provider(): ChatProvider {
  return {
    async *stream(): AsyncGenerator<StreamEvent> {
      for (const event of TURN) yield event;
    },
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
  /** The background-job rows the surface would draw, from every frame source. */
  jobRows(): Array<{ id: string; session: string | undefined }> {
    const out: Array<{ id: string; session: string | undefined }> = [];
    for (const frame of this.frames) {
      if (frame.type === 'ready') {
        for (const job of frame.info.jobs ?? []) out.push({ id: job.id, session: job.sessionId });
      }
      if (frame.type === 'event' && frame.event.type === 'job_update') {
        out.push({ id: frame.event.job.id, session: frame.event.job.sessionId });
      }
    }
    return out;
  }
  ready(): Extract<ServerFrame, { type: 'ready' }> {
    const found = [...this.frames].reverse().find((f) => f.type === 'ready');
    if (found === undefined) throw new Error('no ready');
    return found;
  }
}

async function withFakeHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-job-home-'));
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

async function tick(ms = 80): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function makeController(): Promise<WebController> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-job-root-'));
  return bootController({
    rootDir,
    provider: provider(),
    config: { approval: 'full' },
    providerModelLabel: 'test-model',
  });
}

/** The kernel's shared registry, reached the way a bash tool reaches it. */
function registryOf(controller: WebController): JobRegistry {
  return (controller.agent as unknown as { deps: { jobs: JobRegistry } }).deps.jobs;
}

/**
 * Register a job on the shared registry exactly as the bash tool does — with an
 * explicit owner, which is the field under test.
 */
function startJob(registry: JobRegistry, sessionId: string, label: string): string {
  let settle: (outcome: JobOutcome) => void = () => undefined;
  const done = new Promise<JobOutcome>((resolve) => { settle = resolve; });
  pendingSettles.push(settle);
  const snapshot = registry.start({
    kind: 'bash',
    label,
    sessionId,
    cancel: () => undefined,
    done,
  });
  return snapshot.id;
}

/** Settles left over between tests are resolved so `dispose` never hangs. */
const pendingSettles: Array<(outcome: JobOutcome) => void> = [];

function settleAll(): void {
  for (const settle of pendingSettles.splice(0)) settle({ status: 'completed' });
}

describe('background job ownership', () => {
  it('a running job started in session A does not appear in session B', async () => {
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const idA = controller.agent.session.id;
        const jobId = startJob(registryOf(controller), idA, 'npm run build (A)');
        await tick();
        // Correct while A is open.
        expect(conn.jobRows().some((j) => j.id === jobId)).toBe(true);

        // Switch to a fresh session and take its baseline.
        await send(controller, conn, { type: 'new_session' });
        await tick();
        const ready = conn.ready();
        // The decisive assertion: B's baseline must not carry A's job.
        expect((ready.info.jobs ?? []).map((j) => j.id)).not.toContain(jobId);
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });

  it('a job update after a switch is not attributed to the new session', async () => {
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'start A' });
        await tick();
        const idA = controller.agent.session.id;
        const jobId = startJob(registryOf(controller), idA, 'long build (A)');
        await send(controller, conn, { type: 'new_session' });
        const idB = controller.agent.session.id;
        expect(idA).not.toBe(idB);
        await tick();
        const before = conn.frames.length;
        // Now A's job reports a transition while B is the open session.
        settleAll();
        await tick(150);
        const late = conn.frames.slice(before).filter(
          (f): f is Extract<ServerFrame, { type: 'event' }> => f.type === 'event',
        );
        const updates = late.filter((f) => f.event.type === 'job_update');
        // Any late update that DID arrive must not claim to be B's row.
        for (const frame of updates) {
          expect(frame.event.job.sessionId).not.toBe(idB);
        }
        // And none of them is presented as B's job.
        expect(conn.jobRows().filter((j) => j.id === jobId && j.session === idB)).toEqual([]);
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });

  it('the handle only lists jobs its own session started', async () => {
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'A' });
        await tick();
        const idA = controller.agent.session.id;
        const jobId = startJob(registryOf(controller), idA, 'only-A');
        expect(controller.agent.jobSnapshots().map((j) => j.id)).toContain(jobId);

        await send(controller, conn, { type: 'new_session' });
        await tick();
        const idB = controller.agent.session.id;
        expect(idB).not.toBe(idA);
        // The decisive assertion: the new session does not inherit A's job.
        expect(controller.agent.jobSnapshots().map((j) => j.id)).not.toContain(jobId);
        // A still owns it — the job is not lost, only not B's.
        const registry = registryOf(controller);
        expect(registry.list(idA).map((j) => j.id)).toContain(jobId);
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });

  it('a foreign session cannot read or stop a job it does not own', async () => {
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'A' });
        await tick();
        const idA = controller.agent.session.id;
        const registry = registryOf(controller);
        const jobId = startJob(registry, idA, 'private-to-A');

        // A sees it; any other session sees nothing about it.
        expect(registry.get(jobId, idA)).toBeDefined();
        expect(registry.get(jobId, 'sess_someone_else')).toBeUndefined();
        expect(await registry.stop(jobId, 'nope', 'sess_someone_else')).toBeUndefined();
        // A process-wide read (no session) still sees everything, by design.
        expect(registry.get(jobId)).toBeDefined();
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });

  it('completion notices only drain into the owning session', async () => {
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'A' });
        await tick();
        const idA = controller.agent.session.id;
        const registry = registryOf(controller);
        startJob(registry, idA, 'finishes-later');
        settleAll();
        await tick(100);
        // The notice is queued for A...
        expect(registry.drainFinished('sess_other')).toEqual([]);
        expect(registry.drainFinished(idA).length).toBeGreaterThan(0);
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });

  it('an unowned job (a tool that passed no owner) is visible, not hidden', async () => {
    // Fail-open by design: hiding it would leave the job running invisibly —
    // row unrendered, notice undelivered — which loses the work outright.
    await withFakeHome(async () => {
      const controller = await makeController();
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await send(controller, conn, { type: 'prompt', text: 'A' });
        await tick();
        const registry = registryOf(controller);
        const snapshot = registry.start({
          kind: 'bash',
          label: 'ownerless',
          sessionId: '',
          cancel: () => undefined,
          done: Promise.resolve({ status: 'completed' }),
        });
        expect(registry.list('anyone').map((j) => j.id)).toContain(snapshot.id);
      } finally {
        settleAll();
        await controller.dispose();
      }
    });
  });
});
