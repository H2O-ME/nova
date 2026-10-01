/**
 * The settings panel's switches: `setPluginEnabled` / `setSkillEnabled` and the
 * roster the plugin manager draws.
 *
 * These run against a REAL kernel (`createAgentKernel`) rather than a stub,
 * because every claim here is about the live container agreeing with the
 * persisted list — a stub would assert the stub. What is pinned:
 *
 *  - a flip reaches the live roster, not just the config file;
 *  - a DISABLED plugin still has a row (from the manifest), so the page that
 *    turned it off can turn it back on;
 *  - a DISABLED skill still appears in `allSkills`, for the same reason — the
 *    regression that made the Skill 中心's switch one-way;
 *  - a name that persists but never loads is refused rather than written.
 *
 * The flip subjects below are mostly `standard`-tier (`bash`, `todo`): those
 * are the rows whose switch writes `plugins.disable`, which is what this
 * file's persister records. An `advanced` row writes the other list — a plain
 * one (`subagent`) is covered in `plugin-tier.test.ts`, and the rows with a
 * SECOND opt-in door (`qqbot`; `ptc` follows through its code-mode tie) write
 * BOTH lists and are pinned here.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider, StreamEvent } from '@nova-agent/core';
import { createAgentKernel, NON_DISABLABLE_PLUGINS } from '../src/index.js';

/** A provider that always answers with one short text; no network. */
function provider(): ChatProvider {
  return {
    async *stream() {
      yield { type: 'text_delta', text: 'ok' } satisfies StreamEvent;
    },
  };
}

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nova-switch-'));
}

/** Write one skill under `<root>/name/SKILL.md`. */
async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBODY`, 'utf8');
}

/**
 * Assemble a kernel with a recording persister. `disable` starts empty and the
 * persister appends to the same arrays the kernel's state carries, so a test can
 * assert both ends.
 */
async function assemble(opts: {
  home?: string;
  skills?: boolean;
  /** Kernel-side `plugins` config (enable/extra) for the advanced-row tests. */
  plugins?: { enable?: string[]; extra?: string[] };
} = {}): Promise<{
  kernel: Awaited<ReturnType<typeof createAgentKernel>>;
  pluginsOff: string[];
  pluginsOn: string[];
  skillsOff: string[];
}> {
  const root = await tmp();
  if (opts.skills === true) {
    await writeSkill(path.join(root, '.nova', 'skills'), 'alpha', 'first skill');
    await writeSkill(path.join(root, '.nova', 'skills'), 'beta', 'second skill');
  }
  const pluginsOff: string[] = [];
  const pluginsOn: string[] = [];
  const skillsOff: string[] = [];
  const kernel = await createAgentKernel({
    rootDir: root,
    provider: provider(),
    config: { approval: 'read-only', ...(opts.plugins !== undefined ? { plugins: opts.plugins } : {}) },
    sessionDir: await tmp(),
    persistConfig: {
      setPluginEnabled: (name, enabled) => {
        if (enabled) {
          const at = pluginsOff.indexOf(name);
          if (at >= 0) pluginsOff.splice(at, 1);
        } else if (!pluginsOff.includes(name)) pluginsOff.push(name);
        return Promise.resolve([...pluginsOff]);
      },
      setPluginEnabledList: (names: readonly string[]) => {
        pluginsOn.length = 0;
        pluginsOn.push(...names);
        return Promise.resolve([...names]);
      },
      setSkillEnabled: (name, enabled) => {
        if (enabled) {
          const at = skillsOff.indexOf(name);
          if (at >= 0) skillsOff.splice(at, 1);
        } else if (!skillsOff.includes(name)) skillsOff.push(name);
        return Promise.resolve([...skillsOff]);
      },
    },
  });
  return { kernel, pluginsOff, pluginsOn, skillsOff };
}

describe('describePlugins', () => {
  it('lists every known plugin with its origin and tier, and the on-by-default ones are loaded', async () => {
    const { kernel } = await assemble();
    const rows = kernel.roster();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['builtin', 'surface', 'extra', 'extension', 'capability']).toContain(row.origin);
      expect(['core', 'standard', 'advanced']).toContain(row.tier);
      // The tier contract: everything except `advanced` is on at boot; an
      // advanced row is present but OFF until `plugins.enable` names it.
      expect(row.enabled, `${row.name} default`).toBe(row.tier !== 'advanced');
    }
    // The built-ins an operator recognizes are present and named as such.
    const bash = rows.find((row) => row.name === 'bash');
    expect(bash?.origin).toBe('builtin');
    expect(bash?.tier).toBe('standard');
    // Every row carries the Chinese words the panel draws.
    expect(rows.every((row) => row.title.length > 0)).toBe(true);
  });

  it('keeps a DISABLED plugin as a row so the page can turn it back on', async () => {
    const { kernel } = await assemble();
    await kernel.setPluginEnabled('todo', false);
    const off = kernel.roster().find((row) => row.name === 'todo');
    // The regression this pins: a disabled plugin leaves no fiber, so without
    // the manifest it would vanish from the very panel that disables it.
    expect(off).toBeDefined();
    expect(off?.enabled).toBe(false);
    expect(off?.state).toBe('disabled');
    // And it is really gone from the live container.
    expect(kernel.roster().some((row) => row.name === 'todo' && row.enabled)).toBe(false);
    expect(kernel.host.tools.some((tool) => tool.name === 'todo_write')).toBe(false);
    expect(kernel.disabled.plugins).toContain('todo');
  });

  it('turns a disabled plugin back on and reports it enabled again', async () => {
    const { kernel, pluginsOff } = await assemble();
    await kernel.setPluginEnabled('todo', false);
    const back = await kernel.setPluginEnabled('todo', true);
    expect(back).not.toContain('todo');
    expect(pluginsOff).not.toContain('todo');
    const row = kernel.roster().find((entry) => entry.name === 'todo');
    expect(row?.enabled).toBe(true);
    expect(row?.state).not.toBe('disabled');
  });

  it('writes BOTH lists for a second-door advanced row (qqbot), so a close survives restart', async () => {
    // The reported defect: closing the qqbot switch removed the derived
    // `enable` entry only. The config's own `qqbot` block is an opt-in hint
    // boot re-derives into `enable`, so the close left no trace in the file
    // and the switch "opened itself" on the next boot. The one list that
    // derivation yields to is `disable` — so the flip must write it too.
    const module = path.join(await tmp(), 'qqbot.mjs');
    await writeFile(module, 'export default { name: "qqbot", apply() {} };\n', 'utf8');
    const { kernel, pluginsOff, pluginsOn } = await assemble({
      plugins: { enable: ['qqbot'], extra: [module] },
    });
    // Sanity: an advanced row loads only when `enable` names it.
    expect(kernel.roster().find((row) => row.name === 'qqbot')?.enabled).toBe(true);
    await kernel.setPluginEnabled('qqbot', false);
    // BOTH lists moved: out of `enable`, and into `disable` — the trace the
    // boot-time derivation yields to (`impliedOptIns`).
    expect(pluginsOn).not.toContain('qqbot');
    expect(pluginsOff).toContain('qqbot');
    expect(kernel.disabled.plugins).toContain('qqbot');
    expect(kernel.roster().find((row) => row.name === 'qqbot')?.enabled).toBe(false);
    // Back on: BOTH entries clear, or the leftover `disable` becomes the same
    // one-way door facing the other way.
    await kernel.setPluginEnabled('qqbot', true);
    expect(pluginsOn).toContain('qqbot');
    expect(pluginsOff).not.toContain('qqbot');
    expect(kernel.roster().find((row) => row.name === 'qqbot')?.enabled).toBe(true);
  });

  it('refuses a load-bearing plugin instead of taking the tool surface down', async () => {
    const { kernel, pluginsOff } = await assemble();
    for (const name of NON_DISABLABLE_PLUGINS) {
      await expect(kernel.setPluginEnabled(name, false), name).rejects.toThrowError(/load-bearing/u);
    }
    // Nothing was persisted for a refused flip: the file must not record a
    // switch the kernel declined to apply.
    expect(pluginsOff).toEqual([]);
    // The list is DERIVED from the tier table, not a second hand-kept one: the
    // stale entry it used to carry (`jobs`, the capability PROVIDER) locked the
    // model-facing `jobs` TOOL out of its own switch.
    expect(NON_DISABLABLE_PLUGINS).not.toContain('jobs');
    expect(NON_DISABLABLE_PLUGINS).toContain('jobs-service');
  });

  it('refuses a name that is in no roster, rather than writing a dead entry', async () => {
    const { kernel, pluginsOff } = await assemble();
    await expect(kernel.setPluginEnabled('not-a-plugin', false)).rejects.toThrowError(/unknown plugin/u);
    expect(pluginsOff).toEqual([]);
  });

  it('loads a plugin back that the BOOT config had disabled', async () => {
    // Re-roster used to UNION the boot document's `disable` list with the live
    // one, which made a boot-time entry immortal: the flip cleared it from the
    // file and from the live state, the plugin still did not load, and the flip
    // threw "did not load after enabling" — a switch that errors instead of
    // working, against a row the operator had just switched on.
    const pluginsOff = ['todo'];
    const kernel = await createAgentKernel({
      rootDir: await tmp(),
      provider: provider(),
      config: { approval: 'read-only', plugins: { disable: ['todo'] } },
      sessionDir: await tmp(),
      persistConfig: {
        setPluginEnabled: (name, enabled) => {
          if (enabled) pluginsOff.splice(pluginsOff.indexOf(name), 1);
          else if (!pluginsOff.includes(name)) pluginsOff.push(name);
          return Promise.resolve([...pluginsOff]);
        },
        setSkillEnabled: () => Promise.resolve([]),
      },
    });
    expect(kernel.roster().find((row) => row.name === 'todo')?.enabled).toBe(false);

    const back = await kernel.setPluginEnabled('todo', true);

    expect(back).not.toContain('todo');
    expect(kernel.roster().find((row) => row.name === 'todo')?.enabled).toBe(true);
    expect(kernel.host.tools.some((tool) => tool.name === 'todo_write')).toBe(true);
  });
});

describe('skill switches', () => {
  it('keeps a DISABLED skill on the management list (allSkills)', async () => {
    const { kernel } = await assemble({ home: '', skills: true });
    expect(kernel.allSkills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
    await kernel.setSkillEnabled('alpha', false);
    // The filtered list — what the model sees — drops it.
    expect(kernel.skills.map((skill) => skill.name)).toEqual(['beta']);
    // The discovery list keeps it, which is the ONLY reason the panel can still
    // show the row that turns it back on. This is the regression: reading the
    // panel's rows from `skills` made the switch one-way.
    expect(kernel.allSkills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
    expect(kernel.disabled.skills).toContain('alpha');
  });

  it('turns a disabled skill back on and restores it to the model-visible list', async () => {
    const { kernel, skillsOff } = await assemble({ home: '', skills: true });
    await kernel.setSkillEnabled('alpha', false);
    const back = await kernel.setSkillEnabled('alpha', true);
    expect(back).not.toContain('alpha');
    expect(skillsOff).not.toContain('alpha');
    expect(kernel.skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('refuses a skill name nothing discovers, instead of storing a dead entry', async () => {
    const { kernel, skillsOff } = await assemble({ home: '', skills: true });
    await expect(kernel.setSkillEnabled('ghost', false)).rejects.toThrowError(/unknown skill/u);
    expect(skillsOff).toEqual([]);
    // And the index is left exactly as it was: the refusal path re-reads the
    // workspace, so a throw must not leave the filter half-applied.
    expect(kernel.allSkills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
    expect(kernel.skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('subtracts the boot-time skills.disable list from the start', async () => {
    const root = await tmp();
    await writeSkill(path.join(root, '.nova', 'skills'), 'alpha', 'first skill');
    await writeSkill(path.join(root, '.nova', 'skills'), 'beta', 'second skill');
    const kernel = await createAgentKernel({
      rootDir: root,
      provider: provider(),
      config: { approval: 'read-only', skillsDisable: ['alpha'] },
      sessionDir: await tmp(),
      persistConfig: {
        setPluginEnabled: () => Promise.resolve([]),
        setSkillEnabled: () => Promise.resolve([]),
      },
    });
    expect(kernel.skills.map((skill) => skill.name)).toEqual(['beta']);
    // Still discoverable, so the panel lists it as OFF rather than not at all.
    expect(kernel.allSkills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
    expect(kernel.disabled.skills).toEqual(['alpha']);
  });
});
