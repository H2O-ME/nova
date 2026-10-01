/**
 * The terminal frames end to end, through the real controller.
 *
 * The unit suite (`terminal-frames.test.ts`) proves the ledger and the cursor
 * contract against a scripted starter; this one proves the WIRING — that a
 * command submitted from the panel really runs in the session's workspace, that
 * its output arrives as `terminal` frames, and that the job it creates is an
 * ordinary session job the rest of the product already knows about.
 *
 * The command is deliberately shell-agnostic (`echo`): the bash plugin prefers
 * Git Bash on Windows and falls back to PowerShell, and a terminal that only
 * worked on one of them would be a Windows-only defect this file would miss.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebController } from '../src/controller.js';
import { bootController } from './controller-rig.js';
import { parseClientFrame } from '../src/client-frame.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import type { ChatProvider, StreamEvent } from '@nova-agent/core';

const MARKER = 'nova-terminal-ok';

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  terminals(): Extract<ServerFrame, { type: 'terminal' }>[] {
    return this.frames.filter((frame): frame is Extract<ServerFrame, { type: 'terminal' }> => frame.type === 'terminal');
  }
  waitFor(pred: () => boolean, ms: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = (): void => {
        if (pred()) resolve();
        else if (Date.now() - start > ms) reject(new Error('timed out waiting for a terminal frame'));
        else setTimeout(tick, 20);
      };
      tick();
    });
  }
}

/** A provider that is never called here (the terminal does not touch the model). */
const provider: ChatProvider = {
  async *stream(): AsyncGenerator<StreamEvent> {
    yield { type: 'finish', finishReason: 'stop' };
  },
};

async function withFakeHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-terminal-home-'));
  const prev = { USERPROFILE: process.env['USERPROFILE'], HOME: process.env['HOME'] };
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function handle(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

describe('terminal frames through the controller', () => {
  it('runs a command in the workspace and streams its output', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-terminal-root-'));
      const controller = await bootController({
        rootDir,
        provider,
        config: { approval: 'read-only' },
        providerModelLabel: 'test-model',
      });
      const conn = new FakeConn();
      controller.attach(conn);

      await handle(controller, conn, { type: 'run_terminal', command: `echo ${MARKER}` });
      const started = conn.terminals().at(-1);
      expect(started).toMatchObject({ status: 'running', text: '' });
      expect(started?.id).toMatch(/^bash-\d+$/);

      // Poll the way the panel does — on a TIMER. A bare loop that only awaits
      // the synchronous frame handler spins on microtasks, so the event loop
      // never reaches the poll phase: the child's stdout and exit events are
      // starved, `settled` stays false, and the output ring stays empty. The
      // delay is what makes this a poll rather than a busy-wait.
      const deadline = Date.now() + 20_000;
      let settled = conn.terminals().some((frame) => frame.status === 'completed');
      while (!settled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        await handle(controller, conn, { type: 'read_terminal', id: started?.id ?? '' });
        settled = conn.terminals().some((frame) => frame.status === 'completed');
      }

      const output = conn.terminals().map((frame) => frame.text).join('');
      expect(output).toContain(MARKER);
      const final = conn.terminals().at(-1);
      expect(final?.status).toBe('completed');
      expect(final?.detail).toContain('exit code: 0');
      // A command run from the panel is a session job like any other: the rest of
      // the product (job rows, dispose-on-session-end) already covers it.
      expect(controller.agent.jobSnapshots().map((job) => job.id)).toContain(started?.id);

      await controller.dispose();
    });
  }, 60_000);

  it('answers a re-list with the running command, so a reload rebuilds the panel', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-terminal-root-'));
      const controller = await bootController({
        rootDir,
        provider,
        config: { approval: 'read-only' },
        providerModelLabel: 'test-model',
      });
      const conn = new FakeConn();
      controller.attach(conn);
      // A command that outlives the first answer, so the re-list has something to
      // report: the point is that a page reload does not orphan it.
      await handle(controller, conn, { type: 'run_terminal', command: 'sleep 5' });
      const started = conn.terminals().at(-1);
      conn.frames.length = 0;
      await handle(controller, conn, { type: 'list_terminal' });
      expect(conn.terminals().map((frame) => frame.id)).toEqual([started?.id]);
      await handle(controller, conn, { type: 'stop_job', id: started?.id ?? '' });
      await controller.dispose();
    });
  }, 60_000);
});
