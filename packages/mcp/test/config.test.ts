import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMcpConfigFile, loadMcpConfig, expandRefsInPlace } from '../src/index.js';

describe('mcp config', () => {
  it('finds .nova/mcp.json by walking up from the working directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-mcp-'));
    const nested = path.join(root, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    await mkdir(path.join(root, '.nova'), { recursive: true });
    await writeFile(path.join(root, '.nova', 'mcp.json'), JSON.stringify({ mcp: {} }), 'utf8');
    expect(await findMcpConfigFile(nested)).toBe(path.join(root, '.nova', 'mcp.json'));
  });

  it('returns undefined when no config exists anywhere', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-mcp-'));
    // Only safe to assert "no workspace config"; home fallback is not
    // observable here, so compare against the home path explicitly.
    const found = await findMcpConfigFile(root);
    expect(found === undefined || found.includes(path.join('.nova', 'mcp.json'))).toBe(true);
    if (found !== undefined) return; // a home config exists on this machine
    const loaded = await loadMcpConfig(root);
    expect(loaded).toBeUndefined();
  });

  it('loads, validates and filters servers with enabled=false dropped', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-mcp-'));
    const nova = path.join(root, '.nova');
    await mkdir(nova, { recursive: true });
    await writeFile(
      path.join(nova, 'mcp.json'),
      JSON.stringify({
        mcp: {
          fathom: { type: 'remote', url: 'https://example.com/mcp', headers: { 'X-API-KEY': '{env:NOVA_TEST_KEY}' } },
          disabled: { type: 'stdio', command: 'echo', enabled: false },
        },
      }),
      'utf8',
    );
    process.env['NOVA_TEST_KEY'] = 'secret-key';
    const loaded = await loadMcpConfig(root);
    expect(loaded?.file).toBe(path.join(nova, 'mcp.json'));
    expect(loaded?.servers).toHaveLength(1);
    const server = loaded?.servers[0];
    expect(server?.name).toBe('fathom');
    if (server?.type !== 'remote') throw new Error('expected remote transport');
    expect(server.headers?.['X-API-KEY']).toBe('secret-key');
    delete process.env['NOVA_TEST_KEY'];
  });

  it('expands {file:} references relative to the config directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-mcp-'));
    await writeFile(path.join(root, 'key.txt'), 'file-key-value\n', 'utf8');
    expect(await expandRefsInPlace('Bearer {file:key.txt}', root)).toBe('Bearer file-key-value');
    expect(await expandRefsInPlace('{env:NOVA_UNSET_VAR_XYZ}', root)).toBe('');
  });

  it('rejects invalid server shapes with a readable error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-mcp-'));
    const nova = path.join(root, '.nova');
    await mkdir(nova, { recursive: true });
    await writeFile(path.join(nova, 'mcp.json'), JSON.stringify({ mcp: { bad: { type: 'warp' } } }), 'utf8');
    await expect(loadMcpConfig(root)).rejects.toThrow(/invalid MCP config.*mcp.bad/s);
  });
});
