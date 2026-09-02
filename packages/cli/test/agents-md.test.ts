import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProjectDocs, writeAgentsMd } from '../src/agents-md.js';

describe('writeAgentsMd', () => {
  it('writes AGENTS.md summarizing package.json name and scripts', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-agents-'));
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { test: 'vitest' } }),
      'utf8',
    );
    const file = await writeAgentsMd(dir);
    expect(file).toBe(path.join(dir, 'AGENTS.md'));
    const text = await readFile(file, 'utf8');
    expect(text).toContain('package: demo');
    expect(text).toContain('`test`: `vitest`');
  });

  it('falls back to a placeholder note without package.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-agents-'));
    await mkdir(dir, { recursive: true });
    await writeAgentsMd(dir);
    const text = await readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(text).toContain('no package.json at the workspace root');
  });
});

describe('collectProjectDocs', () => {
  async function makeTree(): Promise<{ root: string; sub: string; other: string }> {
    const root = await mkdtemp(path.join(tmpdir(), 'nova-docs-'));
    const sub = path.join(root, 'packages', 'cli');
    const other = await mkdtemp(path.join(tmpdir(), 'nova-docs-other-'));
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), 'ROOT DOC', 'utf8');
    await writeFile(path.join(sub, 'AGENTS.md'), 'SUB DOC', 'utf8');
    return { root, sub, other };
  }

  it('collects AGENTS.md from the workspace root down to cwd, root first', async () => {
    const { root, sub } = await makeTree();
    expect(await collectProjectDocs(root, sub)).toEqual(['ROOT DOC', 'SUB DOC']);
    expect(await collectProjectDocs(root, root)).toEqual(['ROOT DOC']);
  });

  it('only reads the root when the cwd is outside the workspace', async () => {
    const { root, other } = await makeTree();
    expect(await collectProjectDocs(root, other)).toEqual(['ROOT DOC']);
  });

  it('stops collecting once the shared byte budget is spent', async () => {
    const { root, sub } = await makeTree();
    await writeFile(path.join(root, 'AGENTS.md'), 'A'.repeat(60), 'utf8');
    expect(await collectProjectDocs(root, sub, 50)).toEqual(['A'.repeat(60)]);
  });

  it('returns an empty list without any AGENTS.md', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'nova-docs-empty-'));
    expect(await collectProjectDocs(empty, empty)).toEqual([]);
  });
});
