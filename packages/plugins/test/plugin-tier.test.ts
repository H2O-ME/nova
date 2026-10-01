/**
 * The plugin TIER contract — one assertion per defect this work exists to fix.
 *
 * These are deliberately about the three reported symptoms rather than about
 * the code's shape, because each symptom had a plausible-looking implementation
 * behind it and none of them failed a test:
 *
 *  - **an `extra` (third-party) plugin could not be turned off**: its name was
 *    spread into the host raw, bypassing the filter entirely, and was left out
 *    of the typo check too. Both are pinned here against a REAL kernel.
 *  - **`jobs` could not be turned off, and the error named a plugin the operator
 *    never saw**: a capability PROVIDER and a TOOL plugin shared the name
 *    `jobs`, and the hand-maintained load-bearing list took the provider's side.
 *  - **`subagent` was always on although it is opt-in**: the roster passed it
 *    unconditionally, so the row existed and worked but no default-off contract
 *    held.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider } from '@nova-agent/core';
import {
  CORE_PLUGINS,
  createAgentKernel,
  enabledByTier,
  impliedOptIns,
  isCorePlugin,
  labelFor,
  pluginTier,
  unknownDisabled,
} from '../src/index.js';

function provider(): ChatProvider {
  return {
    async *stream() {
      yield { type: 'text_delta', text: 'ok' } as const;
    },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nova-tier-'));
}

/**
 * A third-party plugin module on disk, in the PUBLIC plugin shape. Written to a
 * temp dir because `plugins.extra` takes a path and the loader goes through a
 * real dynamic `import` — a stub would not exercise the path that broke.
 */
async function writeExtra(dir: string): Promise<string> {
  const file = path.join(dir, 'third-party.mjs');
  await writeFile(
    file,
    'export default { name: "third-party", inject: ["commands"], apply(ctx) { ctx.effect(() => ctx.must("commands").register({ name: "tp", description: "probe", run: () => "ok" }), "tp"); } };\n',
    'utf8',
  );
  return file;
}

/** A kernel with a recording persister, so both ends of a flip are observable. */
async function assemble(extraPath?: string): Promise<{
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  pluginsOff: string[];
  enabled: string[];
}> {
  const pluginsOff: string[] = [];
  const enabled: string[] = [];
  const kernel = await createAgentKernel({
    rootDir: await tmp(),
    provider: provider(),
    config: {
      approval: 'read-only',
      ...(extraPath !== undefined ? { plugins: { extra: [extraPath] } } : {}),
    },
    sessionDir: await tmp(),
    persistConfig: {
      setPluginEnabled: (name, on) => {
        if (on) pluginsOff.splice(pluginsOff.indexOf(name), 1);
        else if (!pluginsOff.includes(name)) pluginsOff.push(name);
        return Promise.resolve([...pluginsOff]);
      },
      setSkillEnabled: () => Promise.resolve([]),
      setPluginEnabledList: (names) => {
        enabled.splice(0, enabled.length, ...names);
        return Promise.resolve([...enabled]);
      },
    },
  });
  return { kernel, pluginsOff, enabled };
}

/** A kernel whose `code.mode` is `ptc`, i.e. an advanced plugin already opted in
 * by the config's own second door onto it. */
async function assemblePtc(): Promise<{
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  pluginsOff: string[];
  enabled: string[];
}> {
  const pluginsOff: string[] = [];
  const enabled: string[] = [];
  const kernel = await createAgentKernel({
    rootDir: await tmp(),
    provider: provider(),
    config: { approval: 'read-only', code: { mode: 'ptc' } },
    sessionDir: await tmp(),
    persistConfig: {
      setPluginEnabled: (name, on) => {
        if (on) {
          const at = pluginsOff.indexOf(name);
          if (at >= 0) pluginsOff.splice(at, 1);
        } else if (!pluginsOff.includes(name)) pluginsOff.push(name);
        return Promise.resolve([...pluginsOff]);
      },
      setSkillEnabled: () => Promise.resolve([]),
      setPluginEnabledList: (names) => {
        enabled.splice(0, enabled.length, ...names);
        return Promise.resolve([...enabled]);
      },
    },
  });
  return { kernel, pluginsOff, enabled };
}

describe('the tier table', () => {
  it('tells the jobs PROVIDER from the jobs TOOL', () => {
    // The name collision that made the tool's switch throw: "core services are
    // load-bearing" applied to the tool plugin too, because the two shared a
    // name. The provider was renamed `jobs-service`; only that one is core.
    expect(isCorePlugin('jobs')).toBe(false);
    expect(isCorePlugin('jobs-service')).toBe(true);
    expect(pluginTier('jobs')).toBe('standard');
  });

  it('keeps the load-bearing set and the label table in one place', () => {
    for (const name of CORE_PLUGINS) expect(pluginTier(name), name).toBe('core');
    // Every name the panel can draw has Chinese words, and a name it has never
    // heard of keeps its own identifier rather than getting an invented label.
    expect(labelFor('fs-read').title).toBe('读取文件');
    expect(labelFor('who-knows').title).toBe('who-knows');
    expect(labelFor('who-knows').description).toBe('');
  });

  it('decides by disable → enable → tier default, with disable winning', () => {
    // `disable` priority is the SAFETY side: an operator who turned something
    // off means it, and a stale hint must not silently turn it back on.
    expect(enabledByTier('subagent', { enable: ['subagent'], disable: ['subagent'] })).toBe(false);
    expect(enabledByTier('subagent', { enable: ['subagent'] })).toBe(true);
    expect(enabledByTier('subagent', {})).toBe(false);
    expect(enabledByTier('bash', {})).toBe(true);
    expect(enabledByTier('bash', { disable: ['bash'] })).toBe(false);
    // Unknown names fail OPEN to switchable-and-on: making a third-party plugin
    // un-switchable is the defect, not the safety net.
    expect(enabledByTier('some-third-party', {})).toBe(true);
  });

  it('offers the context reading as an advanced opt-in with words of its own', () => {
    // The Context panel's whole on/off: the plugin is OFF until asked for (the
    // service it provides is what the web surface renders the pane from), and
    // its row is drawn by a person, so it needs Chinese words rather than the
    // identifier `context`.
    expect(pluginTier('context')).toBe('advanced');
    expect(enabledByTier('context', {})).toBe(false);
    expect(enabledByTier('context', { enable: ['context'] })).toBe(true);
    expect(labelFor('context').title).toBe('上下文洞察');
    expect(labelFor('context').description.length).toBeGreaterThan(0);
  });

  it('lets the off-switch beat a derived second-door opt-in', () => {    // `enabledByTier` already puts `disable` first; the DERIVATION must agree, or
    // the switch is a lie — the row reads OFF and the next roster puts the plugin
    // back (the reported "开关会自动打开"). Two plugins have such a door: `ptc`'s
    // non-`native` code mode, and `qqbot`'s stored credentials.
    expect(enabledByTier('ptc', { enable: ['ptc'], disable: ['ptc'] })).toBe(false);
    expect(impliedOptIns(['ptc', 'qqbot'], ['ptc'])).toEqual(['qqbot']);
    // With nothing switched off the derivation stands: that is the upgrade path a
    // config written before the tier table relies on.
    expect(impliedOptIns(['ptc'], undefined)).toEqual(['ptc']);
    expect(impliedOptIns(['ptc'], [])).toEqual(['ptc']);
  });
});

describe('defect A · a third-party plugin really can be turned off', () => {
  it('unloads it, and keeps its row so it can be turned back on', async () => {
    const extra = await writeExtra(await tmp());
    const { kernel } = await assemble(extra);
    // It is in the roster to begin with, which is the precondition for the
    // operator ever seeing a switch for it.
    expect(kernel.roster().some((row) => row.name === 'third-party' && row.enabled)).toBe(true);

    await kernel.setPluginEnabled('third-party', false);

    const row = kernel.roster().find((entry) => entry.name === 'third-party');
    expect(row?.enabled).toBe(false);
    expect(row?.state).toBe('disabled');
    // The real claim: it is gone from the LIVE container, not merely listed as
    // off. Before the fix the name was spread into the host raw, so the command
    // it registers stayed reachable and the flip either threw or did nothing.
    expect(kernel.roster().some((entry) => entry.name === 'third-party' && entry.enabled)).toBe(false);
    expect(kernel.commands.some((command) => command.name === 'tp')).toBe(false);
  });

  it('the typo check sees extras too, so a known extra is not called a typo', async () => {
    // The same line that skipped filtering also skipped the typo check, so a
    // misspelled `disable` entry was silent for extras. Pinned on the pure
    // function, because "the name is known" is exactly what it decides.
    const extra = { name: 'third-party', apply: () => undefined };
    expect(unknownDisabled([extra], ['third-party'])).toEqual([]);
    // Omit it from the known list and the same name IS a typo — which is what
    // the roster used to do by leaving `extra` out of its argument.
    expect(unknownDisabled([], ['third-party'])).toEqual(['third-party']);
  });
});

describe('defect B · core rows refuse, and the tool named jobs does not', () => {
  it('refuses every core name instead of taking the tool surface down', async () => {
    const { kernel, pluginsOff } = await assemble();
    for (const name of CORE_PLUGINS) {
      await expect(kernel.setPluginEnabled(name, false), name).rejects.toThrowError(/load-bearing/u);
    }
    // Nothing was persisted for a refused flip: the file must not record a
    // switch the kernel declined to apply.
    expect(pluginsOff).toEqual([]);
  });

  it('turns the jobs TOOL off, and the provider keeps serving', async () => {
    const { kernel } = await assemble();
    await kernel.setPluginEnabled('jobs', false);
    // The tool is gone…
    expect(kernel.host.tools.some((tool) => tool.name === 'jobs')).toBe(false);
    // …while the capability it reads through is still provided, which is the
    // half that must never be switchable.
    expect(kernel.jobs).toBeDefined();
    expect(kernel.roster().find((row) => row.name === 'jobs-service')?.enabled).toBe(true);
  });
});

describe('defect C · an advanced plugin is opt-in', () => {
  it('keeps subagent out of the loaded set, then loads it once enabled', async () => {
    const { kernel, enabled } = await assemble();
    // Not loaded by default…
    const off = kernel.roster().find((row) => row.name === 'subagent');
    expect(off?.enabled).toBe(false);
    expect(off?.tier).toBe('advanced');
    expect(kernel.host.tools.some((tool) => tool.name === 'subagent')).toBe(false);

    // …and one flip puts it in the live tool set.
    await kernel.setPluginEnabled('subagent', true);
    expect(enabled).toContain('subagent');
    expect(kernel.host.tools.some((tool) => tool.name === 'subagent')).toBe(true);
    expect(kernel.roster().find((row) => row.name === 'subagent')?.enabled).toBe(true);
  });

  it('writes the OUT-OF-TIER list, never the one that would lock it off', async () => {
    const { kernel, enabled, pluginsOff } = await assemble();
    await kernel.setPluginEnabled('subagent', true);
    // `disable` wins over `enable`, so an opt-in written to `disable` would be a
    // one-way door: the very next click could not bring it back.
    expect(pluginsOff).not.toContain('subagent');
    await kernel.setPluginEnabled('subagent', false);
    expect(enabled).not.toContain('subagent');
    expect(pluginsOff).not.toContain('subagent');
  });

  it('honours a boot-time enable list for an advanced plugin', async () => {
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider(),
      config: { approval: 'read-only', plugins: { enable: ['ptc'] } },
      sessionDir: await tmp(),
    });
    expect(kernel.roster().find((row) => row.name === 'ptc')?.enabled).toBe(true);
  });

  it('lets ptc be turned OFF and back ON while code.mode says ptc', async () => {
    // The row's own one-way door, found while testing this work. `ptc` has a
    // SECOND opt-in an `enable`-list write cannot reach: a non-`native`
    // `code.mode` is translated into an `enable` entry by the roster
    // (`codeModeOptIn`), so deleting the name from the list left the plugin
    // loaded and the flip threw "still loaded after disabling" — a switch that
    // errors instead of working, i.e. the exact defect class this task fixes.
    // Both directions are asserted because the cure (writing `disable`, which
    // WINS over the derived `enable`) must not become the door facing the other.
    const { kernel, pluginsOff, enabled } = await assemblePtc();
    expect(kernel.roster().find((row) => row.name === 'ptc')?.enabled).toBe(true);

    await kernel.setPluginEnabled('ptc', false);
    expect(kernel.roster().find((row) => row.name === 'ptc')?.enabled).toBe(false);
    expect(pluginsOff).toContain('ptc');
    // The live mode follows the row, so the page's two doors onto PTC (this row
    // and the mode selector) cannot disagree about whether it is on.
    expect(kernel.codeMode()).toBe('native');

    await kernel.setPluginEnabled('ptc', true);
    expect(kernel.roster().find((row) => row.name === 'ptc')?.enabled).toBe(true);
    expect(pluginsOff).not.toContain('ptc');
    expect(enabled).toContain('ptc');
    // And the entry that made it work is gone, so the next boot is not stuck off.
    const restarted = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider(),
      config: { approval: 'read-only', code: { mode: 'ptc' }, plugins: { disable: [...pluginsOff], enable: [...enabled] } },
      sessionDir: await tmp(),
    });
    expect(restarted.roster().find((row) => row.name === 'ptc')?.enabled).toBe(true);
  });
});
