/**
 * The Context panel's wire: the reading rides `ready`, arrives on demand, and
 * appears/disappears with the PLUGIN that provides it.
 *
 * Driven through a REAL `WebController`, because the claim worth pinning is the
 * one no pure function can state: the panel's on/off IS the provider's presence.
 * A settings flip re-rosters the container, and the controller has to notice and
 * re-state the reading (or clear it) — a second flag kept in step by hand is
 * exactly what this test exists to prevent.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest, StreamEvent } from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import { parseClientFrame } from '../src/client-frame.js';
import { WebController } from '../src/controller.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

function provider(): ChatProvider {
  return {
    async *stream(_req: ChatRequest) {
      yield { type: 'text_delta', text: 'ok' } satisfies StreamEvent;
    },
  };
}

class FakeConn implements WsConnection {
  readonly frames: ServerFrame[] = [];
  send(text: string): void {
    this.frames.push(JSON.parse(text) as ServerFrame);
  }
  close(): void {}
  lastContext(): Extract<ServerFrame, { type: 'context' }> | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame?.type === 'context') return frame;
    }
    return undefined;
  }
}

async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-ctx-home-'));
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

async function makeRig(opts: { enabled?: boolean } = {}): Promise<{ controller: WebController; conn: FakeConn; on: string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-ctx-root-'));
  const on: string[] = opts.enabled === true ? ['context'] : [];
  const kernel = await createAgentKernel({
    rootDir: root,
    provider: provider(),
    config: {
      approval: 'read-only',
      ...(opts.enabled === true ? { plugins: { enable: ['context'] } } : {}),
    },
    persistConfig: {
      setPluginEnabled: () => Promise.resolve([]),
      setPluginEnabledList: (names) => {
        on.splice(0, on.length, ...names);
        return Promise.resolve([...on]);
      },
    },
  });
  const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
  const conn = new FakeConn();
  controller.attach(conn);
  return { controller, conn, on };
}

async function drive(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

describe('the context frame', () => {
  it('is offered as an advanced row in the roster, off until asked for', async () => {
    await withFakeHome(async () => {
      const { conn } = await makeRig();
      const ready = conn.frames.find((frame) => frame.type === 'ready');
      expect(ready).toBeDefined();
      // The panel's tab is drawn from the reading, and there is none: the
      // baseline omits the field rather than shipping an empty reading.
      expect(ready?.info.context).toBeUndefined();
      const row = ready?.info.roster?.find((entry) => entry.name === 'context');
      expect(row).toBeDefined();
      expect(row?.tier).toBe('advanced');
      expect(row?.enabled).toBe(false);
    });
  });

  it('answers an explicit ask with the fold over the session log', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ enabled: true });
      const ready = conn.frames.find((frame) => frame.type === 'ready');
      // First paint: the baseline carries the reading, so the tab can be drawn
      // without waiting for a round trip.
      expect(ready?.info.context).toBeDefined();
      const baseline = ready?.info.context;
      expect(baseline?.live.elements.some((element) => element.cat === 'injected')).toBe(true);

      await drive(controller, conn, { type: 'context' });
      const answer = conn.lastContext();
      expect(answer).toBeDefined();
      expect(answer?.timeline).not.toBeNull();
      expect(answer?.timeline?.live.elements.length).toBeGreaterThan(0);
    });
  });

  it('clears the reading when the plugin is switched off, and restores it when switched on', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ enabled: true });
      expect(conn.frames.find((frame) => frame.type === 'ready')?.info.context).toBeDefined();

      // OFF: the provider goes away, and the panel must be told — a null
      // timeline is a REAL state (the pane drops its tab), not "no news".
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'context', enabled: false });
      expect(conn.lastContext()?.timeline).toBeNull();

      // ON again: the fold reopens over the WHOLE existing log, not from the
      // moment of the flip.
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'context', enabled: true });
      const restored = conn.lastContext();
      expect(restored?.timeline).not.toBeNull();
      expect(restored?.timeline?.live.elements.length).toBeGreaterThan(0);
    });
  });
});
