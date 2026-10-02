import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionsRoot } from '@nova-agent/core';
import { parseClientFrame } from '../src/client-frame.js';
import { serializeServerFrame, type ClientFrame, type ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';
import { WebController } from '../src/controller.js';
import { bootController } from './controller-rig.js';
import type { ChatProvider, ChatRequest, KernelEvent, ModelCatalogPort, StreamEvent } from '@nova-agent/core';

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

/**
 * A provider that can be retargeted and reports a catalog — the shape the
 * shipped OpenAI-compatible client has (`model` / `setModel` / `listModels`).
 * The stream echoes the model in force, so a switch that only moved the display
 * without reaching the wire client cannot pass.
 */
function switchableProvider(ids: readonly string[], listError?: string): ChatProvider {
  let current = ids[0] ?? 'm1';
  return {
    get model(): string {
      return current;
    },
    setModel(next: string): void {
      current = next;
    },
    async listModels(): Promise<string[]> {
      if (listError !== undefined) throw new Error(listError);
      return [...ids];
    },
    async *stream() {
      yield { type: 'text_delta', text: `[${current}]` };
      yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 3 } };
      yield { type: 'finish', finishReason: 'stop' };
    },
  };
}

/** The surface-side metadata half of the picker (ids come from the endpoint). */
const testCatalog = {
  label: 'api.test.example',
  describe: (model: string): Promise<{ name?: string; contextWindow?: number } | undefined> =>
    Promise.resolve(model === 'm2' ? { name: 'Model Two', contextWindow: 4096 } : undefined),
};

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

async function makeController(
  scripts: StreamEvent[][],
  approval: 'read-only' | 'full' = 'read-only',
  extra: {
    provider?: ChatProvider;
    modelCatalog?: ModelCatalogPort;
    persistModel?: (model: string) => void | Promise<void>;
    /** A prepared workspace; omitted mints a fresh temp one. */
    rootDir?: string;
  } = {},
): Promise<{ controller: WebController; rootDir: string }> {
  const rootDir = extra.rootDir ?? await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
  const controller = await bootController({
    rootDir,
    provider: extra.provider ?? scriptedProvider(scripts),
    config: { approval },
    providerModelLabel: 'test-model',
    ...(extra.modelCatalog !== undefined ? { modelCatalog: extra.modelCatalog } : {}),
    ...(extra.persistModel !== undefined ? { persistModel: extra.persistModel } : {}),
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
      // The seeded fragment is not a user turn, but it IS visible: it rides the
      // baseline as one context block per section (here, the environment).
      expect(ready.info.history).toHaveLength(1);
      expect(ready.info.history[0]).toMatchObject({ kind: 'context', tag: 'environment', form: 'snapshot' });
      // The trace window is cut at the same attach: the log already holds the
      // workspace marker and the fragment's message.
      expect(ready.info.traceTotal).toBeGreaterThan(0);
      expect(ready.info.usedTokens).toBe(0);
      expect(ready.info.sessionFile).toContain('sess_');
      await controller.dispose();
    });
  });

  it('restores the context meter from the LAST request, not the run total', async () => {
    // A resumed session has no in-memory usage anchor, so `ready` has to
    // rebuild the numerator from the log. It must read the newest assistant
    // message's own `usage.promptTokens` — one request's size — and NOT
    // `run/stats.promptTokens`, which sums every request in the run. On a
    // two-request run the sum was measured at +96% of what the next request
    // actually costs (25,268 against a real last request of 12,920), so the
    // meter read nearly double. The two differ here by design: 40 then 120.
    await withFakeHome(async () => {
      const { controller } = await makeController([[], []], 'full', {
        provider: (() => {
          let call = 0;
          const sizes = [40, 120];
          return {
            async *stream() {
              const promptTokens = sizes[call] ?? 120;
              call += 1;
              if (call === 1) {
                // One tool step, so the run needs a second request.
                yield {
                  type: 'tool_call_delta',
                  index: 0,
                  id: 'call_1',
                  name: 'read_file',
                  argsDelta: '{"path":"a.txt"}',
                };
                yield { type: 'usage', usage: { promptTokens, completionTokens: 1 } };
                yield { type: 'finish', finishReason: 'tool_calls' };
              } else {
                yield { type: 'text_delta', text: 'done' };
                yield { type: 'usage', usage: { promptTokens, completionTokens: 2 } };
                yield { type: 'finish', finishReason: 'stop' };
              }
            },
          };
        })(),
      });
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'go' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const finished = conn.events().find((e) => e.type === 'run_stats');
      // The run really did sum both requests — that is why the sum is the
      // wrong thing to show as "how full is the window".
      expect(finished?.type === 'run_stats' ? finished.stats.promptTokens : 0).toBe(160);

      // A fresh attach (a reload) rebuilds from the log alone.
      await handle(controller, conn, { type: 'resume', file: conn.frames[0]?.type === 'ready' ? conn.frames[0].info.sessionFile : '' });
      const resumed = conn.frames.filter((f) => f.type === 'ready').at(-1);
      if (resumed?.type !== 'ready') throw new Error('no ready after resume');
      // 120, the last request — not 160, the run sum.
      expect(resumed.info.usedTokens).toBe(120);
      await controller.dispose();
    });
  });

  it('a run leaves a durable measurement: the resumed line and the totals survive', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'go' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const types = conn.events().map((e) => e.type);
      // The live stream still carries it (before the terminator)…
      expect(types).toContain('run_stats');
      expect(types.indexOf('run_stats')).toBeLessThan(types.lastIndexOf('done'));

      // …and a client attaching NOW (a reload, a second window, a resume) is
      // handed the same line as a replayed block plus the session totals —
      // this is what a fresh process cannot re-derive for itself.
      const late = new FakeConn();
      controller.attach(late);
      const ready = late.frames[0];
      if (ready?.type !== 'ready') throw new Error('no ready');
      const meta = ready.info.history.filter((block) => block.kind === 'meta');
      expect(meta).toHaveLength(1);
      expect(meta[0]).toMatchObject({ kind: 'meta', stats: { requests: 1, completionTokens: 3 } });
      expect(ready.info.runTotals).toMatchObject({ runs: 1, completionTokens: 3, cachedTokens: 8 });

      // And the trace reads the same record: the log's row for the run.
      await handle(controller, late, { type: 'load_trace', have: 0 });
      const trace = late.frames.at(-1);
      if (trace?.type !== 'trace') throw new Error('no trace');
      expect(trace.rows.filter((row) => row.kind === 'run')).toHaveLength(1);

      // A resume rebuilds the session handle, so the in-memory usage anchor
      // dies with it — the context meter's numerator is restored from the
      // log's last run/stats instead of reading an empty context.
      await handle(controller, late, { type: 'resume', file: ready.info.sessionFile });
      const resumed = late.frames.filter((f) => f.type === 'ready').at(-1);
      if (resumed?.type !== 'ready') throw new Error('no ready after resume');
      expect(resumed.info.usedTokens).toBe(10);
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

  it('answers a roster ask with the live plugins and the config path', async () => {
    await withFakeHome(async (home) => {
      const { controller } = await makeController([]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'roster' });
      const frame = conn.frames.find((f) => f.type === 'roster');
      if (frame?.type !== 'roster') throw new Error('no roster frame');
      // The kernel's own rows, word for word: every entry names itself and its
      // state; built-in plugins inject their services.
      expect(frame.entries.length).toBeGreaterThan(0);
      for (const entry of frame.entries) {
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.state.length).toBeGreaterThan(0);
        expect(Array.isArray(entry.inject)).toBe(true);
      }
      expect(frame.configPath).toBe(path.join(home, '.nova', 'config.json'));
      await controller.dispose();
    });
  });

  it('names the running version in ready when the shell reports one', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
      const controller = await bootController({
        rootDir,
        provider: scriptedProvider([]),
        config: { approval: 'read-only' },
        providerModelLabel: 'test-model',
        version: '9.9.9',
      });
      const conn = new FakeConn();
      controller.attach(conn);
      // The hero badge reads this; a shell that sent none keeps the field off
      // the wire (the absence is its own signal).
      expect(conn.frames[0]).toMatchObject({ type: 'ready', info: { version: '9.9.9' } });
      await controller.dispose();
    });
  });

  it('a settings-picked approval tier is the default for sessions created after it', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([]);
      const conn = new FakeConn();
      controller.attach(conn);
      expect(conn.frames[0]).toMatchObject({ type: 'ready' });
      await handle(controller, conn, { type: 'set_approval_mode', mode: 'auto-edit' });
      // The live session switched (the state frame says so)…
      await handle(controller, conn, { type: 'prompt', text: 'noop' });
      // (no provider script: the run errors, which is fine — the mode is set)
      await handle(controller, conn, { type: 'new_session' });
      const ready = conn.frames.filter((f) => f.type === 'ready').at(-1);
      if (ready?.type !== 'ready') throw new Error('no ready after switch');
      // …and the session created AFTER the pick started on it: the baseline
      // names the tier actually in force, not the config's boot default.
      expect(ready.info.approvalMode).toBe('auto-edit');
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
      expect(stats.stats.completionTokens).toBe(3);      expect(stats.stats.cachedTokens).toBe(8);
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

  it('creating a session again while still on a blank one does not mint a second log', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const before = controller.agent.session.file;
      // The session (and its file) exists before the first prompt, so pressing
      // "new session" twice used to leave two empty logs behind — and both
      // listed as "新会话", naming nothing.
      await handle(controller, conn, { type: 'new_session' });
      await handle(controller, conn, { type: 'new_session' });
      expect(controller.agent.session.file).toBe(before);
      // The click still lands somewhere the reader can see: a fresh baseline.
      expect(conn.frames.filter((f) => f.type === 'ready').length).toBe(3);
      await controller.dispose();
    });
  });

  it('lists only the blank session that is open, not the ones left behind', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'prompt', text: 'keep me' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const used = controller.agent.session.file;
      // A fresh blank session, then back to the used one: the blank is now a
      // stale empty log with nothing to name it.
      await handle(controller, conn, { type: 'new_session' });
      const stale = controller.agent.session.file;
      await handle(controller, conn, { type: 'resume', file: used });
      await handle(controller, conn, { type: 'list_sessions' });
      const list = conn.frames.filter((f) => f.type === 'sessions').at(-1);
      if (list?.type !== 'sessions') throw new Error('no sessions frame');
      const files = list.items.map((item) => item.file);
      expect(files).toContain(used);
      expect(files).not.toContain(stale);

      // …while a blank session that IS open keeps its row: it is the
      // provisional "new session" entry the sidebar is expected to show, and
      // the still-stale one stays hidden.
      await handle(controller, conn, { type: 'new_session' });
      const openBlank = controller.agent.session.file;
      expect(openBlank).not.toBe(stale);
      await handle(controller, conn, { type: 'list_sessions' });
      const second = conn.frames.filter((f) => f.type === 'sessions').at(-1);
      if (second?.type !== 'sessions') throw new Error('no second sessions frame');
      const secondFiles = second.items.map((item) => item.file);
      expect(secondFiles).toContain(openBlank);
      expect(secondFiles).not.toContain(stale);
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
      // This wait spawns a REAL shell (the assertion is a real exit code), so
      // its budget has to cover the slowest one we support: PowerShell's cold
      // start runs well past the 3s default when the lane is busy.
      await conn.waitFor(
        (frames) => frames.some((f) => f.type === 'event' && f.event.type === 'tool_call_result'),
        15_000,
      );
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

describe('WebController · model seat', () => {
  it('a non-switchable client says so in ready, and the menu reports the gap', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN], 'read-only', { modelCatalog: testCatalog });
      const conn = new FakeConn();
      controller.attach(conn);
      const ready = conn.frames[0];
      if (ready?.type !== 'ready') throw new Error('no ready');
      // The scripted provider has no setModel: the seat must not offer a switch.
      expect(ready.info.modelSwitching).toBe(false);
      await handle(controller, conn, { type: 'list_models' });
      expect(conn.frames.at(-1)).toMatchObject({ type: 'models', groups: [], current: 'test-model' });
      expect((conn.frames.at(-1) as { error?: string }).error).toBeTruthy();
      await controller.dispose();
    });
  });

  it('list_models merges the endpoint ids with the surface metadata', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN], 'read-only', {
        provider: switchableProvider(['m1', 'm2']),
        modelCatalog: testCatalog,
      });
      const conn = new FakeConn();
      controller.attach(conn);
      const ready = conn.frames[0];
      if (ready?.type !== 'ready') throw new Error('no ready');
      expect(ready.info.modelSwitching).toBe(true);
      expect(ready.info.model).toBe('m1'); // the client owns the id

      await handle(controller, conn, { type: 'list_models' });
      const models = conn.frames.at(-1);
      if (models?.type !== 'models') throw new Error('no models frame');
      expect(models.error).toBeUndefined();
      expect(models.current).toBe('m1');
      expect(models.groups).toHaveLength(1);
      expect(models.groups[0]?.name).toBe('api.test.example');
      // The known id carries the surface's display name + window; the unknown
      // one is still listed — the endpoint's catalog is the list, metadata is
      // decoration.
      expect(models.groups[0]?.models).toMatchObject([
        { id: 'm1' },
        { id: 'm2', name: 'Model Two', contextWindow: 4096 },
      ]);
      await controller.dispose();
    });
  });

  it('set_model retargets the wire client and echoes the switch to every client', async () => {
    await withFakeHome(async () => {
      const provider = switchableProvider(['m1', 'm2']);
      const { controller } = await makeController([], 'read-only', { provider, modelCatalog: testCatalog });
      const a = new FakeConn();
      const b = new FakeConn();
      controller.attach(a);
      controller.attach(b);
      await handle(controller, a, { type: 'set_model', model: 'm2' });
      // The kernel announces it once; the controller turns that into the state
      // frame both clients render, so the seat and the gauge cannot disagree.
      const model = b.events().find((e) => e.type === 'model');
      if (model?.type !== 'model') throw new Error('no model event');
      expect(model.model).toBe('m2');
      expect(model.contextWindow).toBe(4096);
      // The display name rides the same event: an id is what the wire needs, a
      // name is what the seat's trigger reads.
      expect(model.name).toBe('Model Two');
      expect(b.frames.filter((f) => f.type === 'state').at(-1)).toMatchObject({
        type: 'state',
        model: 'm2',
        modelName: 'Model Two',
      });
      // The next request leaves for the new model — the switch is on the client.
      await handle(controller, b, { type: 'prompt', text: 'hi' });
      await b.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      expect(b.events().some((e) => e.type === 'text_delta' && e.text === '[m2]')).toBe(true);
      await controller.dispose();
    });
  });

  it('an endpoint that refuses the catalog answers with an error, not a dead socket', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN], 'read-only', {
        provider: switchableProvider(['m1'], 'network down'),
        modelCatalog: testCatalog,
      });
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'list_models' });
      const models = conn.frames.at(-1);
      if (models?.type !== 'models') throw new Error('no models frame');
      expect(models.groups).toEqual([]);
      expect(models.error).toContain('模型目录');
      // A later pick still works: the failure was the listing, not the seat.
      expect(conn.closed).toBe(0);
      await controller.dispose();
    });
  });

  it('remembers the picked model past this process through the injected hook', async () => {
    await withFakeHome(async () => {
      const saved: string[] = [];
      const { controller } = await makeController([], 'read-only', {
        provider: switchableProvider(['m1', 'm2']),
        modelCatalog: testCatalog,
        persistModel: (model) => {
          saved.push(model);
        },
      });
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'set_model', model: 'm2' });
      // The seat is in-memory by design — without this the next launch boots on
      // the config default and the user's pick silently evaporates.
      expect(saved).toEqual(['m2']);
      await controller.dispose();
    });
  });

  it('keeps a failed persistence from undoing a switch that already happened', async () => {
    await withFakeHome(async () => {
      const provider = switchableProvider(['m1', 'm2']);
      const { controller } = await makeController([], 'read-only', {
        provider,
        modelCatalog: testCatalog,
        persistModel: () => Promise.reject(new Error('config is read-only')),
      });
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'set_model', model: 'm2' });
      // The write is the durable half, not a precondition: the running client
      // really is on m2, so reporting a failure must not claim otherwise.
      expect(provider.model).toBe('m2');
      const state = conn.frames.filter((f) => f.type === 'state').at(-1);
      expect(state?.type === 'state' ? state.model : '').toBe('m2');
      const error = conn.frames.find((f) => f.type === 'error');
      expect(error?.type === 'error' ? error.message : '').toContain('read-only');
      await controller.dispose();
    });
  });
});

describe('WebController · commands', () => {
  it('publishes the kernel command catalog on ready, and runs one on request', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const ready = conn.frames[0];
      if (ready?.type !== 'ready') throw new Error('no ready frame');
      // The catalog is the kernel's own registry, so `/compact` is in it without
      // the browser knowing what a command is.
      expect(ready.info.commands.map((command) => command.name)).toContain('compact');

      await handle(controller, conn, { type: 'command', name: 'compact', args: '' });
      // Reporting rides the event stream: the row opens and closes in the
      // transcript the client already renders (no separate reply frame).
      const commands = conn.events().filter((event) => event.type === 'command');
      expect(commands.map((event) => (event.type === 'command' ? event.phase : ''))).toEqual(['run', 'done']);
      await controller.dispose();
    });
  });

  it('an unknown command name answers in its own row instead of erroring the socket', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      await handle(controller, conn, { type: 'command', name: 'teleport', args: '' });
      expect(conn.events().filter((event) => event.type === 'command').at(-1)).toMatchObject({
        name: 'teleport',
        phase: 'done',
        text: expect.stringContaining('未知命令'),
      });
      expect(conn.frames.some((frame) => frame.type === 'error')).toBe(false);
      await controller.dispose();
    });
  });
});

/**
 * The three frames the sidebar and the composer gained together: the workspace
 * picker, the `@` reference menu, and session deletion. Each answers with a
 * frame rather than only mutating kernel state, because each has a client
 * surface waiting on the answer.
 */
describe('WebController · workspace / files / delete', () => {
  it('set_workspace moves the root and rebroadcasts a baseline stating it', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const target = await mkdtemp(path.join(tmpdir(), 'nova-web-next-'));

      await handle(controller, conn, { type: 'set_workspace', dir: target });
      const ready = conn.frames.filter((frame) => frame.type === 'ready').at(-1);
      // `ready` is where a client learns the workspace, so the move has to be
      // visible there — not only on the kernel handle.
      expect(ready?.type === 'ready' ? ready.info.rootDir : null).toBe(target);
      await controller.dispose();
    });
  });

  /**
   * The context fragment is appended ONCE, when the session is created, and the
   * log is append-only — so a session that already exists when the workspace
   * moves keeps injecting the OLD workspace's cwd and AGENTS.md chain. That was
   * the whole "I switched project and it still injects the wrong docs" report.
   * The repair replaces the session, and only while it is still blank: nothing
   * has been said, so nothing is lost.
   */
  it('set_workspace re-seeds a blank session so the NEW workspace\'s docs are injected', async () => {
    await withFakeHome(async () => {
      // Both workspaces are prepared BEFORE the controller exists: the session's
      // fragment is seeded at creation, so the first one must already be in place
      // for the "before" assertion to mean anything.
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
      const other = await mkdtemp(path.join(tmpdir(), 'nova-web-other-'));
      await writeFile(path.join(rootDir, 'AGENTS.md'), 'DOC-FIRST', 'utf8');
      await writeFile(path.join(other, 'AGENTS.md'), 'DOC-SECOND', 'utf8');
      const { controller } = await makeController([TEXT_TURN], 'read-only', { rootDir });
      const conn = new FakeConn();
      controller.attach(conn);
      const fragment = (): string => {
        const first = controller.agent.messages[0];
        return first === undefined ? '' : String(first.content);
      };
      expect(fragment()).toContain('DOC-FIRST');

      await handle(controller, conn, { type: 'set_workspace', dir: other });

      // The kernel moved AND the live session's fragment followed it: the
      // injected docs are a function of the workspace, not of session age.
      expect(controller.kernel.rootDir()).toBe(other);
      expect(fragment()).toContain('DOC-SECOND');
      expect(fragment()).not.toContain('DOC-FIRST');
      // The fragment's own environment section names the new cwd too.
      expect(fragment()).toContain(other);
      await controller.dispose();
    });
  });

  it('keeps streaming events after set_workspace replaced the session', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
      const other = await mkdtemp(path.join(tmpdir(), 'nova-web-other-'));
      const { controller } = await makeController([TEXT_TURN], 'read-only', { rootDir });
      const conn = new FakeConn();
      controller.attach(conn);
      conn.frames.length = 0;

      // The kernel replaces a still-blank session for the new workspace, so the
      // agent handle the controller subscribed to at boot is no longer the live
      // one. A subscription left on the old session goes silent HERE — the
      // transcript would freeze while the kernel kept working.
      await handle(controller, conn, { type: 'set_workspace', dir: other });
      conn.frames.length = 0;

      await handle(controller, conn, { type: 'prompt', text: '继续' });
      // Wait for a REAL turn event rather than a wall-clock guess: the kernel
      // runs the turn asynchronously, so a fixed sleep loses the race whenever
      // the machine is loaded (this assertion used to flake in the full suite).
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'message'));

      const types = conn.events().map((event) => event.type);
      // The turn's own events, not just the post-move baseline.
      expect(types).toContain('turn_start');
      expect(types).toContain('message');
      await controller.dispose();
    });
  });

  it('set_workspace leaves a session that has already spoken alone', async () => {
    await withFakeHome(async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
      const other = await mkdtemp(path.join(tmpdir(), 'nova-web-other-'));
      await writeFile(path.join(rootDir, 'AGENTS.md'), 'DOC-FIRST', 'utf8');
      await writeFile(path.join(other, 'AGENTS.md'), 'DOC-SECOND', 'utf8');
      const { controller } = await makeController([TEXT_TURN, TEXT_TURN], 'read-only', { rootDir });
      const conn = new FakeConn();
      controller.attach(conn);
      // A real turn: the session is no longer blank.
      await handle(controller, conn, { type: 'prompt', text: '拆一下登录' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      const file = controller.agent.session.file;

      await handle(controller, conn, { type: 'set_workspace', dir: other });

      // Same session, same log: its fragment is the truthful record of the
      // workspace those turns ran in. Rewriting it is what append-only forbids.
      expect(controller.agent.session.file).toBe(file);
      expect(controller.kernel.rootDir()).toBe(other);
      await controller.dispose();
    });
  });

  it('set_workspace refuses a directory that does not exist, and does not move', async () => {    await withFakeHome(async () => {
      const { controller, rootDir } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'set_workspace', dir: path.join(rootDir, 'nope') });
      const error = conn.frames.slice(before).find((frame) => frame.type === 'error');
      expect(error?.type === 'error' ? error.message : '').toContain('workspace does not exist');
      // The kernel must be untouched: a live session's tools still point at the
      // workspace the client is still showing.
      expect(controller.kernel.rootDir()).toBe(rootDir);
      await controller.dispose();
    });
  });

  it('list_files answers with workspace entries for the query', async () => {
    await withFakeHome(async () => {
      const { controller, rootDir } = await makeController([TEXT_TURN]);
      await mkdir(path.join(rootDir, 'src'), { recursive: true });
      await writeFile(path.join(rootDir, 'src', 'main.ts'), 'x');
      await writeFile(path.join(rootDir, 'README.md'), 'x');
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'list_files', query: 'main' });
      const files = conn.frames.slice(before).find((frame) => frame.type === 'files');
      if (files?.type !== 'files') throw new Error('no files frame');
      expect(files.query).toBe('main');
      expect(files.items.map((entry) => entry.path)).toContain('src/main.ts');
      // The frame carries the query back, so a late answer for abandoned text
      // can be recognised and dropped rather than rendered.
      expect(files.truncated).toBe(false);
      await controller.dispose();
    });
  });

  it('delete_session unlinks the log and answers with a fresh list', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      // A session must exist to delete: prompt once so the log is written.
      await handle(controller, conn, { type: 'prompt', text: 'hello' });
      await conn.waitFor((frames) => frames.some((f) => f.type === 'event' && f.event.type === 'done'));
      await handle(controller, conn, { type: 'list_sessions' });
      const listed = conn.frames.filter((frame) => frame.type === 'sessions').at(-1);
      const victim = listed?.type === 'sessions' ? listed.items[0]?.file : undefined;
      expect(victim).toBeDefined();
      if (victim === undefined) throw new Error('nothing to delete');
      expect(existsSync(victim)).toBe(true);

      await handle(controller, conn, { type: 'delete_session', file: victim });
      expect(existsSync(victim)).toBe(false);
      const after = conn.frames.filter((frame) => frame.type === 'sessions').at(-1);
      expect(after?.type === 'sessions' ? after.items.map((item) => item.file) : ['?']).not.toContain(victim);
      await controller.dispose();
    });
  });

  it('delete_session names a missing log instead of failing silently', async () => {
    await withFakeHome(async () => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;
      // A path inside the sessions root that simply is not there: the client's
      // list was stale, which is a normal race rather than a bug.
      const missing = path.join(sessionsRoot(), '2020', '01', '01', 'gone.jsonl');
      await handle(controller, conn, { type: 'delete_session', file: missing });
      const error = conn.frames.slice(before).find((frame) => frame.type === 'error');
      expect(error?.type === 'error' ? error.message : '').toContain('不存在');
      await controller.dispose();
    });
  });

  it('list_directory answers with the level in the host home', async () => {
    await withFakeHome(async (home) => {
      const { controller } = await makeController([TEXT_TURN]);
      // The picker's "open" gesture asks for the home directory first.
      await mkdir(path.join(home, 'proj'), { recursive: true });
      await writeFile(path.join(home, 'notes.txt'), 'x');
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'list_directory' });
      const directory = conn.frames.slice(before).find((frame) => frame.type === 'directory');
      if (directory?.type !== 'directory') throw new Error('no directory frame');
      // Entries are directories only: a file can be clicked but never opened.
      expect(directory.entries.map((entry) => entry.name)).toContain('proj');
      expect(directory.entries.map((entry) => entry.name)).not.toContain('notes.txt');
      // Each row carries the host's own join, so the browser never builds a path.
      const proj = directory.entries.find((entry) => entry.name === 'proj');
      expect(proj?.path).toBe(path.join(directory.path, 'proj'));
      expect(directory.path).toBe(home);
      await controller.dispose();
    });
  });

  it('list_directory refuses a missing target as its own frame, not an empty level', async () => {
    await withFakeHome(async (home) => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'list_directory', dir: path.join(home, 'nope') });
      const refused = conn.frames.slice(before).find((frame) => frame.type === 'directory_error');
      // "Cannot look" and "nothing here" are different facts; collapsing them
      // would make an unreadable mount look like an empty folder.
      expect(refused?.type === 'directory_error' ? refused.message : '').toContain('不存在');
      await controller.dispose();
    });
  });

  it('create_directory creates the folder and answers with its level', async () => {
    await withFakeHome(async (home) => {
      const { controller } = await makeController([TEXT_TURN]);
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'create_directory', dir: home, name: 'fresh' });
      expect(existsSync(path.join(home, 'fresh'))).toBe(true);
      const directory = conn.frames.slice(before).find((frame) => frame.type === 'directory');
      // The answer states the level the folder was created INTO: the picker
      // moves there, so the reply saves a second round trip.
      if (directory?.type !== 'directory') throw new Error('no directory frame');
      expect(directory.path).toBe(path.join(home, 'fresh'));
      expect(directory.entries).toEqual([]);
      await controller.dispose();
    });
  });

  it('create_directory refuses a name that already exists', async () => {
    await withFakeHome(async (home) => {
      const { controller } = await makeController([TEXT_TURN]);
      await mkdir(path.join(home, 'taken'), { recursive: true });
      const conn = new FakeConn();
      controller.attach(conn);
      const before = conn.frames.length;

      await handle(controller, conn, { type: 'create_directory', dir: home, name: 'taken' });
      const refused = conn.frames.slice(before).find((frame) => frame.type === 'directory_error');
      expect(refused?.type === 'directory_error' ? refused.message : '').toContain('已存在');
      await controller.dispose();
    });
  });
});
