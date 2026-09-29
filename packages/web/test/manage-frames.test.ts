/**
 * The settings panel's management frames (`manage-frames.ts`): the plugin
 * manager's switch, the Skill 中心's rows and switch, the qqbot page.
 *
 * Driven through a REAL `WebController`, so these cover the whole path a click
 * takes — validated frame → router → kernel → persisted list → answer frame.
 * The claims worth pinning:
 *
 *  - the answer is STATE (a fresh roster / row list), never an optimistic echo;
 *  - a DISABLED skill is still in the answer, marked off — the regression that
 *    made the Skill 中心's switch one-way, since a row read from the filtered
 *    list vanishes on the very flip that disables it;
 *  - `list_skills` reports the real disable list rather than an empty one;
 *  - the qqbot snapshot never carries the secret;
 *  - a refusal is an `error` frame, and nothing is written.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, ChatRequest, KernelEvent, StreamEvent } from '@nova-agent/core';
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
  events(): KernelEvent[] {
    return this.frames.filter((f) => f.type === 'event').map((f) => (f as { event: KernelEvent }).event);
  }
}

async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-manage-home-'));
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

/** Write one skill under `<root>/.nova/skills/name/SKILL.md`. */
async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, '.nova', 'skills', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBODY`, 'utf8');
}

interface Rig {
  controller: WebController;
  conn: FakeConn;
  /** The lists the injected persister holds (the "config file"). */
  pluginsOff: string[];
  pluginsOn: string[];
  skillsOff: string[];
  sent: unknown[];
}

async function makeRig(opts: {
  skills?: boolean;
  qqBot?: boolean;
  persistThrows?: boolean;
  /** Boot the kernel with PTC on, i.e. an advanced row already opted in. */
  codeMode?: 'ptc';
  /** Provide a live-channel runtime whose `stop` lands in `sent` (see the qqbot-off test). */
  liveQqBot?: boolean;
  /** Keep the attach frames (the rig clears them so flip tests read only flip answers). */
  keepFrames?: boolean;
  /** Boot with these plugins switched off in the config, as a restart would. */
  bootDisable?: string[];
} = {}): Promise<Rig> {
  const root = await mkdtemp(path.join(tmpdir(), 'nova-manage-root-'));
  if (opts.skills === true) {
    await writeSkill(root, 'alpha', 'first skill');
    await writeSkill(root, 'beta', 'second skill');
  }
  const pluginsOff: string[] = [];
  const pluginsOn: string[] = [];
  const skillsOff: string[] = [];
  const sent: unknown[] = [];
  const controller = await WebController.create({
    rootDir: root,
    provider: provider(),
    config: {
      approval: 'read-only',
      ...(opts.codeMode !== undefined ? { code: { mode: opts.codeMode } } : {}),
      ...(opts.bootDisable !== undefined ? { plugins: { disable: [...opts.bootDisable] } } : {}),
    },
    providerModelLabel: 'test-model',
    persistConfig: {
      setPluginEnabled: (name, enabled) => {
        if (opts.persistThrows === true) throw new Error('disk is on fire');
        if (enabled) {
          const at = pluginsOff.indexOf(name);
          if (at >= 0) pluginsOff.splice(at, 1);
        } else if (!pluginsOff.includes(name)) pluginsOff.push(name);
        return Promise.resolve([...pluginsOff]);
      },
      // The OPT-IN half: `advanced` rows write this list, never `disable`
      // (`disable` wins over `enable`, so writing an opt-in there would be a
      // one-way door).
      setPluginEnabledList: (names) => {
        if (opts.persistThrows === true) throw new Error('disk is on fire');
        pluginsOn.splice(0, pluginsOn.length, ...names);
        return Promise.resolve([...pluginsOn]);
      },
      setSkillEnabled: (name, enabled) => {
        if (opts.persistThrows === true) throw new Error('disk is on fire');
        if (enabled) {
          const at = skillsOff.indexOf(name);
          if (at >= 0) skillsOff.splice(at, 1);
        } else if (!skillsOff.includes(name)) skillsOff.push(name);
        return Promise.resolve([...skillsOff]);
      },
    },
    ...(opts.qqBot === true
      ? {
          persistQqBot: (saved: { appId?: string; clientSecret?: string }) => { sent.push(saved); },
          qqBotConfig: { appId: '1024', hasClientSecret: true, clientSecretRef: 'QQ_SECRET' },
          testQqBot: (probe: { appId: string; clientSecret: string }) => {
            sent.push(probe);
            return probe.clientSecret === 'good' ? Promise.resolve('wss://gw') : Promise.reject(new Error('bad token'));
          },
        }
      : {}),
    ...(opts.liveQqBot === true
      ? {
          // The real shell injects its qqbot plugin via `extraPlugins` (the
          // bridge's plugin joins the roster at assembly); without a row named
          // qqbot the flip is refused as unknown before `stop` could matter.
          extraPlugins: [{ name: 'qqbot', apply: () => {} }],
          qqBotRuntime: {
            running: () => false,
            // The seam this test pins: turning the row OFF must reach the
            // gateway hang-up (the recorder makes that observable frame-out).
            stop: () => {
              sent.push('qqbot-stopped');
            },
          },
        }
      : {}),
  });
  const conn = new FakeConn();
  controller.attach(conn);
  if (opts.keepFrames !== true) conn.frames.length = 0;
  return { controller, conn, pluginsOff, pluginsOn, skillsOff, sent };
}

async function drive(controller: WebController, conn: FakeConn, json: unknown): Promise<void> {
  const frame = parseClientFrame(JSON.stringify(json));
  if ('ok' in frame) throw new Error(`frame rejected: ${frame.reason}`);
  await controller.handle(conn, frame as ClientFrame);
}

describe('plugin manager frames', () => {
  it('carries the live roster in the ready baseline, without a roster ask', async () => {
    // The cold-start defect: the settings NAV derives which pages exist from the
    // roster, but the `roster` frame is only requested by the plugins panel. A
    // restart followed by opening 设置 therefore drew the page of a plugin the
    // operator had switched off — so the baseline itself has to say so.
    await withFakeHome(async () => {
      // `liveQqBot` supplies the shell's qqbot plugin row (the same
      // `extraPlugins` seam `nova --web` uses); without a row there would be
      // nothing for the baseline to report.
      const { conn } = await makeRig({ keepFrames: true, liveQqBot: true, bootDisable: ['qqbot'] });
      const ready = conn.frames.find((frame) => frame.type === 'ready');
      expect(ready).toBeDefined();
      // The row is present and reads OFF: absence would be the wrong answer too
      // — an unknown row must not hide a page (`?? true` in the nav).
      const row = ready?.info.roster?.find((entry) => entry.name === 'qqbot');
      expect(row).toBeDefined();
      expect(row?.enabled).toBe(false);
      expect(ready?.info.configPath).toBeTruthy();
      // And no `roster` frame was ever requested: this is the baseline alone.
      expect(conn.frames.some((frame) => frame.type === 'roster')).toBe(false);
    });
  });

  it('answers a flip with the new roster AND the list in force', async () => {
    await withFakeHome(async () => {
      // `todo` is `standard` (its switch writes `plugins.disable`) and
      // `subagent` is `advanced` (its switch writes `plugins.enable`): the two
      // directions are different lists, so one test covers each.
      const { controller, conn, pluginsOff, pluginsOn } = await makeRig();
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
      const answer = conn.last('plugins');
      expect(answer).toBeDefined();
      expect(answer?.disable).toContain('todo');
      // The row is still there and reads OFF, so the same page can turn it back.
      const row = answer?.entries.find((entry) => entry.name === 'todo');
      expect(row).toBeDefined();
      expect(row?.enabled).toBe(false);
      expect(pluginsOff).toEqual(['todo']);

      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: true });
      const back = conn.last('plugins');
      expect(back?.disable).not.toContain('todo');
      expect(back?.entries.find((entry) => entry.name === 'todo')?.enabled).toBe(true);

      // The advanced direction: it was never in `disable` to begin with, and
      // opting in appends to `enable` instead.
      expect(answer?.entries.find((entry) => entry.name === 'subagent')?.enabled).toBe(false);
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'subagent', enabled: true });
      expect(pluginsOn).toEqual(['subagent']);
      expect(pluginsOff).toEqual([]);
      expect(conn.last('plugins')?.entries.find((entry) => entry.name === 'subagent')?.enabled).toBe(true);
    });
  });

  it('carries tier and Chinese title on both the roster and the flip answer', async () => {
    // Two paths build these rows (the `roster` frame and the `plugins` answer);
    // the panel's first paint reads the first and every flip reads the second,
    // so a field missing from either is a page that changes language mid-use.
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig();
      await drive(controller, conn, { type: 'roster' });
      const roster = conn.last('roster');
      const fsRead = roster?.entries.find((entry) => entry.name === 'fs-read');
      expect(fsRead?.tier).toBe('core');
      expect(fsRead?.title).toBe('读取文件');

      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
      const answer = conn.last('plugins');
      expect(answer?.entries.find((entry) => entry.name === 'subagent')?.tier).toBe('advanced');
      expect(answer?.entries.find((entry) => entry.name === 'fs-read')?.title).toBe('读取文件');
    });
  });

  it('refuses a load-bearing plugin as an error frame and writes nothing', async () => {
    await withFakeHome(async () => {
      const { controller, conn, pluginsOff } = await makeRig();
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'toolbox', enabled: false });
      const err = conn.last('error');
      expect(err?.message).toMatch(/load-bearing/u);
      expect(pluginsOff).toEqual([]);
      // No roster frame either: a refusal is not a state change.
      expect(conn.last('plugins')).toBeUndefined();
    });
  });

  it('turns the advanced ptc row off through the frame, mode and all', async () => {
    // The browser is where a reader actually hits the one-way door: `ptc` has a
    // second opt-in the frame cannot reach by name alone (a non-`native`
    // `code.mode` becomes an `enable` entry), so a flip that only edited the
    // enable list left the plugin loaded and answered with an `error` frame
    // instead of a roster. Driven frame-in/frame-out because that is the
    // contract the panel depends on.
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ codeMode: 'ptc' });
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'ptc', enabled: false });
      // An ANSWER, not a refusal: the switch worked.
      expect(conn.last('error')).toBeUndefined();
      const answer = conn.last('plugins');
      expect(answer?.entries.find((entry) => entry.name === 'ptc')?.enabled).toBe(false);
      // And its row survives, so the same page can turn it back on.
      expect(answer?.entries.some((entry) => entry.name === 'ptc')).toBe(true);
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'ptc', enabled: true });
      expect(conn.last('plugins')?.entries.find((entry) => entry.name === 'ptc')?.enabled).toBe(true);
    });
  });

  it('hangs up the live gateway when the qqbot row is turned off', async () => {
    // The reported defect: the gateway lives in the shell's bridge, NOT inside
    // the plugin's effects, so the roster flip alone unregisters the tools and
    // leaves the socket open — the page said 已关闭 while QQ peers still reached
    // the agent. Only the qqbot OFF direction may touch the channel.
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ liveQqBot: true });
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'qqbot', enabled: false });
      expect(sent).toContain('qqbot-stopped');
      // Re-enabling never dials the hang-up again, and other rows stay away.
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'qqbot', enabled: true });
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
      expect(sent.filter((entry) => entry === 'qqbot-stopped')).toHaveLength(1);
      // And the flip still answered a roster, not a refusal.
      expect(conn.last('plugins')?.entries.find((entry) => entry.name === 'qqbot')?.enabled).toBe(true);
    });
  });

  it('refuses an unknown plugin name', async () => {
    await withFakeHome(async () => {
      const { controller, conn, pluginsOff } = await makeRig();
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'nope', enabled: false });
      expect(conn.last('error')?.message).toMatch(/unknown plugin/u);
      expect(pluginsOff).toEqual([]);
    });
  });

  it('surfaces a persister failure as an error frame, not a crash', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ persistThrows: true });
      // `todo` (standard → the disable writer) and `subagent` (advanced → the
      // enable-list writer) are BOTH failures the reader must hear about; a
      // surface that only wired one writer would swallow the other.
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'todo', enabled: false });
      expect(conn.last('error')?.message).toMatch(/disk is on fire/u);
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'subagent', enabled: true });
      expect(conn.last('error')?.message).toMatch(/disk is on fire/u);
    });
  });
});

describe('Skill 中心 frames', () => {
  it('lists every discovered skill, with its real switch state', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ skills: true });
      await drive(controller, conn, { type: 'list_skills' });
      const answer = conn.last('skills');
      expect(answer?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
      expect(answer?.disable).toEqual([]);
      expect(answer?.items.every((item) => item.enabled)).toBe(true);
    });
  });

  it('keeps a DISABLED skill in the answer so the switch is reversible', async () => {
    await withFakeHome(async () => {
      const { controller, conn, skillsOff } = await makeRig({ skills: true });
      await drive(controller, conn, { type: 'set_skill_enabled', name: 'alpha', enabled: false });
      const answer = conn.last('skills');
      // The regression this pins: the rows used to be built from `kernel.skills`
      // — the FILTERED list — with `enabled` hardcoded true. So this flip removed
      // alpha from the answer entirely and the panel could never turn it back on.
      expect(answer?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
      expect(answer?.items.find((item) => item.name === 'alpha')?.enabled).toBe(false);
      expect(answer?.items.find((item) => item.name === 'beta')?.enabled).toBe(true);
      expect(answer?.disable).toEqual(['alpha']);
      expect(skillsOff).toEqual(['alpha']);
    });
  });

  it('reports the disable list on a plain re-list, not an empty one', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ skills: true });
      await drive(controller, conn, { type: 'set_skill_enabled', name: 'beta', enabled: false });
      // A fresh open of the section: the panel must learn beta is off, or it
      // draws it as on and the operator's next click is a no-op.
      await drive(controller, conn, { type: 'list_skills' });
      const answer = conn.last('skills');
      expect(answer?.disable).toEqual(['beta']);
      expect(answer?.items.find((item) => item.name === 'beta')?.enabled).toBe(false);
    });
  });

  it('refuses an unknown skill name and leaves the index alone', async () => {
    await withFakeHome(async () => {
      const { controller, conn, skillsOff } = await makeRig({ skills: true });
      await drive(controller, conn, { type: 'set_skill_enabled', name: 'ghost', enabled: false });
      expect(conn.last('error')?.message).toMatch(/unknown skill/u);
      expect(skillsOff).toEqual([]);
      await drive(controller, conn, { type: 'list_skills' });
      expect(conn.last('skills')?.items.map((item) => item.name).sort()).toEqual(['alpha', 'beta']);
    });
  });
});

describe('qqbot frames', () => {
  it('answers with the snapshot and NEVER the secret', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'qqbot' });
      const answer = conn.last('qqbot');
      expect(answer).toMatchObject({ appId: '1024', hasClientSecret: true, clientSecretRef: 'QQ_SECRET' });
      // The wire frame must not carry a credential field at all.
      expect(JSON.stringify(answer)).not.toMatch(/clientSecret"/u);
    });
  });

  it('routes a save to the persister and echoes the new snapshot', async () => {
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'save_qqbot', appId: '2048', clientSecret: 'sekret' });
      expect(sent).toContainEqual({ appId: '2048', clientSecret: 'sekret' });
      expect(conn.last('qqbot')?.appId).toBe('2048');
    });
  });

  it('treats an empty secret field as "keep what is stored"', async () => {
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'save_qqbot', appId: '2048', clientSecret: '' });
      // The browser never holds the stored secret, so it cannot send it back —
      // an empty field must not blank the credential the operator kept.
      expect(sent).toContainEqual({ appId: '2048' });
      expect(sent).not.toContainEqual({ appId: '2048', clientSecret: '' });
      expect(conn.last('qqbot')?.hasClientSecret).toBe(true);
    });
  });

  it('refuses an empty appId', async () => {
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'save_qqbot', appId: '   ', clientSecret: 'x' });
      expect(conn.last('error')?.message).toMatch(/appId/u);
      expect(sent).toEqual([]);
    });
  });

  it('reports a failed connection test as a qqbot_test frame, not an error', async () => {
    await withFakeHome(async () => {
      const { controller, conn } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'test_qqbot', appId: '1', clientSecret: 'bad' });
      // "The credentials are wrong" is an ANSWER to the probe, not a protocol
      // failure: the page shows it beside the button it came from.
      expect(conn.last('qqbot_test')).toMatchObject({ ok: false });
      expect(conn.last('qqbot_test')?.ok === false ? conn.last('qqbot_test')?.message : '').toMatch(/bad token/u);
      expect(conn.last('error')).toBeUndefined();
    });
  });

  it('reports a successful probe with the gateway URL and stores nothing', async () => {
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'test_qqbot', appId: '1', clientSecret: 'good' });
      expect(conn.last('qqbot_test')).toEqual({ type: 'qqbot_test', ok: true, gateway: 'wss://gw' });
      // A test is a probe: the candidate secret must not reach persistence.
      expect(sent).toContainEqual({ appId: '1', clientSecret: 'good' });
      expect(sent).toHaveLength(1);
    });
  });

  it('refuses a probe with a missing field without calling the transport', async () => {
    await withFakeHome(async () => {
      const { controller, conn, sent } = await makeRig({ qqBot: true });
      await drive(controller, conn, { type: 'test_qqbot', appId: '1', clientSecret: '' });
      expect(conn.last('error')?.message).toMatch(/appId 与密钥/u);
      expect(sent).toEqual([]);
    });
  });
});

describe('management frames with no persistence wired', () => {
  it('refuses a flip instead of pretending it landed', async () => {
    await withFakeHome(async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'nova-manage-nop-'));
      const controller = await WebController.create({
        rootDir: root,
        provider: provider(),
        config: { approval: 'read-only' },
        providerModelLabel: 'test-model',
      });
      const conn = new FakeConn();
      controller.attach(conn);
      conn.frames.length = 0;
      await drive(controller, conn, { type: 'set_plugin_enabled', name: 'subagent', enabled: false });
      expect(conn.last('error')?.message).toMatch(/persist/u);
      expect(conn.last('plugins')).toBeUndefined();
    });
  });
});
