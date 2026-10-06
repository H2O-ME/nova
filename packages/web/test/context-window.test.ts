/**
 * The context-window route: GET /api/context-window?session=&seq= returns the
 * frozen snapshot of one request's window that the Browser/DNA cards read.
 * Drives the real handler with a fake req/res — same lane `dashboard.test.ts`
 * uses.
 *
 * The fold itself is NOT exercised here: the route reads it through an injected
 * seam (`ContextWindowReader`) rather than importing the optional context
 * plugin, so what this file pins is the route's own contract — validate, read
 * the log, delegate, and say so when the plugin is not installed.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyBreakdown, type SessionEvent } from '@nova-agent/core';
import { CONTEXT_WINDOW_PATH, handleContextWindow, type ContextWindowReader } from '../src/context-window.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-ctx-window-route-'));
});
afterEach(async () => {
  await import('node:fs/promises').then((f) => f.rm(root, { recursive: true, force: true }));
});

function fakeGet(method = 'GET'): IncomingMessage {
  const stream = Readable.from([]);
  const realDestroy = stream.destroy.bind(stream);
  return Object.assign(stream, { method, headers: {}, destroy: realDestroy }) as unknown as IncomingMessage;
}

function fakeResponse(): { res: ServerResponse; status: () => number; json: () => Record<string, unknown> } {
  let status = 0;
  let body = '';
  const res = {
    writeHead: (code: number) => { status = code; return res; },
    end: (chunk?: string) => { body = chunk ?? ''; return res; },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    json: () => (body === '' ? {} : (JSON.parse(body) as Record<string, unknown>)),
  };
}

/** A reader stand-in that records what the route handed it. */
function fakeReader(): { reader: ContextWindowReader; calls: { events: readonly SessionEvent[]; seq: number }[] } {
  const calls: { events: readonly SessionEvent[]; seq: number }[] = [];
  return {
    calls,
    reader: {
      windowAt: (events, seq) => {
        calls.push({ events, seq });
        return { seq, elements: [], cats: emptyBreakdown(), total: 0 };
      },
    },
  };
}

/** Write a valid session log under `<root>/2026/10/01/<id>.jsonl`. */
async function writeSession(id: string, lines: string[]): Promise<string> {
  const dir = path.join(root, '2026', '10', '01');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  // Header uses `v` (not `version`); see `SessionHeader` in core/session.ts.
  const header = JSON.stringify({ type: 'session', id, v: 2, createdAt: 0 });
  await writeFile(file, [header, ...lines].join('\n') + '\n', 'utf8');
  return file;
}

function urlOf(query: string): URL {
  return new URL(`${CONTEXT_WINDOW_PATH}?${query}`, 'http://localhost');
}

describe('handleContextWindow', () => {
  it('does not match an unrelated path', async () => {
    const out = fakeResponse();
    const url = new URL('/api/other', 'http://localhost');
    const handled = await handleContextWindow(fakeGet(), out.res, url, root, fakeReader().reader);
    expect(handled).toBe(false);
  });

  it('rejects non-GET methods with 405', async () => {
    const out = fakeResponse();
    const handled = await handleContextWindow(fakeGet('POST'), out.res, urlOf('session=a&seq=0'), root, fakeReader().reader);
    expect(handled).toBe(true);
    expect(out.status()).toBe(405);
  });

  it('rejects requests missing session or seq with 400', async () => {
    const missingSeq = fakeResponse();
    const h1 = await handleContextWindow(fakeGet(), missingSeq.res, urlOf('session=a'), root, fakeReader().reader);
    expect(h1).toBe(true);
    expect(missingSeq.status()).toBe(400);

    const missingSession = fakeResponse();
    const h2 = await handleContextWindow(fakeGet(), missingSession.res, urlOf('seq=0'), root, fakeReader().reader);
    expect(h2).toBe(true);
    expect(missingSession.status()).toBe(400);
  });

  it('rejects a malformed seq with 400', async () => {
    const out = fakeResponse();
    const file = await writeSession('a', []);
    const handled = await handleContextWindow(
      fakeGet(), out.res, urlOf(`session=${encodeURIComponent(file)}&seq=abc`), root, fakeReader().reader,
    );
    expect(handled).toBe(true);
    expect(out.status()).toBe(400);
  });

  it('answers 503 when the context plugin is absent', async () => {
    // Distinct from the 404 below on purpose: the session and the position may
    // be perfectly fine, the capability that defines "what was in the window"
    // is not installed. Collapsing the two would blame the log.
    const out = fakeResponse();
    const handled = await handleContextWindow(fakeGet(), out.res, urlOf('session=a&seq=0'), root, undefined);
    expect(handled).toBe(true);
    expect(out.status()).toBe(503);
    expect(out.json()['ok']).toBe(false);
  });

  it('answers 404 when the session is not on disk', async () => {
    const out = fakeResponse();
    const missing = path.join(root, '2026', '10', '01', 'missing.jsonl');
    const handled = await handleContextWindow(
      fakeGet(), out.res, urlOf(`session=${encodeURIComponent(missing)}&seq=0`), root, fakeReader().reader,
    );
    expect(handled).toBe(true);
    expect(out.status()).toBe(404);
  });

  it('answers 200 with the snapshot the reader produced, over the parsed log', async () => {
    const out = fakeResponse();
    const file = await writeSession('a', [
      JSON.stringify({ type: 'message', message: { id: 'u1', ts: 1, role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'message',
        message: { id: 'a1', ts: 2, role: 'assistant', content: 'hello', usage: { promptTokens: 30, completionTokens: 4, cachedTokens: 0 } },
      }),
    ]);
    const { reader, calls } = fakeReader();
    const handled = await handleContextWindow(fakeGet(), out.res, urlOf(`session=${encodeURIComponent(file)}&seq=1`), root, reader);
    expect(handled).toBe(true);
    expect(out.status()).toBe(200);
    const payload = out.json();
    expect(payload['ok']).toBe(true);
    const snapshot = payload['snapshot'] as Record<string, unknown>;
    expect(snapshot['seq']).toBe(1);
    expect(Array.isArray(snapshot['elements'])).toBe(true);
    // The log really was read and handed over: two messages, at the asked seq.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.events).toHaveLength(2);
    expect(calls[0]!.seq).toBe(1);
  });
});
