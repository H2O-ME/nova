/**
 * The Context panel's wire: the reading rides `ready`, arrives on demand, and
 * appears/disappears with the PLUGIN that provides it.
 *
 * Driven through a REAL `WebController`, because the claim worth pinning is the
 * one no pure function can state: the panel's on/off IS the provider's presence.
 * Availability is read live from the container on every frame (`ContextFollow`,
 * `controller.syncContextAvailability`), so a roster change has to be NOTICED —
 * a second flag kept in step by hand is exactly what these tests exist to
 * prevent.
 *
 * ## What the row is called
 *
 * The context insight plugin is an extension PACKAGE, so its row id is its module
 * specifier (`@nova-agent/plugin-context`): that is the id `plugins.entries`
 * names and the id the roster reports. Whether the plugin loaded is decided by
 * that ROW alone — there is no second opt-in, and no `plugins.enable` list. The
 * document therefore states the row EXPLICITLY in every case here, on or off, so
 * nothing in this file depends on which default the plugin's own manifest
 * declares for its tier.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contextInsights as contextInsightsKey,
  emptyBreakdown,
  type ChatProvider,
  type ChatRequest,
  type ContextFold,
  type ContextInsights,
  type ContextTimeline,
  type Plugin,
  type StreamEvent,
} from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import type { PluginEntryConfig } from '@nova-agent/plugins';
import { parseClientFrame } from '../src/client-frame.js';
import { WebController } from '../src/controller.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

/** The row id of the shipped context insight plugin (its module specifier). */
const CONTEXT = '@nova-agent/plugin-context';
/** The row id of the stand-in provider used by the flip test. */
const STANDIN = 'demo-context';

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

/** A fixed reading: this test is about a provider appearing, not about folding. */
const STANDIN_TIMELINE: ContextTimeline = {
  truncated: false,
  live: { cats: emptyBreakdown(), total: 0, elements: [] },
  counts: { requests: 0, turns: 0, toolCalls: 0, compactions: 0 },
  points: [],
  events: [],
  files: [],
};

/**
 * A stand-in provider of the SAME service the shipped plugin provides.
 *
 * It exists so a test can start from a provider row whose id is a plain word,
 * while the shipped row's id is a module specifier (`CONTEXT`). Both are
 * addressable over the wire now — the two tests below use one each — and the
 * controller's notification contract is provider-agnostic, so pinning it with
 * either is a real pin.
 */
function standinPlugin(): Plugin {
  const fold: ContextFold = { apply: () => undefined, view: () => STANDIN_TIMELINE };
  const insights: ContextInsights = { fold: () => fold };
  return {
    name: STANDIN,
    manifest: { title: '上下文演示', description: 'a stand-in context provider', tier: 'standard' },
    apply: (ctx): void => {
      ctx.provide(contextInsightsKey, insights);
    },
  };
}

interface Rig {
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  controller: WebController;
  conn: FakeConn;
  attachFrames: readonly ServerFrame[];
}

async function makeRig(opts: {
  entries: PluginEntryConfig[];
  /** Add the stand-in context provider as an extra row (booted off by default). */
  standin?: boolean;
}): Promise<Rig> {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-ctx-root-'));
  const rows: PluginEntryConfig[] = opts.entries.map((entry) => ({ ...entry }));
  const kernel = await createAgentKernel({
    rootDir: root,
    provider: provider(),
    config: { approval: 'read-only', plugins: { entries: rows } },
    ...(opts.standin === true ? { extraPlugins: [{ id: STANDIN, plugin: standinPlugin() }] } : {}),
    persist: {
      readPluginEntry: (id) => Promise.resolve(rows.find((entry) => entry.id === id)),
      // The durable row is what the roster is resolved from, so a write lands in
      // the SAME list the kernel reads (the file is the tree's source).
      setPluginEntry: (id, patch) => {
        const row = rows.find((entry) => entry.id === id);
        if (row === undefined) rows.push({ id, ...patch });
        else Object.assign(row, patch);
        return Promise.resolve();
      },
      setSkillEnabled: () => Promise.resolve([]),
    },
  });
  const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
  const conn = new FakeConn();
  controller.attach(conn);
  const attachFrames = [...conn.frames];
  conn.frames.length = 0;
  return { kernel, controller, conn, attachFrames };
}

async function drive(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

function readyOf(rig: Rig): Extract<ServerFrame, { type: 'ready' }> {
  const ready = rig.attachFrames.find((frame) => frame.type === 'ready');
  if (ready?.type !== 'ready') throw new Error('no ready frame');
  return ready;
}

describe('the context frame', () => {
  it('has no reading until a plugins.entries row turns its provider on', async () => {
    await withFakeHome(async () => {
      const rig = await makeRig({ entries: [{ id: CONTEXT, enabled: false }] });
      const ready = readyOf(rig);
      // The panel's tab is drawn from the reading, and there is none: the
      // baseline omits the field rather than shipping an empty reading.
      expect(ready.info.context).toBeUndefined();
      // The row is still on the roster — it is drawn from the resolved tree, not
      // from the container the switched-off row left no fiber in — so the
      // settings page can turn it back on.
      expect(ready.info.roster?.some((entry) => entry.name === CONTEXT)).toBe(true);

      // An explicit ask states the same thing: `null` is a REAL state (the pane
      // drops its tab), not "no news".
      await drive(rig.controller, rig.conn, { type: 'context' });
      expect(rig.conn.lastContext()?.timeline).toBeNull();
    });
  });

  it('reads the session once its row is on, on the baseline and on demand', async () => {
    await withFakeHome(async () => {
      const rig = await makeRig({ entries: [{ id: CONTEXT, enabled: true }] });
      // First paint: the baseline carries the reading, so the tab can be drawn
      // without waiting for a round trip.
      const baseline = readyOf(rig).info.context;
      expect(baseline).toBeDefined();
      expect(baseline?.live.elements.some((element) => element.cat === 'injected')).toBe(true);

      await drive(rig.controller, rig.conn, { type: 'context' });
      const answer = rig.conn.lastContext();
      expect(answer).toBeDefined();
      expect(answer?.timeline).not.toBeNull();
      expect(answer?.timeline?.live.elements.length).toBeGreaterThan(0);
    });
  });

  it('tells every client when the provider appears and when it goes away', async () => {
    await withFakeHome(async () => {
      // Both context providers start off: the shipped row is written OFF in the
      // document (so the reading cannot come from it), and the stand-in is the
      // second provider the flip toggles.
      const rig = await makeRig({
        entries: [{ id: CONTEXT, enabled: false }, { id: STANDIN, enabled: false }],
        standin: true,
      });
      const { controller, conn } = rig;
      expect(readyOf(rig).info.context).toBeUndefined();

      await drive(controller, conn, { type: 'set_plugin_enabled', name: STANDIN, enabled: true });
      // No ask was sent: the flip itself is what makes the panel state the new
      // reading, so a reader that never opened the tab still learns about it.
      expect(conn.lastContext()?.timeline).not.toBeNull();

      await drive(controller, conn, { type: 'set_plugin_enabled', name: STANDIN, enabled: false });
      // OFF: the provider is gone, and the panel must be told — a null timeline
      // is a REAL state (the pane drops its tab), not "no news".
      expect(conn.lastContext()?.timeline).toBeNull();
    });
  });

  it('flips a MODULE-SPECIFIER row over the wire, not just a built-in name', async () => {
    await withFakeHome(async () => {
      const rig = await makeRig({ entries: [{ id: CONTEXT, enabled: true }] });
      const { controller, conn } = rig;
      expect(readyOf(rig).info.context).toBeDefined();

      // The row id is `@nova-agent/plugin-context` — a scope, a name, and a `/`.
      // A switch-name grammar anchored on `[a-z0-9]` rejected exactly this shape,
      // so the settings panel could not turn any extension row on or off and the
      // refusal blamed the operator's input. The check must accept what the
      // roster actually contains.
      await drive(controller, conn, { type: 'set_plugin_enabled', name: CONTEXT, enabled: false });
      // An unrelated frame is enough: availability is re-read after EVERY frame,
      // so the flip cannot be missed by a client that is looking elsewhere.
      await drive(controller, conn, { type: 'list_jobs' });
      expect(conn.lastContext()?.timeline).toBeNull();
      // …and the flip was ACCEPTED, answered with the refreshed row list rather
      // than a refusal (a refusal would be an `error` frame instead).
      const answer = conn.frames.findLast(
        (frame): frame is Extract<ServerFrame, { type: 'plugins' }> => frame.type === 'plugins',
      );
      expect(answer?.entries.find((entry) => entry.name === CONTEXT)?.enabled).toBe(false);
      expect(conn.frames.some((frame) => frame.type === 'error')).toBe(false);

      // Back on, so the round trip is closed in both directions.
      await drive(controller, conn, { type: 'set_plugin_enabled', name: CONTEXT, enabled: true });
      expect(conn.lastContext()?.timeline).not.toBeNull();
    });
  });

  it('bounds the widened switch grammar at the transport', async () => {
    await withFakeHome(async () => {
      await makeRig({ entries: [] });
      // A row id may be a module specifier, but it is still a TOKEN: whitespace
      // and quotes never reach the kernel. (What may be WRITTEN is a separate
      // guard — the kernel refuses an id that matches no row, which
      // `manage-frames.test.ts` pins; a path-shaped string is merely a dead row.)
      for (const name of ['a b', 'a"b', "a'b", 'a\\b', '']) {
        expect(parseClientFrame(JSON.stringify({ type: 'set_plugin_enabled', name, enabled: false })))
          .toHaveProperty('reason');
      }
      // The specifier shapes the roster really contains all parse.
      for (const name of [CONTEXT, '@nova-agent/plugin-ptc', './local.mjs', 'todo']) {
        expect(parseClientFrame(JSON.stringify({ type: 'set_plugin_enabled', name, enabled: false })))
          .toMatchObject({ type: 'set_plugin_enabled', name, enabled: false });
      }
      // A SKILL name keeps the narrow grammar — it really is a plain identifier.
      expect(parseClientFrame(JSON.stringify({ type: 'set_skill_enabled', name: 'my-skill', enabled: false })))
        .toMatchObject({ type: 'set_skill_enabled', name: 'my-skill' });
      expect(parseClientFrame(JSON.stringify({ type: 'set_skill_enabled', name: '@scope/skill', enabled: false })))
        .toHaveProperty('reason');
    });
  });

  it('clears the reading when the shipped context row is switched off', async () => {
    await withFakeHome(async () => {
      const rig = await makeRig({ entries: [{ id: CONTEXT, enabled: true }] });
      const { controller, conn, kernel } = rig;
      expect(readyOf(rig).info.context).toBeDefined();

      // Also flipped through the kernel here: the two doors must agree, and this
      // pins the kernel half independently of the transport assertion above.
      await kernel.setPluginEnabled(CONTEXT, false);
      await drive(controller, conn, { type: 'list_jobs' });
      expect(conn.lastContext()?.timeline).toBeNull();

      // A client attaching later agrees: the baseline has no reading to draw.
      const fresh = new FakeConn();
      controller.attach(fresh);
      const ready = fresh.frames.find((frame) => frame.type === 'ready');
      expect(ready?.type === 'ready' ? ready.info.context : 'missing').toBeUndefined();
    });
  });
});
