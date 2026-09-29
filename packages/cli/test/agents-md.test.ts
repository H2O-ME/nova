import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectProjectDocs, writeAgentsMd } from '@nova-agent/plugins';

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

  /**
   * The cwd exists so a session rooted ABOVE its working directory inherits the
   * deeper docs. It defaulted to the process launch directory once, which made
   * the injected docs depend on where the process happened to start: a session
   * resumed into an ANCESTOR workspace pulled in the launch directory's
   * AGENTS.md — another project's instructions, delivered under the operator's
   * authority frame (`<project_docs>` says "active and mandatory").
   */
  it('defaults to the workspace root alone, never the process launch directory', async () => {
    const { root, sub } = await makeTree();
    // With no cwd the chain is the root's own doc — `sub` (a descendant) is NOT
    // swept in just because the process happens to be running down there.
    expect(await collectProjectDocs(root)).toEqual(['ROOT DOC']);
    expect(await collectProjectDocs(root)).not.toContain('SUB DOC');
    // The descendant case is opt-in, and only through the session's own cwd.
    expect(await collectProjectDocs(root, sub)).toEqual(['ROOT DOC', 'SUB DOC']);
  });

  it('never injects a descendant doc into a session rooted at that descendant\'s ancestor', async () => {
    // The regression: launched in `sub`, a session whose workspace is `root`
    // must get ONLY root's doc. Feeding `process.cwd()` here returned
    // ['ROOT DOC', 'SUB DOC'].
    const { root, sub } = await makeTree();
    const launchDir = sub;
    // What the fixed caller does: the chain's sink is the workspace root.
    expect(await collectProjectDocs(root, root)).toEqual(['ROOT DOC']);
    // And what the bug did, stated explicitly so the difference is the test.
    expect(await collectProjectDocs(root, launchDir)).toEqual(['ROOT DOC', 'SUB DOC']);
  });

  it('truncates a doc that exceeds the remaining budget, then stops (per-doc cap)', async () => {
    const { root, sub } = await makeTree();
    // The budget is in TOKENS and the estimator charges 4 ASCII chars per
    // token, so a 15-token budget buys 60 characters — the whole doc.
    await writeFile(path.join(root, 'AGENTS.md'), 'A'.repeat(60), 'utf8');
    expect(await collectProjectDocs(root, sub, 15)).toEqual(['A'.repeat(60)]);
    // One token buys 4 characters, so the oversize doc is cut into the
    // remaining budget (with a truncation marker) instead of being taken
    // whole — the total stays a hard bound.
    expect(await collectProjectDocs(root, sub, 1)).toEqual([`${'A'.repeat(4)}…[truncated]`]);

    // With room for both docs, each is taken whole.
    await writeFile(path.join(root, 'AGENTS.md'), 'ROOT DOC', 'utf8');
    expect(await collectProjectDocs(root, sub, 4)).toEqual(['ROOT DOC', 'SUB DOC']);
  });

  it('prices a Chinese doc by its tokens, not its UTF-8 bytes', async () => {
    const { root } = await makeTree();
    // 1,000 CJK characters are 3,000 UTF-8 bytes but ~1,000 tokens. Under the
    // old byte budget this doc would have been cut to ~11% of its length; the
    // token budget keeps the whole thing, which is the point of the unit.
    // Addressed at the root so the nested doc does not join the comparison.
    const chinese = '中'.repeat(1_000);
    await writeFile(path.join(root, 'AGENTS.md'), chinese, 'utf8');
    expect(await collectProjectDocs(root, root, 1_200)).toEqual([chinese]);
    // And the same budget still bounds it: 500 tokens is a 500-char head.
    expect(await collectProjectDocs(root, root, 500)).toEqual([`${'中'.repeat(500)}…[truncated]`]);
  });

  it('returns an empty list without any AGENTS.md', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'nova-docs-empty-'));
    expect(await collectProjectDocs(empty, empty)).toEqual([]);
  });
});
