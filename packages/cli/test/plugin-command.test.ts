/**
 * `nova plugin add|remove|list` — the user plugin root's command surface.
 *
 * The package manager is injected: the repo's tests do not go to the network, so
 * the fake installers below write the very package layout `npm install` would —
 * into `~/.nova/plugins/node_modules/<name>` (the isolated test home) — and the
 * command's own decisions (which `plugins.entries` row it writes, in what ORDER,
 * and what it refuses) are what these cases pin.
 *
 * `add`/`remove` write the SAME field the settings panel writes. The deleted
 * `plugins.extra` list was a second door: an installed plugin could be listed
 * there and switched off elsewhere, so `list` and the panel could disagree about
 * what was on.
 *
 * The probe's hardest case is here on purpose: `applyFailure` cannot learn the
 * verdict from `PluginHost.sync` alone, because the loader records a failed
 * activation on the ROW (`error`) rather than rejecting — a broken plugin must
 * never take the host down. So "refuses a function export that throws when
 * APPLIED" is pinned twice over: it fails if the probe stops reading the row.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userConfigPath, userPluginsDir } from '@nova-agent/core';
import { readPluginEntries } from '../src/config-read.js';
import { setPluginEntry } from '../src/config-write.js';
import { packageNameOf, runPluginCommand, type PluginRunOutcome } from '../src/plugin-command.js';

// Each case gets its own home: these tests mutate the config file and the plugin
// root, and the suite-wide isolated home is per FILE — one case's install would
// otherwise be the next case's starting state. The command resolves both paths
// itself (it runs before any config is loaded), so the env swap is what it sees;
// every assertion that reads the file passes the same home explicitly.
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

/** The `plugins.entries` rows on disk ([] when there are none). */
async function rows(): Promise<readonly unknown[]> {
  return readPluginEntries(home);
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
    expect(await rows()).toEqual([{ id: 'nova-fake-plugin', enabled: true }]);
  });

  it('leaves the config untouched when the install fails', async () => {
    const code = await runPluginCommand(['add', 'nova-x'], {
      log: () => undefined,
      install: async () => ({ ok: false, message: '网络不通' }),
    });
    expect(code).toBe(1);
    expect(await rows()).toEqual([]);
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
    expect(await rows()).toEqual([]);
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
    expect(await rows()).toEqual([{ id: 'nova-waits', enabled: true }]);
  });

  it('refuses a function export that throws when APPLIED', async () => {
    // Every exported function passes the SHAPE check, so without this case the
    // probe could bless `is-odd` and friends — and the failure would land at the
    // next boot, far from the command that installed it. The loader records a
    // failed activation on the ROW instead of rejecting, so this is also the case
    // that pins "the probe reads the row's own error, not just `sync` resolving".
    const lines: string[] = [];
    const code = await runPluginCommand(['add', 'nova-not-a-plugin'], {
      log: (line) => lines.push(line),
      install: async () => {
        await writePackage('nova-not-a-plugin', 'export default function isOdd(v) { throw new TypeError("expected a number"); }\n');
        return { ok: true };
      },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('expected a number');
    // The row is what breaks the next boot; a package that cannot activate gets none.
    expect(await rows()).toEqual([]);
  });

  it('refuses a path argument with a pointer at the config row', async () => {
    expect(await runPluginCommand(['add', './local.mjs'], { log: () => undefined, install: ok })).toBe(1);
    expect(await rows()).toEqual([]);
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
    let rowsWhenUninstalling: readonly unknown[] | undefined;
    const code = await runPluginCommand(['remove', 'nova-x'], {
      log: () => undefined,
      uninstall: async (name, dir) => {
        rowsWhenUninstalling = await rows();
        expect(name).toBe('nova-x');
        expect(dir).toBe(userPluginsDir());
        return { ok: true };
      },
    });
    expect(code).toBe(0);
    // Order is the point: a leftover package is inert, a leftover row fails boot.
    expect(rowsWhenUninstalling).toEqual([]);
    expect(await rows()).toEqual([]);
    // An emptied list DELETES the key — the operator's file must not gain an
    // `"entries": []` they never wrote.
    const raw: unknown = JSON.parse(await readFile(userConfigPath(), 'utf8'));
    expect(Object.keys((raw as { plugins: Record<string, unknown> }).plugins)).not.toContain('entries');
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
    // A path row is refused by `add`; seed it the way a hand-edited file would.
    await setPluginEntry('./local-plugin.mjs', { enabled: true }, home);
    await setPluginEntry('nova-nowhere', { enabled: true }, home);
    const lines: string[] = [];
    await runPluginCommand(['list'], { log: (line) => { lines.push(line); } });
    const text = lines.join('\n');
    expect(text).toContain('（本地路径）');
    expect(text).toContain('（缺失——启动时这一行会报错）');
  });

  it('renders a control byte in external data as a visible escape, never raw', async () => {
    // Every byte here was found on stdout by byte-level inspection of the real
    // command: `\r` rewrites what is already printed, ESC retargets terminal
    // state, and the C1 pair arrives as `c2 9b`. Row ids come from a hand-edited
    // config and the rest from argv / the package manager, so all three are
    // external data crossing into a terminal line.
    const nasty = 'zz-cr\rOVERWRITTEN\x1b[31m\x07\x7f\x9b';
    await setPluginEntry(nasty, { enabled: true }, home);
    const lines: string[] = [];
    const collect = { log: (line: string) => { lines.push(line); } };
    await runPluginCommand(['list'], collect);
    await runPluginCommand(['add', nasty], {
      ...collect,
      install: async () => ({ ok: false, message: 'boom\r\x1b[2J' }),
    });
    await runPluginCommand(['remove', nasty], {
      ...collect,
      uninstall: async () => ({ ok: false, message: 'boom\r\x07' }),
    });
    // No raw control code point reaches a line — not from the config row, not
    // from argv, not from the failure message. Read by code point rather than
    // with a control-character regex class (oxlint's `no-control-regex`).
    const rawControl = (text: string): string | undefined => {
      for (const char of text) {
        const code = char.codePointAt(0) ?? 0x20;
        if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return char;
      }
      return undefined;
    };
    for (const line of lines) {
      const raw = rawControl(line);
      expect(raw === undefined ? undefined : `raw U+${(raw.codePointAt(0) ?? 0).toString(16)} in ${JSON.stringify(line)}`).toBeUndefined();
    }
    // Escaped rather than dropped: the reader still sees WHY the row looked odd.
    const text = lines.join('\n');
    for (const escape of ['\\r', '\\x1b', '\\x07', '\\x7f', '\\x9b']) expect(text).toContain(escape);
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
