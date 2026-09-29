/**
 * `launchWeb` is the only entry the shell uses, so it must forward every
 * controller option. It used to rebuild the options object field by field, and
 * a newly added optional field (`persistModel`) was silently dropped: optional
 * properties are absent from the type, so nothing failed to compile, and the
 * controller tests call `WebController.create` directly and never cross this
 * seam. The model choice then looked remembered everywhere except in a real
 * launch. These tests drive the real entry point.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StreamEvent } from '@nova-agent/core';
import { launchWeb } from '../src/index.js';
import type { WebServerHandle } from '../src/server.js';
import { exchange } from './helpers/ws-client.js';

let home: string;
let staticDir: string;
let rootDir: string;
let handle: WebServerHandle | undefined;

/**
 * The smallest provider that satisfies the port without any network. It must
 * be retargetable (`setModel`): a kernel over a shim provider has no model
 * control at all (`modelControl` returns undefined), and a switch would then be
 * refused before the persistence hook is reached.
 */
function stubProvider(): { stream(): AsyncGenerator<StreamEvent>; setModel(model: string): void } {
  return {
    async *stream() {
      yield { type: 'finish', finishReason: 'stop' };
    },
    setModel: () => undefined,
  };
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-launch-home-'));
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  staticDir = await mkdtemp(path.join(tmpdir(), 'nova-launch-static-'));
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Nova</title>', 'utf8');
  rootDir = await mkdtemp(path.join(tmpdir(), 'nova-launch-root-'));
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  delete process.env['USERPROFILE'];
  delete process.env['HOME'];
});

/** Complete the launch hop and return the session cookie it set. */
async function launchCookie(url: string): Promise<string> {
  const hop = await fetch(url, { redirect: 'manual' });
  expect(hop.status).toBe(302);
  const cookie = String(hop.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
  expect(cookie).not.toBe('');
  return cookie;
}

describe('launchWeb option forwarding', () => {
  it('hands the controller the injected option instead of dropping it', async () => {
    const saved: string[] = [];
    handle = await launchWeb({
      rootDir,
      provider: stubProvider(),
      config: { approval: 'read-only' },
      providerModelLabel: 'm1',
      staticDir,
      // A real launch always has one (the shell resolves models.dev metadata).
      modelCatalog: {
        label: 'endpoint',
        describe: async (id: string) => ({ name: id }),
      },
      persistModel: (model) => {
        saved.push(model);
      },
    });
    expect(handle.url).toContain('?t=');
    const cookie = await launchCookie(handle.url);
    // A model switch is the only observable proving the hook arrived: the
    // controller would have nowhere to send it if the option had been dropped.
    const frames = await exchange(handle.port, cookie, [{ type: 'set_model', model: 'm2' }]);
    expect(saved).toEqual(['m2']);
    expect(frames.some((f) => f.type === 'error')).toBe(false);
  });

  it('keeps a hosting option out of the controller options', async () => {
    // `staticDir` belongs to the server, not the controller; stripping it must
    // not also strip real controller options.
    handle = await launchWeb({
      rootDir,
      provider: stubProvider(),
      config: { approval: 'read-only' },
      providerModelLabel: 'm1',
      staticDir,
    });
    // Serving the built asset proves `staticDir` reached the SERVER: the entry
    // point kept it for hosting while forwarding the rest.
    const cookie = await launchCookie(handle.url);
    const res = await fetch(new URL('/index.html', handle.url), { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Nova');
    // And the controller got a usable baseline over the socket it opened.
    const frames = await exchange(handle.port, cookie, [{ type: 'list_sessions' }]);
    expect(frames.some((f) => f.type === 'sessions')).toBe(true);
  });
});
