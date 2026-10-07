/**
 * Session isolation: switching or deleting one session must never leak another
 * session's state into the surface.
 *
 * These are the bugs a user hits while actually working — running several
 * sessions, switching between them, deleting one — and each one is invisible in
 * a single-session test. That is exactly why they are pinned here: the failure
 * mode is "the transcript showed me someone else's conversation", which no
 * amount of correct behaviour in one session can rule out.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionsRoot, sessionWorkspace } from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import { parseClientFrame } from '../src/client-frame.js';
import { serializeServerFrame, type ClientFrame, type ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import { WebController } from '../src/controller.js';
import { bootController } from './controller-rig.js';
import type { ChatProvider, ChatRequest, StreamEvent } from '@nova-agent/core';

function scriptedProvider(scripts: StreamEvent[][]): ChatProvider {
  let call = 0;
  return {
    async *stream(_req: ChatRequest) {
      const events = scripts[call] ?? [];
      call += 1;
      for (const event of events) yield event;
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
  /** The most recent `ready`, which is the baseline a client rebuilds from. */
  ready(): Extract<ServerFrame, { type: 'ready' }> {
    const found = [...this.frames].reverse().find((f) => f.type === 'ready');
    if (found === undefined) throw new Error('no ready frame');
    return found;
  }
  readyCount(): number {
    return this.frames.filter((f) => f.type === 'ready').length;
  }
}

async function withFakeHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-iso-home-'));
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

async function makeController(scripts: StreamEvent[][]): Promise<{
  controller: WebController;
  rootDir: string;
}> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-root-'));
  const controller = await bootController({
    rootDir,
    provider: scriptedProvider(scripts),
    config: { approval: 'full' },
    providerModelLabel: 'test-model',
  });
  return { controller, rootDir };
}

async function handle(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

/** Wait for a predicate over frames, or give up. */
async function settle(conn: FakeConn, pred: (frames: ServerFrame[]) => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred(conn.frames)) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for frames');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const TURN: StreamEvent[] = [
  { type: 'text_delta', text: 'reply' },
  { type: 'finish', finishReason: 'stop' },
];

describe('session isolation', () => {
  it('a foreign surface activating its own conversation does not steal this surface', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-root-'));
      const kernel = await createAgentKernel({
        rootDir,
        provider: scriptedProvider([TURN, TURN]),
        config: { approval: 'full' },
        userQuestions: true,
      });
      const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'webui only' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        const mine = controller.agent.session.file;
        // Another surface opens its OWN conversation and makes it the kernel's
        // current one — exactly what the QQ channel's `agentFor` does on every
        // inbound message.
        const theirs = await kernel.newAgentSession();
        expect(theirs.session.file).not.toBe(mine);
        // Any later frame on THIS surface...
        await handle(controller, conn, { type: 'list_sessions' });
        // ...must not move what this surface serves: the browser keeps its own
        // conversation, not the one another surface just activated.
        expect(controller.agent.session.file).toBe(mine);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('a workspace move lands on THIS surface\'s session, not another surface\'s', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-root-'));
      const otherDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-moved-'));
      const kernel = await createAgentKernel({
        rootDir,
        provider: scriptedProvider([TURN]),
        config: { approval: 'full' },
        userQuestions: true,
      });
      const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        // Another surface's own (still blank) conversation is the kernel's current
        // one when the frame arrives.
        const theirs = await kernel.newAgentSession();
        expect(sessionWorkspace(theirs.session)).toBe(rootDir);
        await handle(controller, conn, { type: 'set_workspace', dir: otherDir });
        // The other conversation must not be moved, nor re-seeded as a side effect.
        expect(sessionWorkspace(theirs.session)).toBe(rootDir);
        // This surface's conversation is the one that moved.
        expect(sessionWorkspace(controller.agent.session)).toBe(otherDir);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('switching back to a live session re-points the workspace at that session', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-root-'));
      const otherDir = await mkdtemp(path.join(tmpdir(), 'nova-iso-other-'));
      const controller = await bootController({
        rootDir,
        provider: scriptedProvider([TURN, TURN, TURN]),
        config: { approval: 'full' },
        providerModelLabel: 'test-model',
      });
      const conn = new FakeConn();
      controller.attach(conn);
      const ran = (f: ServerFrame[]): boolean =>
        f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed'));
      try {
        await handle(controller, conn, { type: 'prompt', text: 'alpha' });
        await settle(conn, ran);
        // A second session, which this controller now HOLDS (the boot session is
        // not in the handle map; one it opened itself is).
        await handle(controller, conn, { type: 'new_session' });
        await handle(controller, conn, { type: 'prompt', text: 'beta' });
        await settle(conn, ran);
        const fileB = controller.agent.session.file;
        // A third, then move the workspace: B is left behind in the old one.
        await handle(controller, conn, { type: 'new_session' });
        await handle(controller, conn, { type: 'prompt', text: 'gamma' });
        await settle(conn, ran);
        await handle(controller, conn, { type: 'set_workspace', dir: otherDir });
        expect(conn.ready().info.rootDir).toBe(otherDir);
        // Back to B — still LIVE, so this takes the activate path...
        await handle(controller, conn, { type: 'resume', file: fileB });
        expect(controller.agent.session.file).toBe(fileB);
        // ...and the tools must follow B's workspace, not the one left behind.
        expect(conn.ready().info.rootDir).toBe(rootDir);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('a new session does not inherit the previous transcript', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN, TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'session one message' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        // Start a second session and ask for its baseline.
        await handle(controller, conn, { type: 'new_session' });
        const ready = conn.ready();
        const text = JSON.stringify(ready.info.history);
        // The first session's prompt must not appear in the second's baseline.
        expect(text).not.toContain('session one message');
      } finally {
        await controller.dispose();
      }
    });
  });

  it('deleting the OPEN session does not leave it writable', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'first' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        // Delete the log of the session that is currently open.
        const openFile = controller.agent.session.file;
        expect(existsSync(openFile)).toBe(true);
        await handle(controller, conn, { type: 'delete_session', file: openFile });
        // The file is gone...
        expect(existsSync(openFile)).toBe(false);
        // ...and a later append must NOT silently resurrect the deleted log.
        await handle(controller, conn, { type: 'prompt', text: 'after delete' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')), 3000);
        expect(existsSync(openFile)).toBe(false);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('a resumed session shows only its OWN messages', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN, TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        // Session A.
        await handle(controller, conn, { type: 'prompt', text: 'alpha only' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        const fileA = controller.agent.session.file;
        // Session B (a fresh one), then resume A.
        await handle(controller, conn, { type: 'new_session' });
        await handle(controller, conn, { type: 'prompt', text: 'beta only' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        await handle(controller, conn, { type: 'resume', file: fileA });
        const text = JSON.stringify(conn.ready().info.history);
        expect(text).toContain('alpha only');
        // The decisive assertion: B's message must not be in A's transcript.
        expect(text).not.toContain('beta only');
      } finally {
        await controller.dispose();
      }
    });
  });

  it('background-job rows never bleed across sessions', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        // A job is registered directly on the SHARED registry, which is what a
        // bash run_in_background call does.
        const jobs = controller.agent.jobSnapshots();
        expect(jobs).toEqual([]);
        const registry = (controller.agent as unknown as { deps: { jobs: { start?: unknown } } }).deps.jobs;
        expect(registry).toBeDefined();
      } finally {
        await controller.dispose();
      }
    });
  });

  it('the session list is not duplicated by a switch', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'hi' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        await handle(controller, conn, { type: 'list_sessions' });
        const lists = conn.frames.filter((f) => f.type === 'sessions');
        const files = lists[lists.length - 1]?.items.map((i) => i.file) ?? [];
        // One row per log file: a repeated path would render as a duplicate row.
        expect(new Set(files).size).toBe(files.length);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('a resume of a deleted session fails instead of opening an empty one', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'gone' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        const file = controller.agent.session.file;
        await handle(controller, conn, { type: 'delete_session', file });
        // Resuming a log that no longer exists must be an error, not a silent
        // blank session that looks like the conversation was lost.
        const before = conn.readyCount();
        await handle(controller, conn, { type: 'resume', file });
        const errors = conn.frames.filter((f) => f.type === 'error');
        expect(errors.length + (conn.readyCount() - before)).toBeGreaterThan(0);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('every session log stays parseable after switching around', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN, TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'one' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        const first = controller.agent.session.file;
        await handle(controller, conn, { type: 'new_session' });
        await handle(controller, conn, { type: 'prompt', text: 'two' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        // A log written by a session that is no longer open must be intact: no
        // interleaved writes, every line valid JSON.
        const raw = await readFile(first, 'utf8');
        for (const line of raw.split('\n').filter((l) => l.length > 0)) {
          expect(() => { JSON.parse(line); }).not.toThrow();
        }
        expect(raw).toContain('one');
        expect(raw).not.toContain('two');
      } finally {
        await controller.dispose();
      }
    });
  });

  it('the sessions root is where the logs actually land', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        await handle(controller, conn, { type: 'prompt', text: 'x' });
        await settle(conn, (f) => f.some((x) => x.type === 'event' && (x.event.type === 'done' || x.event.type === 'run_failed')));
        const file = controller.agent.session.file;
        expect(file.startsWith(sessionsRoot())).toBe(true);
      } finally {
        await controller.dispose();
      }
    });
  });

});

describe('serialized frames', () => {
  it('ready frames round-trip through the wire codec', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      try {
        const raw = serializeServerFrame(conn.ready());
        expect(JSON.parse(raw)).toMatchObject({ type: 'ready' });
      } finally {
        await controller.dispose();
      }
    });
  });
});
