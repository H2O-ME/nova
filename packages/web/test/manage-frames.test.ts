/**
 * The settings panel's management frames (`manage-frames.ts`): the plugin
 * manager's switch, the Skill 中心's rows and switch.
 *
 * Driven through a REAL `WebController`, so these cover the whole path a click
 * takes — validated frame → router → kernel → persisted row → answer frame. The
 * claims worth pinning:
 *
 *  - the answer is STATE (a fresh roster / row list), never an optimistic echo,
 *    and the row it reports is the row the live container really has;
 *  - ONE field per row is written: a flip goes through the row's own `enabled`,
 *    the same field the boot path reads — there is no second list and no
 *    tier-routed writer left to disagree with it;
 *  - `ready` carries the live roster (the settings nav derives its pages from
 *    it), so a cold start does not need a second ask;
 *  - a refusal is an `error` frame and NOTHING is written — neither for a
 *    load-bearing (`core`) row nor for a name that is in no row;
 *  - an extension row whose module cannot load reads `state: 'failed'` WITH its
 *    reason, because every failed treatment in the panel keys off that state;
 *  - a persister failure is an `error` frame, not a crash, and the host keeps
 *    serving;
 *  - a DISABLED skill is still in the answer, marked off — the regression that
 *    made the Skill 中心's switch one-way, since a row read from the filtered
 *    list vanishes on the very flip that disables it.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest, PluginEntryOptions, StreamEvent } from '@nova-agent/core';
import { createAgentKernel } from '@nova-agent/plugins';
import type { PluginEntryConfig } from '@nova-agent/plugins';
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
  last<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }> | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const frame = this.frames[i];
      if (frame?.type === type) return frame as Extract<ServerFrame, { type: T }>;
    }
    return undefined;
  }
}

/** Write one skill under `<root>/.nova/skills/name/SKILL.md`. */
async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, '.nova', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBODY`, 'utf8');
}

/** One write the "config file" received: the row id and the fields patched. */
interface EntryWrite {
  id: string;
  patch: { enabled?: boolean; config?: unknown };
}

interface Rig {
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  controller: WebController;
  conn: FakeConn;
  /** The frames the attach itself produced (the `ready` baseline). */
  attachFrames: readonly ServerFrame[];
  /** Every row write, in order — the ONE field a switch is allowed to touch. */
  writes: EntryWrite[];
  /** The config file as the persister left it (the rows the roster reads). */
  rows: (PluginEntryConfig & { config?: Record<string, unknown> })[];
}

async function makeRig(opts: {
  /** The operator's `plugins.entries`, as the file would hold them at boot. */
  entries?: PluginEntryConfig[];
  skills?: boolean;
  /** Make the config file unwritable, i.e. a save that fails. */
  persistThrows?: boolean;
  /** Boot with NO config port at all (a headless assembly with no file). */
  noPersist?: boolean;
  /** Rows the shell contributes at assembly (a plugin the operator did not name). */
  extraPlugins?: readonly PluginEntryOptions[];
} = {}): Promise<Rig> {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-manage-root-'));
  if (opts.skills === true) {
    await writeSkill(root, 'alpha', 'first skill');
    await writeSkill(root, 'beta', 'second skill');
  }
  const rows: Rig['rows'] = (opts.entries ?? []).map((entry) => ({ ...entry }));
  const writes: EntryWrite[] = [];
  const skillsOff: string[] = [];
  const kernel = await createAgentKernel({
    rootDir: root,
    provider: provider(),
    // `rows` IS the operator's `plugins.entries`, and every write below lands in
    // it: the row list the kernel resolves its tree from is the one thing both
    // the boot path and a save read, so a flip that only recorded a write
    // somewhere else would be a flip nothing re-rostered on. (That the kernel
    // currently resolves from the list captured at ASSEMBLY is a live defect with
    // its own tripwire, `packages/plugins/test/runtime-switch.test.ts`.)
    config: { approval: 'read-only', plugins: { entries: rows } },
    ...(opts.extraPlugins !== undefined ? { extraPlugins: [...opts.extraPlugins] } : {}),
    ...(opts.noPersist === true
      ? {}
      : {
          persist: {
            // The reference-preserving reader: one row, as the document holds it.
            readPluginEntry: (id: string) => Promise.resolve(rows.find((row) => row.id === id)),
            setPluginEntry: (id: string, patch: EntryWrite['patch']) => {
              if (opts.persistThrows === true) throw new Error('disk is on fire');
              writes.push({ id, patch });
              const row = rows.find((candidate) => candidate.id === id);
              if (row === undefined) rows.push({ id, ...patch });
              else Object.assign(row, patch);
              return Promise.resolve();
            },
            setSkillEnabled: (name: string, enabled: boolean) => {
              if (opts.persistThrows === true) throw new Error('disk is on fire');
              const at = skillsOff.indexOf(name);
              if (enabled) {
                if (at >= 0) skillsOff.splice(at, 1);
              } else if (at < 0) skillsOff.push(name);
              return Promise.resolve([...skillsOff]);
            },
          },
        }),
  });
  const controller = await WebController.create({ kernel, providerModelLabel: 'test-model' });
  const conn = new FakeConn();
  controller.attach(conn);
  const attachFrames = [...conn.frames];
  conn.frames.length = 0;
  return { kernel, controller, conn, attachFrames, writes, rows };
}

async function drive(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

/** The `ready` baseline of an attach, typed. */
function readyOf(rig: Rig): Extract<ServerFrame, { type: 'ready' }> {
  const ready = rig.attachFrames.find((frame) => frame.type === 'ready');
  if (ready?.type !== 'ready') throw new Error('no ready frame');
  return ready;
}

describe('plugin manager frames', () => {
  it('carries the live roster in the ready baseline, without a roster ask', async () => {
    // The cold-start defect: the settings NAV derives which pages exist from the
    // roster, but the `roster` frame is only requested by the plugins panel. A
    // restart followed by opening 设置 therefore drew the page of a plugin the
    // operator had switched off — so the baseline itself has to say so.
    const rig = await makeRig({ entries: [{ id: 'todo', enabled: false }] });
    const ready = readyOf(rig);
    const row = ready.info.roster?.find((entry) => entry.name === 'todo');
    // The row is present and reads OFF: absence would be the wrong answer too —
    // an unknown row must not hide a page. A switched-off row is drawn from the
    // resolved tree, not from the live container it left no fiber in.
    expect(row).toBeDefined();
    expect(row?.enabled).toBe(false);
    expect(ready.info.configPath).toBeTruthy();
    // And no `roster` frame was ever requested: this is the baseline alone.
    expect(rig.conn.frames.some((frame) => frame.type === 'roster')).toBe(false);
  });

  it('answers a flip with the new roster, and the row really went off', async () => {
    const rig = await makeRig();
    const { controller, conn } = rig;
    await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
    const answer = conn.last('plugins');
    expect(answer).toBeDefined();
    expect(answer?.disable).toContain('todo');
    // The row is still there and reads OFF, so the same page can turn it back.
    expect(answer?.entries.find((entry) => entry.name === 'todo')?.enabled).toBe(false);
    // "Off" is literal: the tool the row registers is gone from the container.
    expect(rig.kernel.host.tools.some((tool) => tool.name === 'todo_write')).toBe(false);

    await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: true });
    const back = conn.last('plugins');
    expect(back?.disable).not.toContain('todo');
    expect(back?.entries.find((entry) => entry.name === 'todo')?.enabled).toBe(true);
    expect(rig.kernel.host.tools.some((tool) => tool.name === 'todo_write')).toBe(true);

    // Both directions wrote the row's OWN `enabled` field and nothing else: one
    // field, addressed by row id, which is the same field the boot path reads.
    expect(rig.writes).toEqual([
      { id: 'todo', patch: { enabled: false } },
      { id: 'todo', patch: { enabled: true } },
    ]);
  });

  it('carries tier and Chinese title on both the roster and the flip answer', async () => {
    // Two paths build these rows (the `roster` frame and the `plugins` answer);
    // the panel's first paint reads the first and every flip reads the second,
    // so a field missing from either is a page that changes language mid-use.
    const rig = await makeRig();
    const { controller, conn } = rig;
    await drive(controller, conn, { type: 'roster' });
    const roster = conn.last('roster');
    const fsRead = roster?.entries.find((entry) => entry.name === 'fs-read');
    expect(fsRead?.tier).toBe('core');
    expect(fsRead?.title).toBe('读取文件');

    await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
    const answer = conn.last('plugins');
    // The extension row ships OFF and says so, with the words its own manifest
    // declares — the host has no table of plugin labels any more.
    expect(answer?.entries.find((entry) => entry.name === '@nova-agent/plugin-ptc'))
      .toMatchObject({ tier: 'advanced', enabled: false, title: 'PTC 代码模式' });
    expect(answer?.entries.find((entry) => entry.name === 'fs-read')?.title).toBe('读取文件');
  });

  it('carries a plugin-declared client bundle onto the wire, and omits it otherwise', async () => {
    // The boot graph's PRODUCER half. The browser loads a plugin's browser-side
    // bundle only because the plugin's own manifest declared one, and the roster
    // row is how that declaration reaches the page. Both consumers existed (the
    // wire builder downstream, `loadBootGraph` upstream) while nothing wrote the
    // field at all, so every roster row said "server-only" no matter what the
    // plugin declared.
    const bundled: PluginEntryOptions['plugin'] = {
      name: 'bundled-probe',
      manifest: {
        title: '带浏览器半的插件',
        description: 'ships a browser-side bundle',
        tier: 'standard',
        clientBundle: { rev: 'r1' },
      },
      apply: () => undefined,
    };
    const serverOnly: PluginEntryOptions['plugin'] = {
      name: 'server-only-probe',
      manifest: { title: '纯服务端插件', description: 'declares no browser bundle', tier: 'standard' },
      apply: () => undefined,
    };
    const rig = await makeRig({
      extraPlugins: [
        { id: 'bundled-probe', plugin: bundled },
        { id: 'server-only-probe', plugin: serverOnly },
      ],
    });
    const roster = readyOf(rig).info.roster ?? [];
    // Verbatim, and nothing invented: the `path` default belongs to the loader
    // that builds the URL, not to the row that carries the declaration.
    expect(roster.find((entry) => entry.name === 'bundled-probe')?.clientBundle).toEqual({ rev: 'r1' });
    // Absence, not an empty object — a plugin that ships no bundle must not claim
    // one. (Checked with `in` because the row crosses the socket as JSON, where an
    // `undefined`-valued key and a missing key are the same bytes but not the same
    // contract for a reader asking which plugins have a browser half.)
    const plain = roster.find((entry) => entry.name === 'server-only-probe');
    if (plain === undefined) throw new Error('the server-only probe row is missing');
    expect('clientBundle' in plain).toBe(false);
    // The projection is total: no other row invented one either.
    expect(roster.filter((entry) => entry.clientBundle !== undefined).map((entry) => entry.name))
      .toEqual(['bundled-probe']);
  });

  it('refuses a load-bearing plugin as an error frame and writes nothing', async () => {
    const rig = await makeRig();
    const { controller, conn } = rig;
    // `fs-read` is the agent's reach: a `core` row has no switch to flip.
    await drive(controller, conn, { type: 'set_plugin_enabled', name: 'fs-read', enabled: false });
    const err = conn.last('error');
    expect(err?.message).toMatch(/load-bearing/u);
    expect(rig.writes).toEqual([]);
    // No roster frame either: a refusal is not a state change.
    expect(conn.last('plugins')).toBeUndefined();
    // …and the row is untouched in the file, so a restart still finds it on.
    expect(rig.rows.find((row) => row.id === 'fs-read')?.enabled).toBeUndefined();
  });

  it('refuses an unknown plugin name and writes nothing', async () => {
    const rig = await makeRig();
    await drive(rig.controller, rig.conn, { type: 'set_plugin_enabled', name: 'nope', enabled: false });
    expect(rig.conn.last('error')?.message).toMatch(/unknown plugin/u);
    expect(rig.writes).toEqual([]);
  });

  it('carries a failed extension row with its reason (state failed, not merely off)', async () => {
    // An enabled extension whose package cannot load must reach the panel as
    // `state: 'failed'` WITH the reason: every failed treatment in the UI
    // (group count, sort-to-top, 失败 label) keys off that state, and without
    // `error` the reader sees a switch that is on with nothing loaded and no
    // explanation.
    const missing = path.join(await mkdtemp(path.join(tmpdir(), 'nova-manage-missing-')), 'missing-ext.mjs');
    const rig = await makeRig({ entries: [{ id: missing, enabled: true }] });
    // The baseline the panel first paints from carries it too…
    const baseline = readyOf(rig).info.roster?.find((entry) => entry.name === missing);
    expect(baseline?.state).toBe('failed');
    expect(baseline?.error).toBeTruthy();
    // …and so does an explicit ask.
    await drive(rig.controller, rig.conn, { type: 'roster' });
    const row = rig.conn.last('roster')?.entries.find((entry) => entry.name === missing);
    expect(row).toBeDefined();
    expect(row?.state).toBe('failed');
    expect(row?.enabled).toBe(false);
    expect(row?.error).toBeTruthy();
  });

  it('surfaces a persister failure as an error frame, not a crash', async () => {
    const rig = await makeRig({ persistThrows: true });
    await drive(rig.controller, rig.conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
    // The write throws BEFORE anything reloads, so the answer names the failure
    // and no half-applied state is reported as if it had landed.
    expect(rig.conn.last('error')?.message).toMatch(/disk is on fire/u);
    expect(rig.conn.last('plugins')).toBeUndefined();
    // The host is still serving: the panel's next read answers.
    await drive(rig.controller, rig.conn, { type: 'roster' });
    expect(rig.conn.last('roster')).toBeDefined();
  });
});

describe('Skill 中心 frames', () => {
  it('lists every discovered skill, with its real switch state', async () => {
    const rig = await makeRig({ skills: true });
    await drive(rig.controller, rig.conn, { type: 'list_skills' });
    const answer = rig.conn.last('skills');
    expect(answer?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
    expect(answer?.disable).toEqual([]);
    expect(answer?.items.every((item) => item.enabled)).toBe(true);
  });

  it('keeps a DISABLED skill in the answer so the switch is reversible', async () => {
    const rig = await makeRig({ skills: true });
    await drive(rig.controller, rig.conn, { type: 'set_skill_enabled', name: 'alpha', enabled: false });
    const answer = rig.conn.last('skills');
    // The regression this pins: the rows used to be built from `kernel.skills`
    // — the FILTERED list — with `enabled` hardcoded true. So this flip removed
    // alpha from the answer entirely and the panel could never turn it back on.
    expect(answer?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
    expect(answer?.items.find((item) => item.name === 'alpha')?.enabled).toBe(false);
    expect(answer?.items.find((item) => item.name === 'beta')?.enabled).toBe(true);
    expect(answer?.disable).toEqual(['alpha']);
    // …and the model-visible list really dropped it, so "off" is not just a label.
    expect(rig.kernel.skills.map((skill) => skill.name)).toEqual(['beta']);
  });

  it('reports the disable list on a plain re-list, not an empty one', async () => {
    const rig = await makeRig({ skills: true });
    await drive(rig.controller, rig.conn, { type: 'set_skill_enabled', name: 'beta', enabled: false });
    // A fresh open of the section: the panel must learn beta is off, or it
    // draws it as on and the operator's next click is a no-op.
    await drive(rig.controller, rig.conn, { type: 'list_skills' });
    const answer = rig.conn.last('skills');
    expect(answer?.disable).toEqual(['beta']);
    expect(answer?.items.find((item) => item.name === 'beta')?.enabled).toBe(false);
  });

  it('refuses an unknown skill name and leaves the index alone', async () => {
    const rig = await makeRig({ skills: true });
    await drive(rig.controller, rig.conn, { type: 'set_skill_enabled', name: 'ghost', enabled: false });
    expect(rig.conn.last('error')?.message).toMatch(/unknown skill/u);
    await drive(rig.controller, rig.conn, { type: 'list_skills' });
    expect(rig.conn.last('skills')?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('management frames with no persistence wired', () => {
  it('refuses a flip instead of pretending it landed', async () => {
    // A headless assembly (or an embedded kernel) has no config file of the
    // operator's to patch: the switch must say so rather than report a state the
    // next boot would not find.
    const rig = await makeRig({ noPersist: true });
    await drive(rig.controller, rig.conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
    expect(rig.conn.last('error')?.message).toMatch(/writable config file/u);
    expect(rig.conn.last('plugins')).toBeUndefined();
  });
});
