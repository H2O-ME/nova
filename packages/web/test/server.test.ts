/**
 * HTTP/WS server integration over a real ephemeral 127.0.0.1 socket: the
 * launch-token hop, cookie-gated static serving, path-traversal refusal, and
 * a hand-rolled WS client (handshake + masked frames) proving auth + framing
 * + controller fanout are wired end-to-end. No external ws library — the
 * client side doubles as a second opinion on the server codec.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KernelEvent, StreamEvent } from '@nova-agent/core';
import { admitImage } from '@nova-agent/core';
import { createLaunchAuth, type LaunchAuth } from '../src/auth.js';
import { WebController } from '../src/controller.js';
import { WebRouteRegistry } from '../src/route-registry.js';
import { bootController } from './controller-rig.js';
import { startWebServer, type WebServerHandle } from '../src/server.js';
import { wsHandshake } from './helpers/ws-client.js';
import { pngBytes } from './helpers/png.js';

let staticDir: string;
let home: string;
let auth: LaunchAuth;
let handle: WebServerHandle;
let controller: WebController;
let pluginRoutes: WebRouteRegistry;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-web-home-'));
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  staticDir = await mkdtemp(path.join(tmpdir(), 'nova-web-static-'));
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Nova</title>', 'utf8');
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(path.join(staticDir, 'assets', 'index-abc123.js'), '/* bundle */', 'utf8');
  // The install pipeline fetches these OUTSIDE the authenticated app context.
  await writeFile(path.join(staticDir, 'manifest.webmanifest'), '{"name":"Nova"}', 'utf8');
  await mkdir(path.join(staticDir, 'icons'), { recursive: true });
  await writeFile(path.join(staticDir, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf8');
  await writeFile(path.join(staticDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
  const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-web-root-'));
  const scripts: StreamEvent[][] = [[
    { type: 'text_delta', text: 'ok' },
    { type: 'finish', finishReason: 'stop' },
  ]];
  controller = await bootController({
    rootDir,
    provider: {
      async *stream(_req) {
        for (const ev of scripts.shift() ?? []) yield ev;
      },
    },
    config: { approval: 'read-only' },
    providerModelLabel: 'test-model',
  });
  // Plugin routes the host publishes: a registered prefix must answer BEFORE
  // static serving, but still INSIDE the auth gate.
  pluginRoutes = new WebRouteRegistry();
  pluginRoutes.register({
    prefix: '/plugins/genui/assets',
    handler: async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('plugin-asset-body');
    },
  });
  auth = createLaunchAuth();
  handle = await startWebServer({ controller, auth, staticDir, host: '127.0.0.1', routes: pluginRoutes });
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
  it('PWA brand assets are public — the install pipeline carries no cookie', async () => {
    // Chromium fetches the manifest and prefetches icons outside the
    // authenticated app context; a 401 there silently kills the install
    // affordance. These are the ONLY paths that skip the cookie gate.
    const manifest = await http('/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    expect((await http('/icons/icon-192.png')).status).toBe(200);
    expect((await http('/favicon.svg')).status).toBe(200);
    // Everything else — including the app document — stays gated.
    expect((await http('/')).status).toBe(401);
    expect((await http('/assets/index-abc123.js')).status).toBe(401);
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

  it('serves a stored image back to the browser, behind the same auth', async () => {
    // The END-TO-END shape of the reload path: a real HTTP request, through the
    // real router, past the real auth gate. The unit test proves the handler
    // resolves an id; this proves the request actually REACHES it — the route
    // sits inside the cookie gate, and `handleHttp` must try it before static
    // serving (which would 404 the path as a missing file).
    const cake = await admitImage(pngBytes('served-back'), 'shot.png');
    expect(cake.ok).toBe(true);
    if (!cake.ok) return;

    const cookie = cookieFor(await http(`/?t=${auth.token}`));
    const res = await http(`/api/image/${encodeURIComponent(cake.ref.id)}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
    // The length is asserted from the HEADER, not the decoded body: `http()`
    // reads the response as UTF-8, which is lossy for PNG bytes.
    expect(res.headers['content-length']).toBe(String(cake.ref.bytes));
  });

  it('refuses the image route without a cookie, like every other path', async () => {
    // A content-addressed URL is still a private read: the digest is unguessable,
    // but "unguessable" is not an access control.
    const cake = await admitImage(pngBytes('gated'), 'gated.png');
    if (!cake.ok) throw new Error('admit failed');
    const res = await http(`/api/image/${encodeURIComponent(cake.ref.id)}`);
    expect(res.status).toBe(401);
  });

  it('plugin asset routes answer before static serving but behind the auth gate', async () => {
    // A registered plugin prefix runs INSTEAD of static serving — without this
    // dispatch the path would 404 as a missing file under staticDir.
    const cookie = cookieFor(await http(`/?t=${auth.token}`));
    const ok = await http('/plugins/genui/assets/bundle.js', cookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toBe('plugin-asset-body');
    // A nested path under the same prefix also matches.
    const nested = await http('/plugins/genui/assets/sub/icon.svg', cookie);
    expect(nested.status).toBe(200);
    expect(nested.body).toBe('plugin-asset-body');
    // The auth gate still applies — a plugin route is a private read, not a
    // public brand asset, so an unauthenticated request must be refused BEFORE
    // the handler runs.
    const noCookie = await http('/plugins/genui/assets/bundle.js');
    expect(noCookie.status).toBe(401);
    // A plugin-unowned path still falls through to static serving.
    const through = await http('/assets/index-abc123.js', cookie);
    expect(through.status).toBe(200);
    expect(through.body).toBe('/* bundle */');
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
