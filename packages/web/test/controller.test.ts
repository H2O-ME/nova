import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseClientFrame,
  serializeServerFrame,
  type ClientFrame,
  type ServerFrame,
} from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import { WebController } from '../src/controller.js';
import type { ChatProvider, ChatRequest, KernelEvent, StreamEvent } from '@nova-agent/core';

// --------------------------------------------------------------------- rigs

function scriptedProvider(scripts: StreamEvent[][], capture?: ChatRequest[]): ChatProvider {
  let call = 0;
  return {
    async *stream(req: ChatRequest) {
      capture?.push(req);
      const events = scripts[call] ?? [];
      call += 1;
      for (const ev of events) yield ev;
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
  const home = await mkdtemp(path.join(tmpdir(), 'nova-web-home-'));
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

async function makeController(scripts: StreamEvent[][], approval: 'read-only' | 'full' = 'read-only'): Promise<{ controller: WebController; rootDir: string }> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
  const controller = await WebController.create({
    rootDir,
    provider: scriptedProvider(scripts),
    config: { approval },
    providerModelLabel: 'test-model',
  });
  return { controller, rootDir };
}

async function handle(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

const TEXT_TURN: StreamEvent[] = [
  { type: 'text_delta', text: 'hello web' },
  { type: 'usage', usage: { promptTokens: 10, completionTokens: 3, cachedTokens: 8 } },
  { type: 'finish', finishReason: 'stop' },
];

// --------------------------------------------------------------------- tests

describe('WebController', () => {
  it('attach replays ready with the seeded transcript as the baseline', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const ready = conn.frames[0];
      expect(ready).toMatchObject({ type: 'ready', info: { model: 'test-model', approvalMode: 'read-only' } });
      if (ready?.type !== 'ready') throw new Error('no ready');
      expect(ready.info.history).toHaveLength(0); // the seeded fragment is not user-visible
      expect(ready.info.usedTokens).toBe(0);
      expect(ready.info.sessionFile).toContain('sess_');
      await controller.dispose();
    });
  });

  it('pages a long history: ready ships the tail, load_earlier walks back', async () => {
    await withFakeHome(async (home) => {
      // A synthetic log is the cheapest way to a long session: 50 turns of
      // user+assistant = 100 blocks, well past what one `ready` may carry.
      const dir = path.join(home, '.nova', 'sessions', '2026', '09', '20');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, 'sess_long.jsonl');
      const lines = [JSON.stringify({ type: 'session', v: 2, id: 'sess_long', createdAt: 1 })];
      for (let i = 1; i <= 50; i += 1) {
        lines.push(JSON.stringify({ type: 'message', message: { id: `u${i}`, ts: i * 2, role: 'user', content: `q${i}` } }));
        lines.push(JSON.stringify({ type: 'message', message: { id: `a${i}`, ts: i * 2 + 1, role: 'assistant', content: `a${i}` } }));
      }
      await writeFile(file, `${lines.join('\n')}\n`, 'utf8');

      const { controller } = await makeController([]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'resume', file });
      const ready = conn.frames.filter((f) => f.type === 'ready').at(-1);
      if (ready?.type !== 'ready') throw new Error('no ready after resume');
      expect(ready.info.historyTotal).toBe(100);
      expect(ready.info.history).toHaveLength(40);
      // The tail is what a reader wants first: the newest turn is on screen.
      expect(ready.info.history.at(-1)).toMatchObject({ kind: 'text', text: 'a50' });

      await handle(controller, conn, { type: 'load_earlier', have: 40 });
      const first = conn.frames.filter((f) => f.type === 'history_earlier').at(-1);
      if (first?.type !== 'history_earlier') throw new Error('no earlier batch');
      expect(first.blocks).toHaveLength(40);
      expect(first.blocks[0]).toMatchObject({ kind: 'user', text: 'q11' });
      expect(first.blocks.at(-1)).toMatchObject({ kind: 'text', text: 'a30' });
      expect(first.total).toBe(100);

      // Holding everything already: the answer is an empty batch, not an error.
      await handle(controller, conn, { type: 'load_earlier', have: 100 });
      const done = conn.frames.filter((f) => f.type === 'history_earlier').at(-1);
      if (done?.type !== 'history_earlier') throw new Error('no closing batch');
      expect(done.blocks).toHaveLength(0);
      expect(done.total).toBe(100);
      await controller.dispose();
    });
  });

  it('reports a finished run\'s timings as a run_stats event', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'say hi' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'run_stats'));
      const stats = conn.events().find((e) => e.type === 'run_stats');
      if (stats?.type !== 'run_stats') throw new Error('no run_stats');
      expect(stats.stats.requests).toBe(1);
      expect(stats.stats.promptTokens).toBe(10); // the scripted usage report
      expect(stats.stats.completionTokens).toBe(3);
      expect(stats.stats.cachedTokens).toBe(8);
      expect(stats.stats.durationMs).toBeGreaterThanOrEqual(0);
      await controller.dispose();
    });
  });

  it('prompt → user_message + streamed events reach the attached socket', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'say hi' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const types = conn.events().map((e) => e.type);
      expect(types).toContain('user_message');
      expect(types).toContain('text_delta');
      expect(types).toContain('done');
      expect(controller.agent.usageSnapshot().turns).toBeGreaterThanOrEqual(1);
      await controller.dispose();
    });
  });

  it('broadcast fans out to every attached socket (reconnect keeps both live)', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const a = new FakeConn();
      const b = new FakeConn();
      controller.attach(a);
      controller.attach(b);
      await handle(controller, a, { type: 'prompt', text: 'both' });
      await b.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      expect(b.events().some((e) => e.type === 'user_message')).toBe(true);
      controller.detach(b);
      await controller.dispose();
    });
  });

  it('approval waterfall: request frame → resolve_approval allow → tool runs', async () => {
    await withFakeHome(async () => {
      const { controller, rootDir } = await makeController([
        [
          { type: 'tool_call_delta', index: 0, id: 'c1', name: 'write_file', argsDelta: JSON.stringify({ path: 'out.txt', content: 'created\n' }) },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        TEXT_TURN,
      ]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'write a file' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'approval_request'));
      const request = conn.events().find((e) => e.type === 'approval_request');
      if (request?.type !== 'approval_request') throw new Error('no approval');
      // The write landed in the workspace only after the answer.
      await handle(controller, conn, { type: 'resolve_approval', id: request.request.id, answer: 'allow' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const results = conn.events().filter((e) => e.type === 'tool_call_result');
      expect(results.length).toBe(1);
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(path.join(rootDir, 'out.txt'), 'utf8')).toBe('created\n');
      await controller.dispose();
    });
  });

  it('deny answer (with reason) flows back into the tool result', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([
        [
          { type: 'tool_call_delta', index: 0, id: 'c1', name: 'write_file', argsDelta: JSON.stringify({ path: 'no.txt', content: 'x' }) },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        TEXT_TURN,
      ]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'write but refuse' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'approval_request'));
      const request = conn.events().find((e) => e.type === 'approval_request');
      if (request?.type !== 'approval_request') throw new Error('no approval');
      await handle(controller, conn, { type: 'resolve_approval', id: request.request.id, answer: { reason: '别写这个文件' } });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const denied = conn.events().find((e) => e.type === 'tool_call_result');
      if (denied?.type !== 'tool_call_result') throw new Error('no result');
      expect(denied.result.content).toContain('Permission denied');
      expect(denied.result.content).toContain('别写这个文件');
      await controller.dispose();
    });
  });

  it('unknown approval ids get an error frame, never a crash', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'resolve_approval', id: 'apr_missing', answer: 'allow' });
      const err = conn.frames.at(-1);
      expect(err).toMatchObject({ type: 'error', message: expect.stringContaining('apr_missing') });
      await controller.dispose();
    });
  });

  it('resume paths outside the sessions dir are refused', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'resume', file: path.join(tmpdir(), 'elsewhere.jsonl') });
      const err = conn.frames.at(-1);
      expect(err).toMatchObject({ type: 'error', message: expect.stringContaining('outside') });
      await controller.dispose();
    });
  });

  it('resume of a real session switches the transcript and rebroadcasts ready', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'remember me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const file = controller.agent.session.file;
      // New session → the transcript resets to the fragment baseline…
      await handle(controller, conn, { type: 'new_session' });
      await conn.waitFor((frames) => frames.filter((f) => f.type === 'ready').length >= 2);
      // …and resuming the old file brings its messages back (durable log).
      await handle(controller, conn, { type: 'resume', file });
      await conn.waitFor((frames) => frames.filter((f) => f.type === 'ready').length >= 3);
      const ready = conn.frames.filter((f) => f.type === 'ready').at(-1);
      if (ready?.type !== 'ready') throw new Error('no ready');
      expect(ready.info.sessionFile).toBe(file);
      expect(ready.info.history.some((m) => JSON.stringify(m).includes('remember me'))).toBe(true);
      await controller.dispose();
    });
  });

  it('list_sessions returns the current log newest-first', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'list me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      conn.frames.length = 0;
      await handle(controller, conn, { type: 'list_sessions' });
      const listed = conn.frames.at(-1);
      if (listed?.type !== 'sessions') throw new Error('no sessions frame');
      expect(listed.items.some((s) => controller.agent.session.file.endsWith(s.file.slice(-20)))).toBe(true);
      await controller.dispose();
    });
  });

  it('tool events arrive with server-resolved views (the browser does no per-tool guessing)', async () => {
    await withFakeHome(async () => {
      // `full` so the bash call runs instead of parking on the approval gate.
      const { controller, rootDir } = await makeController(
        [
          [
            { type: 'tool_call_delta', index: 0, id: 'c1', name: 'bash', argsDelta: JSON.stringify({ command: 'echo hi' }) },
            { type: 'finish', finishReason: 'tool_calls' },
          ],
          TEXT_TURN,
        ],
        'full',
      );
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(rootDir, 'seed.txt'), 'x\n');
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'run echo' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'tool_call_result'));
      const start = conn.frames.find((f) => f.type === 'event' && f.event.type === 'tool_call_start');
      expect(start).toMatchObject({ view: { card: 'terminal', command: 'echo hi' } });
      const result = conn.frames.find((f) => f.type === 'event' && f.event.type === 'tool_call_result');
      expect(result).toMatchObject({ resultView: { card: 'terminal', exitCode: 0 } });
      await controller.dispose();
    });
  });

  it('mode switches are echoed to every client as a state frame', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'set_approval_mode', mode: 'full' });
      expect(conn.frames.at(-1)).toMatchObject({ type: 'state', approvalMode: 'full' });
      await handle(controller, conn, { type: 'set_code_mode', mode: 'ptc' });
      expect(conn.frames.at(-1)).toMatchObject({ type: 'state', codeMode: 'ptc' });
      await controller.dispose();
    });
  });

  it('replay of a session that ran tools rebuilds the tool cards from the log', async () => {
    await withFakeHome(async () => {
      const { controller, rootDir } = await makeController([
        [
          { type: 'tool_call_delta', index: 0, id: 'c1', name: 'read_file', argsDelta: JSON.stringify({ path: 'a.txt' }) },
          { type: 'finish', finishReason: 'tool_calls' },
        ],
        TEXT_TURN,
      ]);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(rootDir, 'a.txt'), 'one\ntwo\n');
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'read a.txt' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const file = controller.agent.session.file;
      await handle(controller, conn, { type: 'new_session' });
      await handle(controller, conn, { type: 'resume', file });
      await conn.waitFor((frames) => frames.filter((f) => f.type === 'ready').length >= 3);
      const ready = conn.frames.filter((f) => f.type === 'ready').at(-1);
      if (ready?.type !== 'ready') throw new Error('no ready');
      const toolBlock = ready.info.history.find((b) => b.kind === 'tool');
      // `read_file` declares no call card → generic (kind still `read`); its
      // result declares the read card.
      expect(toolBlock).toMatchObject({ kind: 'tool', callId: 'c1', name: 'read_file', view: { card: 'generic', kind: 'read' } });
      expect(toolBlock?.kind === 'tool' && toolBlock.result?.card).toBe('read');
      expect(ready.info.history.some((b) => b.kind === 'user' && b.text === 'read a.txt')).toBe(true);
      await controller.dispose();
    });
  });

  it('serializeServerFrame/parse round-trips a prompt frame the server would accept', () => {
    const parsed = parseClientFrame(serializeServerFrame({ type: 'error', message: 'x' }));
    expect(parsed).toMatchObject({ ok: false }); // server frames are not client frames
    expect(parseClientFrame(JSON.stringify({ type: 'prompt', text: 'ok' }))).toMatchObject({ type: 'prompt' });
  });
});
