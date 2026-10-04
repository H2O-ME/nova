/**
 * The generic browser↔plugin seam (`plugin-frames.ts`): ONE frame pair for every
 * plugin, driven through a REAL `WebController`.
 *
 * This file replaces `qqbot-frames.test.ts`, which pinned a hand-written frame
 * family per first-party plugin (`qqbot` / `save_qqbot` / `test_qqbot` plus a
 * typed snapshot, a persister and a runtime threaded through the controller
 * options). Those frames and options are deleted; the claims worth keeping are
 * about the GENERIC path, so they are pinned once, with a stand-in plugin that
 * owns a namespace — the same slot a real channel or execution plugin fills.
 *
 * What is pinned:
 *
 *  - `page` answers the plugin's own `PluginPageDescriptor`, host-added nothing;
 *  - `save` reaches the plugin (which persists through `pluginConfig`) and the
 *    answer is the REFRESHED descriptor — and a submitted secret never comes
 *    back on the wire;
 *  - `action` reports its own failure as an ANSWER (`ok: false` + message), not
 *    an `error` frame;
 *  - a throwing operation, and a namespace nobody owns (a switched-off plugin
 *    has none), are both answers: one plugin's fault never takes the socket —
 *    or the host — down;
 *  - an operation that answers nothing omits `result`, which is how a page tells
 *    "no answer" from "the answer is literally null".
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  pluginConfig as pluginConfigKey,
  pluginRpc as pluginRpcKey,
  type ChatProvider,
  type Context,
  type Plugin,
  type PluginPageDescriptor,
  type StreamEvent,
} from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import type { PluginEntryConfig } from '@nova-agent/plugins';
import { parseClientFrame } from '../src/client-frame.js';
import { WebController } from '../src/controller.js';
import type { ClientFrame, ServerFrame } from '../src/protocol.js';
import type { WsConnection } from '../src/ws.js';

/** The row id the stand-in plugin registers its namespace under. */
const DEMO = 'demo-settings';

/** One plugin row as the "config file" holds it (the persist port's store). */
interface StoredRow {
  id: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

function provider(): ChatProvider {
  return {
    async *stream() {
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
  last<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame?.type === type) return frame as Extract<ServerFrame, { type: T }>;
    }
    return undefined;
  }
}

/**
 * A stand-in plugin that owns a settings page.
 *
 * It answers the three operations the page contract names (`page` / `save` /
 * `action`), plus two that exercise the failure rules: `boom` throws, `silent`
 * answers nothing. `save` writes through `pluginConfig` — the same single field
 * the panel's own switch writes — and the descriptor it returns reports only
 * WHETHER a secret is stored, never the secret.
 */
function demoPlugin(): Plugin {
  return {
    name: DEMO,
    manifest: { title: '演示设置', description: 'a plugin-owned settings page', tier: 'standard', page: true },
    inject: [pluginRpcKey, pluginConfigKey],
    apply: (ctx: Context): void => {
      let stored: Record<string, string> = {};
      const descriptor = (): PluginPageDescriptor => ({
        title: '演示设置',
        intro: 'the plugin owns this page',
        status: [{ label: '账号', value: stored['appId'] ?? '未配置' }],
        fields: [
          { key: 'appId', label: 'AppID', kind: 'text', ...(stored['appId'] !== undefined ? { value: stored['appId'] } : {}) },
          // A secret field carries a HINT at most: the value never leaves the
          // process that holds it (core's `PluginPageDescriptor` rule).
          { key: 'secret', label: '密钥', kind: 'secret', hint: stored['secret'] === undefined ? '未配置' : '已保存' },
        ],
        actions: [{ id: 'test', label: '测试连接' }],
      });
      ctx.effect(
        () =>
          ctx.must(pluginRpcKey).register(DEMO, async (op, payload) => {
            switch (op) {
              case 'page':
                return descriptor();
              case 'save': {
                const fields = (payload as { fields?: Record<string, string> } | undefined)?.fields ?? {};
                stored = { ...stored, ...fields };
                // The durable half goes through the port, exactly as a real
                // plugin's page does: one writer, addressed by row id.
                await ctx.must(pluginConfigKey).setEntry(DEMO, { enabled: true, config: stored });
                return descriptor();
              }
              case 'action': {
                const action = payload as { id?: string } | undefined;
                if (action?.id !== 'test') return { ok: false, message: `unknown action "${action?.id ?? ''}"` };
                return { ok: true, message: 'wss://gateway.example' };
              }
              case 'boom':
                throw new Error('the handler exploded');
              case 'silent':
                return undefined;
              default:
                throw new Error(`demo-settings: unknown operation "${op}"`);
            }
          }),
        `rpc(${DEMO})`,
      );
    },
  };
}

interface Rig {
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  controller: WebController;
  conn: FakeConn;
  /** The "config file" as the persist port left it. */
  rows: StoredRow[];
}

/**
 * Assemble a kernel the way the shell does, plus the controller over it.
 *
 * `entries` is the operator's `plugins.entries`, and the persist port keeps that
 * SAME list in step with each write — the durable row is what the roster is
 * built from, which is the one field both the boot path and a plugin's own save
 * go through.
 */
async function makeRig(entries: PluginEntryConfig[] = []): Promise<Rig> {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-plugin-frames-'));
  const rows: StoredRow[] = entries.map((entry) => ({ ...entry }));
  const kernel = await createAgentKernel({
    rootDir: root,
    provider: provider(),
    config: { approval: 'read-only', plugins: { entries: rows } },
    extraPlugins: [{ id: DEMO, plugin: demoPlugin() }],
    persist: {
      readPluginEntry: (id) => Promise.resolve(rows.find((row) => row.id === id)),
      setPluginEntry: (id, patch) => {
        const row = rows.find((candidate) => candidate.id === id);
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
  conn.frames.length = 0;
  return { kernel, controller, conn, rows };
}

async function drive(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

/** One `plugin_request`, driven through the real controller and answered. */
async function call(
  rig: Rig,
  request: { id: number; plugin: string; op: string; payload?: unknown },
): Promise<Extract<ServerFrame, { type: 'plugin_response' }>> {
  await drive(rig.controller, rig.conn, { type: 'plugin_request', ...request });
  const answer = rig.conn.last('plugin_response');
  if (answer === undefined) throw new Error('no plugin_response');
  return answer;
}

describe('the generic plugin request frame', () => {
  it('answers `page` with the plugin’s own descriptor, and adds nothing', async () => {
    const rig = await makeRig();
    const answer = await call(rig, { id: 1, plugin: DEMO, op: 'page' });
    // The row the browser correlates on comes back verbatim: a page with two
    // requests in flight must not render one answer as the other's.
    expect(answer).toMatchObject({ type: 'plugin_response', id: 1, plugin: DEMO, op: 'page', ok: true });
    // …and the response shape is exactly the six documented fields: the host is
    // not in the conversation, so it has nothing of its own to add.
    expect(Object.keys(answer).sort()).toEqual(['id', 'ok', 'op', 'plugin', 'result', 'type']);
    const descriptor = answer.result as PluginPageDescriptor;
    expect(descriptor.title).toBe('演示设置');
    expect(descriptor.fields?.map((field) => field.key)).toEqual(['appId', 'secret']);
    expect(descriptor.actions?.map((action) => action.id)).toEqual(['test']);
  });

  it('routes `save` through pluginConfig and answers the refreshed descriptor', async () => {
    const rig = await makeRig();
    const answer = await call(rig, {
      id: 2,
      plugin: DEMO,
      op: 'save',
      payload: { fields: { appId: '2048', secret: 's3cret' } },
    });
    expect(answer.ok).toBe(true);
    // The answer is the state AFTER the write, so the page renders what was
    // stored rather than what was typed.
    expect((answer.result as PluginPageDescriptor).status?.[0]?.value).toBe('2048');
    // The write landed on the plugin's OWN row, through the one port.
    expect(rig.rows.find((row) => row.id === DEMO)).toMatchObject({
      enabled: true,
      config: { appId: '2048', secret: 's3cret' },
    });
    // And the secret did not come back: the descriptor says one is stored, the
    // frame carries no value for it.
    expect(JSON.stringify(answer)).not.toContain('s3cret');
    expect((answer.result as PluginPageDescriptor).fields?.find((field) => field.key === 'secret'))
      .toMatchObject({ kind: 'secret', hint: '已保存' });
  });

  it('reports an action’s own failure as an answer, not an error frame', async () => {
    const rig = await makeRig();
    const ok = await call(rig, { id: 3, plugin: DEMO, op: 'action', payload: { id: 'test' } });
    expect(ok).toMatchObject({ ok: true, result: { ok: true, message: 'wss://gateway.example' } });

    const bad = await call(rig, { id: 4, plugin: DEMO, op: 'action', payload: { id: 'nope' } });
    // Two different questions, two different answers. The frame's `ok` says the
    // operation RAN; the action's own verdict travels as its result, so the page
    // renders "that button is not implemented" beside the button it came from —
    // and neither one is a protocol failure.
    expect(bad).toMatchObject({ id: 4, ok: true, result: { ok: false } });
    expect((bad.result as { message: string }).message).toMatch(/unknown action/u);
    expect(rig.conn.last('error')).toBeUndefined();
  });

  it('isolates a throwing operation: an answer with the reason, host still up', async () => {
    const rig = await makeRig();
    const answer = await call(rig, { id: 5, plugin: DEMO, op: 'boom' });
    expect(answer).toMatchObject({ id: 5, ok: false, error: expect.stringContaining('the handler exploded') });
    expect(rig.conn.last('error')).toBeUndefined();
    // The socket and the host survive one plugin's fault: the next request is
    // answered normally.
    const after = await call(rig, { id: 6, plugin: DEMO, op: 'page' });
    expect(after.ok).toBe(true);
  });

  it('answers a namespace nobody owns instead of hanging or crashing', async () => {
    const rig = await makeRig();
    const answer = await call(rig, { id: 7, plugin: 'ghost', op: 'page' });
    expect(answer).toMatchObject({ id: 7, plugin: 'ghost', op: 'page', ok: false });
    expect(answer.error).toMatch(/no loaded plugin answers/u);
    // The host is still serving: a roster read answers right after.
    await drive(rig.controller, rig.conn, { type: 'roster' });
    expect(rig.conn.last('roster')).toBeDefined();
  });

  it('gives a switched-off plugin no namespace at all', async () => {
    // The row exists and is off: the plugin never ran, so nothing registered.
    const rig = await makeRig([{ id: DEMO, enabled: false }]);
    const answer = await call(rig, { id: 8, plugin: DEMO, op: 'page' });
    expect(answer).toMatchObject({ id: 8, ok: false });
    expect(answer.error).toMatch(/no loaded plugin answers/u);
    expect(rig.kernel.roster().find((row) => row.name === DEMO)?.enabled).toBe(false);
  });

  it('omits `result` when an operation answers nothing', async () => {
    // JSON has one empty value, so an `ok: true` with `result: null` would make
    // "the plugin said nothing" indistinguishable from "the answer is null".
    const rig = await makeRig();
    const answer = await call(rig, { id: 9, plugin: DEMO, op: 'silent' });
    expect(answer.ok).toBe(true);
    expect('result' in answer).toBe(false);
  });

  it('refuses a malformed request before it reaches any plugin', async () => {
    // The transport's own bounds (a correlation id that fits in a double, an
    // operation name that can be logged) are the host's business; everything
    // past this belongs to the plugin.
    expect(parseClientFrame(JSON.stringify({ type: 'plugin_request', id: -1, plugin: DEMO, op: 'page' })))
      .toMatchObject({ ok: false });
    expect(parseClientFrame(JSON.stringify({ type: 'plugin_request', id: 1, plugin: DEMO, op: 'not an op' })))
      .toMatchObject({ ok: false });
    expect(parseClientFrame(JSON.stringify({ type: 'plugin_request', id: 1, plugin: 'has space', op: 'page' })))
      .toMatchObject({ ok: false });
  });
});
