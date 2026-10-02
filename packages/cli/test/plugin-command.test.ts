/**
 * `nova plugin add|remove|list` — the user plugin root's command surface.
 *
 * The package manager is injected: the repo's tests do not go to the network, so
 * the fake installers below write the very package layout `npm install` would —
 * into `~/.nova/plugins/node_modules/<name>` (the isolated test home) — and the
 * command's own decisions (what it writes to the config, in what ORDER, and what
 * it refuses) are what these cases pin.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userConfigPath, userPluginsDir } from '@nova-agent/core';
import { readExtraPlugins } from '../src/config-read.js';
import { packageNameOf, runPluginCommand, type PluginRunOutcome } from '../src/plugin-command.js';

// Each case gets its own home: these tests mutate the config file and the plugin
// root, and the suite-wide isolated home is per FILE — one case's install would
// otherwise be the next case's starting state.
let home: string;
let prevProfile: string | undefined;
let prevHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-plugin-cmd-'));
  prevProfile = process.env['USERPROFILE'];
  prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
});

afterEach(() => {
  if (prevProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevProfile;
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
});

/** A package the shape a plugin author publishes: `exports` + a plugin default. */
async function writePackage(
  name: string,
  body = 'export default { name: "fake", apply: () => {} };\n',
): Promise<void> {
  const dir = path.join(userPluginsDir(), 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './index.mjs' } }),
  );
  await writeFile(path.join(dir, 'index.mjs'), body);
}

/** A no-op installer: tests that only care about the config write. */
const ok = async (): Promise<PluginRunOutcome> => ({ ok: true });

describe('packageNameOf', () => {
  it('strips a version or tag — the config row holds the bare name Node imports', () => {
    expect(packageNameOf('nova-x')).toBe('nova-x');
    expect(packageNameOf('nova-x@1.2.3')).toBe('nova-x');
    expect(packageNameOf('@someone/nova-x@next')).toBe('@someone/nova-x');
    expect(packageNameOf('@someone/nova-x')).toBe('@someone/nova-x');
  });

  it('refuses a path (a local plugin is written into the config by hand)', () => {
    expect(packageNameOf('./my-plugin.mjs')).toBeUndefined();
    expect(packageNameOf('/abs/plugin.mjs')).toBeUndefined();
    expect(packageNameOf('   ')).toBeUndefined();
  });
});

describe('nova plugin add', () => {
  it('installs, proves the export, and only then writes the config row', async () => {
    const calls: string[] = [];
    const code = await runPluginCommand(['add', 'nova-fake-plugin@1.2.3'], {
      log: () => undefined,
      install: async (spec, dir) => {
        calls.push(spec);
        expect(dir).toBe(userPluginsDir());
        await writePackage('nova-fake-plugin');
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    // The version stays in the INSTALL spec and leaves the config row.
    expect(calls).toEqual(['nova-fake-plugin@1.2.3']);
    expect(await readExtraPlugins()).toEqual(['nova-fake-plugin']);
  });

  it('leaves the config untouched when the install fails', async () => {
    const code = await runPluginCommand(['add', 'nova-x'], {
      log: () => undefined,
      install: async () => ({ ok: false, message: '网络不通' }),
    });
    expect(code).toBe(1);
    expect(await readExtraPlugins()).toEqual([]);
  });

  it('refuses a package that does not export a plugin, and does not remember it', async () => {
    const code = await runPluginCommand(['add', 'nova-empty'], {
      log: () => undefined,
      install: async () => {
        await writePackage('nova-empty', 'export const nothing = 1;\n');
        return { ok: true };
      },
    });
    expect(code).toBe(1);
    // The row is the thing that breaks the NEXT boot: an installed package that
    // exports nothing must not get one.
    expect(await readExtraPlugins()).toEqual([]);
  });

  it('refuses a function export that throws when APPLIED, not just when shaped', async () => {
    // The `is-odd` shape: a bare function passes the shape check (a function IS
    // a plugin by protocol), and the failure only shows up when it runs.
    const lines: string[] = [];
    const code = await runPluginCommand(['add', 'nova-not-a-plugin'], {
      log: (line) => { lines.push(line); },
      install: async () => {
        await writePackage('nova-not-a-plugin', 'export default function isOdd(value) { throw new TypeError("expected a number"); }\n');
        return { ok: true };
      },
    });
    expect(code).toBe(1);
    // The plugin's OWN error, not a loader crash on the way in.
    expect(lines.join('\n')).toContain('expected a number');
    expect(await readExtraPlugins()).toEqual([]);
  });

  it('accepts a plugin whose activation merely waits for a service', async () => {
    // `inject` without a provider keeps the fiber pending — exactly what boot
    // does too, so a pending fiber at the deadline must not be a refusal.
    const code = await runPluginCommand(['add', 'nova-waits'], {
      log: () => undefined,
      install: async () => {
        await writePackage('nova-waits', 'export default { name: "waits", inject: ["llm"], apply: () => {} };\n');
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    expect(await readExtraPlugins()).toEqual(['nova-waits']);
  });

  it('refuses a path argument with a pointer at the config row', async () => {
    expect(await runPluginCommand(['add', './local.mjs'], { log: () => undefined, install: ok })).toBe(1);
    expect(await readExtraPlugins()).toEqual([]);
  });
});

describe('nova plugin remove', () => {
  it('clears the config row BEFORE uninstalling', async () => {
    await runPluginCommand(['add', 'nova-x'], {
      log: () => undefined,
      install: async () => {
        await writePackage('nova-x');
        return { ok: true };
      },
    });
    let rowsWhenUninstalling: readonly string[] | undefined;
    const code = await runPluginCommand(['remove', 'nova-x'], {
      log: () => undefined,
      uninstall: async (name, dir) => {
        rowsWhenUninstalling = await readExtraPlugins();
        expect(name).toBe('nova-x');
        expect(dir).toBe(userPluginsDir());
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    // Order is the point: a leftover package is inert, a leftover row fails boot.
    expect(rowsWhenUninstalling).toEqual([]);
    expect(await readExtraPlugins()).toEqual([]);
    // An emptied list DELETES the key (the same discipline `plugins.enable`
    // follows) — the operator's file must not gain an `"extra": []` they never wrote.
    const raw: unknown = JSON.parse(await readFile(userConfigPath(), 'utf8'));
    expect(Object.keys((raw as { plugins: Record<string, unknown> }).plugins)).not.toContain('extra');
  });

  it('refuses a spec that is not configured and never touches the disk', async () => {
    let uninstalled = false;
    const code = await runPluginCommand(['remove', 'nova-not-configured'], {
      log: () => undefined,
      uninstall: async () => {
        uninstalled = true;
        return { ok: true };
      },
    });
    expect(code).toBe(1);
    expect(uninstalled).toBe(false);
  });
});

describe('nova plugin list', () => {
  it('names where each row will be found', async () => {
    await runPluginCommand(['add', 'nova-x'], {
      log: () => undefined,
      install: async () => {
        await writePackage('nova-x');
        return { ok: true };
      },
    });
    const lines: string[] = [];
    const code = await runPluginCommand(['list'], { log: (line) => { lines.push(line); } });
    expect(code).toBe(0);
    expect(lines[0]).toContain(userPluginsDir());
    expect(lines.join('\n')).toContain('nova-x');
    expect(lines.join('\n')).toContain('用户插件根');
  });

  it('flags a row nothing can resolve, and reads a local path as one', async () => {
    const lines: string[] = [];
    await runPluginCommand(['add', './local-plugin.mjs'], { log: () => undefined, install: ok });
    // A path row is refused by `add`; seed it the way a hand-edited file would.
    const { addExtraPlugin } = await import('../src/config-write.js');
    await addExtraPlugin('./local-plugin.mjs');
    await addExtraPlugin('nova-nowhere');
    await runPluginCommand(['list'], { log: (line) => { lines.push(line); } });
    const text = lines.join('\n');
    expect(text).toContain('（本地路径）');
    expect(text).toContain('（缺失——启动时这一行会报错）');
  });
});

describe('nova plugin usage', () => {
  it('prints usage and fails on an unknown or incomplete invocation', async () => {
    const lines: string[] = [];
    for (const argv of [[], ['wat'], ['add'], ['remove'], ['list', 'extra']]) {
      expect(await runPluginCommand(argv, { log: (line) => { lines.push(line); } })).toBe(1);
    }
    expect(lines.join('\n')).toContain('usage: nova plugin');
  });
});
