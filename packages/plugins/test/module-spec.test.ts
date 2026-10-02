/**
 * The resolution rule for `plugins.extra` / `surfaces` rows — one config string,
 * one meaning. The user plugin root (`~/.nova/plugins/`) is the part that needs
 * pinning: it must be reachable (a user can install into it) and it must never
 * shadow something the product already ships (an upgrade silently undone by a
 * stale copy is the failure that rule exists to prevent).
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { userPluginsDir } from '@nova-agent/core';
import { resolvableFromProduct, resolveModuleSpec } from '../src/module-spec.js';

let home: string;

/** A package installed in the user plugin root, with the given export map. */
async function installFake(name: string, exportsMap: unknown): Promise<string> {
  const dir = path.join(userPluginsDir(home), 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: exportsMap }));
  await writeFile(path.join(dir, 'index.mjs'), 'export default { name: "fake", apply: () => {} };\n');
  return dir;
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'nova-module-spec-'));
});

describe('resolveModuleSpec', () => {
  it('resolves a path against the working directory', () => {
    expect(resolveModuleSpec('./my-plugin.mjs', '/w')).toBe(pathToFileURL(path.join('/w', 'my-plugin.mjs')).href);
    expect(resolveModuleSpec('/abs/plugin.mjs', '/w').startsWith('file://')).toBe(true);
  });

  it('hands a product-resolvable name to Node untouched', () => {
    // `@nova-agent/core` is a dependency of this package: the product resolves it,
    // so the user root is not consulted at all.
    expect(resolveModuleSpec('@nova-agent/core', '/w', home)).toBe('@nova-agent/core');
  });

  it('does NOT let the user root shadow a name the product can resolve', async () => {
    // The stale-copy trap: an old copy in the user root must not replace the
    // bundled package after an upgrade.
    await installFake('@nova-agent/core', './index.mjs');
    expect(resolveModuleSpec('@nova-agent/core', '/w', home)).toBe('@nova-agent/core');
  });

  it('resolves a name that only exists in the user plugin root', async () => {
    const dir = await installFake('nova-fake-plugin', './index.mjs');
    expect(resolveModuleSpec('nova-fake-plugin', '/w', home)).toBe(pathToFileURL(path.join(dir, 'index.mjs')).href);
  });

  it('resolves a scoped name the same way', async () => {
    const dir = await installFake('@someone/nova-x', './index.mjs');
    expect(resolveModuleSpec('@someone/nova-x', '/w', home)).toBe(pathToFileURL(path.join(dir, 'index.mjs')).href);
  });

  it('falls back to the bare spec when the user-root package has no require/default arm', async () => {
    // An import-only export map: nothing here can name its entry, so the boot
    // error will name the config row instead of the product inventing a path.
    await installFake('nova-import-only', { '.': { import: './index.mjs' } });
    expect(resolveModuleSpec('nova-import-only', '/w', home)).toBe('nova-import-only');
  });

  it('leaves a name that exists nowhere alone', () => {
    expect(resolveModuleSpec('nova-not-installed-anywhere', '/w', home)).toBe('nova-not-installed-anywhere');
  });
});

describe('resolvableFromProduct', () => {
  it('tells what ships with the product from what does not', () => {
    expect(resolvableFromProduct('@nova-agent/core')).toBe(true);
    expect(resolvableFromProduct('nova-not-installed-anywhere')).toBe(false);
  });
});
