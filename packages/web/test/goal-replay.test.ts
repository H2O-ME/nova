/**
 * The goal across a restart — the replay half of goal mode.
 *
 * The goal has ONE store: the log-only `goal/change` event. Everything a reader
 * sees comes from it — the live `goal` event while the process runs, and
 * `ready.goal` when a session is switched or the process is restarted (the same
 * shape the plan panel has).
 *
 * That is also where the compaction summary went wrong: a core-written message
 * meant FOR the model was drawn as something the user said. The goal has the
 * same trap built in — the plugin injects a continuation prompt per request —
 * so the assertions are two-sided: the goal must come back, and the continuation
 * prompt must NOT come back as a user turn.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest, StreamEvent } from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import { parseClientFrame } from '../src/client-frame.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import { WebController } from '../src/controller.js';
import type { WsConnection } from '../src/ws.js';

/** A provider that replays one script per request (no network, no key). */
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
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  /** The most recent `ready` — the baseline a client rebuilds from. */
  ready(): Extract<ServerFrame, { type: 'ready' }> {
    const found = [...this.frames].reverse().find((frame) => frame.type === 'ready');
    if (found === undefined) throw new Error('no ready frame');
    return found;
  }
}

async function boot(rootDir: string, resumeFile?: string): Promise<{ controller: WebController; conn: FakeConn }> {
  // 装配归壳：按真实调用方的形状先装内核，再把内核交给 controller。
  const kernel = await createAgentKernel({
    rootDir,
    provider: scriptedProvider([[{ type: 'text_delta', text: 'reply' }, { type: 'finish', finishReason: 'stop' }]]),
    config: { approval: 'full' },
    ...(resumeFile !== undefined ? { resumeFile } : {}),
  });
  const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
  const conn = new FakeConn();
  controller.attach(conn);
  return { controller, conn };
}

async function handle(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

/** Wait for the run's terminal frame, or give up. */
async function settled(conn: FakeConn, ms = 5000): Promise<void> {
  const start = Date.now();
  const done = (): boolean => conn.frames.some(
    (frame) => frame.type === 'event' && (frame.event.type === 'done' || frame.event.type === 'run_failed'),
  );
  while (!done()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for the run to settle');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('goal replay', () => {
  it('a goal set through /goal is in the next process s baseline', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-goal-replay-'));
    const first = await boot(rootDir);
    try {
      await handle(first.controller, first.conn, { type: 'command', name: 'goal', args: '发布 v1' });
      // Live: the panel and the composer's hint move off the event, not a reload.
      expect(first.conn.frames.some(
        (frame) => frame.type === 'event' && frame.event.type === 'goal' && frame.event.goal?.objective === '发布 v1',
      )).toBe(true);
      const file = first.controller.agent.session.file;
      await first.controller.dispose();

      // A NEW process reading the same log: exactly what `nova` does on restart.
      const second = await boot(rootDir, file);
      try {
        expect(second.conn.ready().info.goal?.objective).toBe('发布 v1');
      } finally {
        await second.controller.dispose();
      }
    } finally {
      await first.controller.dispose().catch(() => undefined);
    }
  });

  it('replays the goal without replaying the continuation prompt as a user turn', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-goal-round-'));
    const first = await boot(rootDir);
    try {
      await handle(first.controller, first.conn, { type: 'command', name: 'goal', args: '发布 v1' });
      await handle(first.controller, first.conn, { type: 'prompt', text: '开始' });
      await settled(first.conn);
      // The round was admitted, and the count the reader resumes from is the one
      // the model was told about: both read the same log event.
      expect(first.controller.agent.session.latestGoal()?.rounds).toBe(1);
      // The continuation prompt is a request-level ephemeral tail (recomputed per
      // request), so it must never be in the durable log ...
      expect(JSON.stringify(first.controller.agent.session.events)).not.toContain('goal_round');
      const file = first.controller.agent.session.file;
      await first.controller.dispose();

      const second = await boot(rootDir, file);
      try {
        const ready = second.conn.ready();
        // ... and therefore never in the transcript a reload draws.
        expect(JSON.stringify(ready.info.history)).not.toContain('goal_round');
        expect(ready.info.goal?.rounds).toBe(1);
      } finally {
        await second.controller.dispose();
      }
    } finally {
      await first.controller.dispose().catch(() => undefined);
    }
  });

  it('a fresh session has no goal, and a cleared one stays cleared', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-goal-clear-'));
    const { controller, conn } = await boot(rootDir);
    try {
      expect(conn.ready().info.goal).toBeNull();
      await handle(controller, conn, { type: 'command', name: 'goal', args: '发布 v1' });
      await handle(controller, conn, { type: 'command', name: 'goal', args: 'clear' });
      const file = controller.agent.session.file;
      await controller.dispose();

      // The clear is a RECORDED state, not an absence: a restart must not
      // resurrect the goal from an earlier event.
      const second = await boot(rootDir, file);
      try {
        expect(second.conn.ready().info.goal).toBeNull();
      } finally {
        await second.controller.dispose();
      }
    } finally {
      await controller.dispose().catch(() => undefined);
    }
  });
});
