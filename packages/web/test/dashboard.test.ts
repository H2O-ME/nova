/**
 * The dashboard route: GET /api/dashboard folds every stored session log under
 * the sessions root and answers the cross-session reading the browser's
 * dashboard card renders. Drives the real handler with a fake req/res — same
 * lane `image-upload.test.ts` uses.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DASHBOARD_PATH, handleDashboard } from '../src/dashboard.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-dash-route-'));
});
afterEach(async () => {
  await import('node:fs/promises').then((f) => f.rm(root, { recursive: true, force: true }));
});

/** A minimal GET request — the dashboard route reads no body. */
function fakeGet(method: string = 'GET'): IncomingMessage {
  const stream = Readable.from([]);
  const realDestroy = stream.destroy.bind(stream);
  return Object.assign(stream, { method, headers: {}, destroy: realDestroy }) as unknown as IncomingMessage;
}

/** A minimal response recorder (mirrors `image-upload.test.ts`). */
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

/** Write one session log under `<root>/YYYY/MM/DD/<id>.jsonl`. */
async function writeSession(id: string, lines: string[]): Promise<void> {
  const dir = path.join(root, '2026', '10', '01');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

describe('handleDashboard', () => {
  it('does not match an unrelated path', async () => {
    const out = fakeResponse();
    const url = new URL('/api/other', 'http://localhost');
    const handled = await handleDashboard(fakeGet(), out.res, url, root);
    expect(handled).toBe(false);
  });

  it('rejects non-GET methods with 405', async () => {
    const out = fakeResponse();
    const url = new URL(DASHBOARD_PATH, 'http://localhost');
    const handled = await handleDashboard(fakeGet('POST'), out.res, url, root);
    expect(handled).toBe(true);
    expect(out.status()).toBe(405);
  });

  it('folds sessions under root into an aggregate payload', async () => {
    await writeSession('a', [
      JSON.stringify({ type: 'workspace', path: '/proj-a', at: 0 }),
      JSON.stringify({ type: 'run/stats', at: 1_700_000_000_000, stats: { promptTokens: 1000, completionTokens: 100, requests: 3 } }),
    ]);
    const out = fakeResponse();
    const url = new URL(DASHBOARD_PATH, 'http://localhost');
    const handled = await handleDashboard(fakeGet(), out.res, url, root);
    expect(handled).toBe(true);
    expect(out.status()).toBe(200);
    const payload = out.json();
    expect(payload['ok']).toBe(true);
    const agg = payload['aggregate'] as Record<string, unknown>;
    expect(agg['sessions']).toBe(1);
    const totals = agg['totals'] as Record<string, number>;
    expect(totals['requests']).toBe(3);
    expect(totals['prompt']).toBe(1000);
  });

  it('answers 200 with empty totals when the root is empty', async () => {
    const out = fakeResponse();
    const url = new URL(DASHBOARD_PATH, 'http://localhost');
    const handled = await handleDashboard(fakeGet(), out.res, url, root);
    expect(handled).toBe(true);
    expect(out.status()).toBe(200);
    const payload = out.json();
    const agg = payload['aggregate'] as Record<string, unknown>;
    expect(agg['sessions']).toBe(0);
    expect((agg['totals'] as Record<string, number>)['requests']).toBe(0);
  });
});
