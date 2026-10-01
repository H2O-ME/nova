/**
 * Origin durability, port half: the remembered port is tried first on the
 * next boot, an ephemeral bind is the fallback when it is busy, and whatever
 * binds is remembered. Store corruption reads as "no preference".
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPreferredPort } from '../src/port.js';
import { startWebServer, type WebServerHandle } from '../src/server.js';
import { createLaunchAuth } from '../src/auth.js';
import { WebController } from '../src/controller.js';
import { bootController } from './controller-rig.js';

const handles: WebServerHandle[] = [];
let controller: WebController | undefined;

async function serverWith(portStore: string, port?: number): Promise<WebServerHandle> {
  if (controller === undefined) {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'nova-webport-root-'));
    controller = await bootController({
      rootDir,
      provider: { async *stream() { yield { type: 'finish', finishReason: 'stop' }; } },
      config: { approval: 'read-only' },
      providerModelLabel: 'test-model',
    });
  }
  const staticDir = await mkdtemp(path.join(tmpdir(), 'nova-webport-static-'));
  const handle = await startWebServer({
    controller,
    auth: createLaunchAuth(),
    staticDir,
    host: '127.0.0.1',
    portStore,
    ...(port !== undefined ? { port } : {}),
  });
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close();
});

async function portFile(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'nova-webport-')), 'web-port.json');
}

describe('remembered web port', () => {
  it('a fresh boot binds the remembered port — the origin survives restarts', async () => {
    const store = await portFile();
    // The close→rebind window is milliseconds wide, and on Windows the
    // listening handle can linger briefly after close() resolves; parallel
    // test files bind ephemeral ports in the same pool too. A lost race is
    // the product behaving CORRECTLY (falling back), so retry the whole
    // cycle — a regression fails every attempt, a race only one.
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      const first = await serverWith(store, 0);
      const remembered = first.port;
      await first.close();
      await new Promise((r) => setTimeout(r, 50));
      // Next boot, no explicit port: the REMEMBERED port is tried first and,
      // being free, wins. Same origin → the browser's localStorage persists.
      const second = await serverWith(store);
      ok = second.port === remembered;
      await second.close();
    }
    expect(ok, 'remembered port never won the rebind in 5 attempts').toBe(true);
  });

  it('the remembered port losing the race degrades to an ephemeral bind', async () => {
    const store = await portFile();
    const occupant = await serverWith(store, 0);
    // The remembered port is still in use by `occupant`; the default bind
    // must not fail the boot — it takes another ephemeral port.
    const next = await serverWith(store);
    expect(next.port).not.toBe(occupant.port);
  });

  it('store corruption and out-of-range values read as no preference', async () => {
    const file = await portFile();
    await writeFile(file, '{ not json', 'utf8');
    expect(await readPreferredPort(file)).toBeUndefined();
    await writeFile(file, '{"port":70000}', 'utf8');
    expect(await readPreferredPort(file)).toBeUndefined();
    await writeFile(file, '{"port":"8080"}', 'utf8');
    expect(await readPreferredPort(file)).toBeUndefined();
    await writeFile(file, '{"port":8080}', 'utf8');
    expect(await readPreferredPort(file)).toBe(8080);
  });
});
