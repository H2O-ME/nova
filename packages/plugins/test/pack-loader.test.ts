import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledPackEnabled, discoverPacks, expandPackCommand, loadPack, packEnabled, readPackManifest } from '@nova-agent/plugins';

/**
 * The plugin-PACK shape: a directory with a manifest contributing skills,
 * commands and hooks. These cases protect the two properties a ZCode pack
 * depends on — the manifest is found where ZCode puts it, and no declared path
 * may escape the pack root — plus the command placeholder expansion.
 */
describe('plugin pack manifest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'nova-pack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds the manifest in the ZCode and Claude locations', async () => {
    for (const manifestDir of ['.zcode-plugin', '.claude-plugin', '.nova-plugin']) {
      const pack = path.join(dir, manifestDir.replace('.', ''));
      await mkdir(path.join(pack, manifestDir), { recursive: true });
      await writeFile(
        path.join(pack, manifestDir, 'plugin.json'),
        JSON.stringify({ name: `p-${manifestDir}`, version: '1.0.0', skills: './skills' }),
      );
      const manifest = await readPackManifest(pack);
      expect(manifest?.ok).toBe(true);
      if (manifest?.ok === true) {
        expect(manifest.value.name).toBe(`p-${manifestDir}`);
        expect(manifest.value.version).toBe('1.0.0');
      }
    }
  });

  it('treats a directory with no manifest as not-a-pack', async () => {
    await mkdir(path.join(dir, 'stray', 'skills'), { recursive: true });
    expect(await readPackManifest(dir)).toBeUndefined();
    expect(await discoverPacks({ installedRoot: dir })).toEqual([]);
  });

  it('loads skills, commands and hooks from one pack', async () => {
    const pack = path.join(dir, 'demo');
    await mkdir(path.join(pack, '.zcode-plugin'), { recursive: true });
    await mkdir(path.join(pack, 'skills', 'guard'), { recursive: true });
    await mkdir(path.join(pack, 'commands'), { recursive: true });
    await mkdir(path.join(pack, 'hooks'), { recursive: true });
    await writeFile(
      path.join(pack, '.zcode-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', hooks: 'hooks/hooks.json' }),
    );
    await writeFile(
      path.join(pack, 'skills', 'guard', 'SKILL.md'),
      ['---', 'name: guard', 'description: 写入前把关', '---', '', 'Body text'].join('\n'),
    );
    await writeFile(path.join(pack, 'commands', 'scan.md'), '---\ndescription: 扫描\n---\nRun $ARGUMENTS now.');
    await writeFile(
      path.join(pack, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'process', command: 'node', args: ['x.mjs'] }] }],
        },
      }),
    );

    const loaded = await loadPack(pack);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.skills.map((s) => s.name)).toEqual(['guard']);
    expect(loaded.value.commands.map((c) => c.name)).toEqual(['scan']);
    expect(loaded.value.hooks.PreToolUse?.[0]?.matcher).toBe('Edit|Write');
  });

  it('refuses a declared path that escapes the pack root', async () => {
    const pack = path.join(dir, 'evil');
    await mkdir(path.join(pack, '.zcode-plugin'), { recursive: true });
    await writeFile(
      path.join(pack, '.zcode-plugin', 'plugin.json'),
      JSON.stringify({ name: 'evil', skills: '../../outside' }),
    );
    const loaded = await loadPack(pack);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.skills).toEqual([]);
    expect(loaded.value.diagnostics.join(' ')).toContain('越出插件包根');
  });
});

describe('pack enablement', () => {
  it('is on unless a matching row says enabled:false', () => {
    expect(packEnabled('mimosa', [])).toBe(true);
    expect(packEnabled('mimosa', [{ id: 'pack:mimosa', enabled: false }])).toBe(false);
    expect(packEnabled('mimosa', [{ id: 'mimosa', enabled: false }])).toBe(false);
    expect(packEnabled('mimosa', [{ id: 'other', enabled: false }])).toBe(true);
  });

  it('is off unless a bundled pack row says enabled:true', () => {
    expect(bundledPackEnabled('mimosa', [])).toBe(false);
    expect(bundledPackEnabled('mimosa', [{ id: 'pack:mimosa', enabled: true }])).toBe(true);
    expect(bundledPackEnabled('mimosa', [{ id: 'mimosa', enabled: true }])).toBe(true);
    expect(bundledPackEnabled('mimosa', [{ id: 'pack:mimosa', enabled: false }])).toBe(false);
  });

  it('skips a switched-off pack entirely (its hooks must not run)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nova-pack-off-'));
    try {
      const pack = path.join(dir, 'demo');
      await mkdir(path.join(pack, '.zcode-plugin'), { recursive: true });
      await writeFile(
        path.join(pack, '.zcode-plugin', 'plugin.json'),
        JSON.stringify({ name: 'demo' }),
      );
      const packs = await discoverPacks({ installedRoot: dir, entries: [{ id: 'pack:demo', enabled: false }] });
      expect(packs).toEqual([]);
      const on = await discoverPacks({ installedRoot: dir });
      expect(on.map((p) => p.manifest.name)).toEqual(['demo']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a bundled pack only when explicitly installed, and lets an installed copy win', async () => {
    const installedRoot = await mkdtemp(path.join(os.tmpdir(), 'nova-pack-ins-'));
    const bundledDir = await mkdtemp(path.join(os.tmpdir(), 'nova-pack-bun-'));
    try {
      for (const [root, dirName] of [
        [installedRoot, 'demo'],
        [bundledDir, 'demo'],
      ] as const) {
        await mkdir(path.join(root, dirName, '.zcode-plugin'), { recursive: true });
        await writeFile(
          path.join(root, dirName, '.zcode-plugin', 'plugin.json'),
          JSON.stringify({ name: 'demo' }),
        );
      }
      // Bundled == OFF by default: shipping a pack is not a request to run it.
      expect(await discoverPacks({ installedRoot: path.join(installedRoot, 'nope'), bundledDirs: [bundledDir] })).toEqual([]);
      // An explicit row installs it.
      const installed = await discoverPacks({
        installedRoot: path.join(installedRoot, 'nope'),
        bundledDirs: [bundledDir],
        entries: [{ id: 'pack:demo', enabled: true }],
      });
      expect(installed.map((p) => p.manifest.name)).toEqual(['demo']);
      expect(installed[0]?.root.startsWith(bundledDir)).toBe(true);
      // The operator's own copy shadows the bundled one (they get ONE pack, not two).
      const shadowed = await discoverPacks({
        installedRoot,
        bundledDirs: [bundledDir],
        entries: [{ id: 'pack:demo', enabled: true }],
      });
      expect(shadowed.map((p) => p.manifest.name)).toEqual(['demo']);
      expect(shadowed[0]?.root.startsWith(installedRoot)).toBe(true);
    } finally {
      await rm(installedRoot, { recursive: true, force: true });
      await rm(bundledDir, { recursive: true, force: true });
    }
  });
});

describe('pack command expansion', () => {
  it('substitutes $ARGUMENTS and positional parameters', () => {
    expect(expandPackCommand('run $ARGUMENTS', 'a b', {})).toBe('run a b');
    expect(expandPackCommand('first=$1 second=$2', 'a b', {})).toBe('first=a second=b');
  });

  it('appends the arguments when the template used no placeholder', () => {
    expect(expandPackCommand('scan the repo', 'src', {})).toBe('scan the repo\n\nUser arguments: src');
    expect(expandPackCommand('scan the repo', '  ', {})).toBe('scan the repo');
  });

  it('expands declared variables and leaves unknown ones alone', () => {
    expect(expandPackCommand('${ZCODE_PLUGIN_ROOT}/x', '', { ZCODE_PLUGIN_ROOT: '/p' })).toBe('/p/x');
    expect(expandPackCommand('${NOPE}', '', {})).toBe('${NOPE}');
  });
});
