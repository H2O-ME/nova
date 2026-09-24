/**
 * HTTP/WS server integration over a real ephemeral 127.0.0.1 socket: the
 * launch-token hop, cookie-gated static serving, path-traversal refusal, and
 * a hand-rolled WS client (handshake + masked frames) proving auth + framing
 * + controller fanout are wired end-to-end. No external ws library — the
 * client side doubles as a second opinion on the server codec.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KernelEvent, StreamEvent } from '@nova-agent/core';
import { createLaunchAuth, type LaunchAuth } from '../src/auth.js';
import { WebController } from '../src/controller.js';
import { startWebServer, type WebServerHandle } from '../src/server.js';
import { acceptKey } from '../src/ws.js';
import type { ServerFrame } from '../src/protocol.js';

let staticDir: string;
let home: string;
let auth: LaunchAuth;
let handle: WebServerHandle;
let controller: WebController;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-web-home-'));
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  staticDir = await mkdtemp(path.join(tmpdir(), 'nova-web-static-'));
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Nova</title>', 'utf8');
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(path.join(staticDir, 'assets', 'index-abc123.js'), '/* bundle */', 'utf8');
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
  const scripts: StreamEvent[][] = [[
    { type: 'text_delta', text: 'ok' },
    { type: 'finish', finishReason: 'stop' },
  ]];
  controller = await WebController.create({
    rootDir,
    provider: {
      async *stream(_req) {
        for (const ev of scripts.shift() ?? []) yield ev;
      },
    },
    config: { approval: 'read-only' },
    providerModelLabel: 'test-model',
  });
  auth = createLaunchAuth();
  handle = await startWebServer({ controller, auth, staticDir, host: '127.0.0.1' });
});

afterAll(async () => {
  await handle.close();
  delete process.env['USERPROFILE'];
  delete process.env['HOME'];
});


function http(pathname: string, cookie?: string): Promise<{ status: number; headers: NodeJS.Dict<string | string[]>; body: string }> {
  return new Promise((resolve, rejectPromise) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: handle.port, path: pathname, headers: cookie !== undefined ? { cookie } : {} },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', rejectPromise);
    req.end();
  });
}

describe('http surface', () => {
  it('serves nothing before the launch hop (no cookie → 401)', async () => {
    const res = await http('/');
    expect(res.status).toBe(401);
  });
  it('the launch URL sets a hardened cookie and redirects', async () => {
    const res = await http(`/?t=${auth.token}`);
    expect(res.status).toBe(302);
    const setCookie = String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('nova_ws=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });
  it('a wrong token gets 403', async () => {
    const res = await http('/?t=deadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.status).toBe(403);
  });
  it('static index serves with the cookie; traversal is refused', async () => {
    const hop = await http(`/?t=${auth.token}`);
    const cookie = String((hop.headers['set-cookie'] ?? [''])[0]).split(';')[0] as string;
    const ok = await http('/', cookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('Nova');
    const sneak = await http('/%2e%2e%2f%2e%2e%2f%2e%2e%2fwindows%2fwin.ini', cookie);
    expect([400, 404]).toContain(sneak.status);
    expect(sneak.body).not.toContain('[fonts]');
  });
  it('the document revalidates and the hashed assets do not', async () => {
    // A cached `index.html` names the previous build's asset URLs: a reload
    // would ask for a file the rebuild deleted. Hashed assets are the one thing
    // that can be cached forever, because their URL changes with their bytes.
    const cookie = cookieFor(await http(`/?t=${auth.token}`));
    const doc = await http('/', cookie);
    expect(doc.headers['cache-control']).toBe('no-cache');
    const asset = await http('/assets/index-abc123.js', cookie);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});

describe('ws surface', () => {
  it('the upgrade requires the cookie, then streams kernel events after a prompt', async () => {
    // 1) Unauthenticated upgrade is refused.
    await expect(wsHandshake(handle.port, '/ws', undefined)).rejects.toThrow(/401|closed/i);
    // 2) Authenticated handshake → receive ready → send prompt → receive events.
    const cookie = cookieFor(await http(`/?t=${auth.token}`));
    const client = await wsHandshake(handle.port, '/ws', cookie);
    try {
      const first = await client.nextFrame();
      expect(first).toMatchObject({ type: 'ready' });
      if (first?.type !== 'ready') throw new Error('no ready');
      expect(first.info.model).toBe('test-model');
      client.send(JSON.stringify({ type: 'prompt', text: 'hello' }));
      const seen: KernelEvent[] = [];
      for (let i = 0; i < 12; i += 1) {
        const frame = await client.nextFrame();
        if (frame?.type === 'event') seen.push(frame.event);
        if (seen.some((e) => e.type === 'done')) break;
      }
      expect(seen.some((e) => e.type === 'user_message')).toBe(true);
      expect(seen.some((e) => e.type === 'text_delta' && e.text === 'ok')).toBe(true);
      expect(seen.some((e) => e.type === 'done')).toBe(true);
    } finally {
      client.destroy();
    }
  });

  it('an unknown frame type replies with an error frame on the same socket', async () => {
    const cookie = cookieFor(await http(`/?t=${auth.token}`));
    const client = await wsHandshake(handle.port, '/ws', cookie);
    try {
      await client.nextFrame(); // ready
      client.send(JSON.stringify({ type: 'launch_missiles' }));
      const frame = await client.nextFrame();
      expect(frame).toMatchObject({ type: 'error', message: expect.stringContaining('launch_missiles') });
    } finally {
      client.destroy();
    }
  });
});

function cookieFor(hop: { headers: NodeJS.Dict<string | string[]> }): string {
  return String((hop.headers['set-cookie'] ?? [''])[0]).split(';')[0] as string;
}

// ------------------------------------------------------------- tiny ws client

interface WsClient {
  nextFrame(): Promise<ServerFrame | undefined>;
  send(text: string): void;
  destroy(): void;
}

const WS_KEY = 'testkey0123456789abcdefghij';

function wsHandshake(port: number, pathname: string, cookie: string | undefined): Promise<WsClient> {
  return new Promise((resolve, rejectPromise) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n` +
          'Host: 127.0.0.1\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${WS_KEY}\r\nSec-WebSocket-Version: 13\r\n` +
          (cookie !== undefined ? `Cookie: ${cookie}\r\n` : '') +
          '\r\n',
      );
    });
    let handshakeDone = false;
    let buf = Buffer.alloc(0);
    const queue: ServerFrame[] = [];
    let wake: ((f: ServerFrame | undefined) => void) | undefined;
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 4);
        if (!head.startsWith('HTTP/1.1 101')) {
          rejectPromise(new Error(/closed|401/.test(head) ? head.split('\r\n')[0] ?? 'closed' : 'closed'));
          socket.destroy();
          return;
        }
        if (!head.includes(`Sec-WebSocket-Accept: ${acceptKey(WS_KEY) ?? ''}`)) {
          rejectPromise(new Error('bad accept header'));
          socket.destroy();
          return;
        }
        handshakeDone = true;
        resolve({
          nextFrame: () =>
            new Promise((res) => {
              const pending = queue.shift();
              if (pending !== undefined) res(pending);
              else wake = res;
            }),
          send: (text: string) => socket.write(clientFrame(text)),
          destroy: () => socket.destroy(),
        });
      }
      for (;;) {
        const frame = decodeServerFrame(buf);
        if (frame === null) break;
        buf = buf.subarray(frame.consumed);
        if (frame.opcode === 0x1) {
          const value = JSON.parse(frame.payload.toString('utf8')) as ServerFrame;
          if (wake !== undefined) {
            const fn = wake;
            wake = undefined;
            fn(value);
          } else queue.push(value);
        }
      }
    });
    socket.on('error', rejectPromise);
    socket.on('close', () => {
      wake?.(undefined);
      if (!handshakeDone) rejectPromise(new Error('closed'));
    });
  });
}

function decodeServerFrame(buf: Buffer): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] !== undefined ? buf[0] & 0x0f : 0;
  let len = (buf[1] ?? 0) & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (buf.length < offset + len) return null;
  return { opcode, payload: buf.subarray(offset, offset + len), consumed: offset + len };
}

function clientFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([9, 8, 7, 6]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) masked[i] = (masked[i] ?? 0) ^ (mask[i & 3] ?? 0);
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, ...mask]), masked]);
}
