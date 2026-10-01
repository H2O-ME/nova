/**
 * The extension seam: plugins that live in their OWN packages and load by
 * module specifier.
 *
 * The mandate these tests pin: enabling one loads it FROM THE PACKAGE; a
 * MISSING package degrades to a row error and the rest of the product keeps
 * working; and a disabled extension is never imported at all (the spec is
 * pointed at a module that throws on import — if the loader touched it while
 * off, the row would carry an error and this file would go red).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatProvider } from '@nova-agent/core';
import { createAgentKernel } from '../src/index.js';

function provider(): ChatProvider {
  return {
    async *stream() {
      yield { type: 'text_delta', text: 'ok' } as const;
    },
  };
}

async function dir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'nova-ext-'));
}

describe('extension plugins (spec-loaded)', () => {
  it('every extension has a row by default, and none is imported while off', async () => {
    const boom = path.join(await dir(), 'boom.mjs');
    await writeFile(boom, 'throw new Error("must not be imported while disabled");\n', 'utf8');
    const kernel = await createAgentKernel({
      rootDir: await dir(),
      sessionDir: await dir(),
      provider: provider(),
      config: { approval: 'read-only' },
      extensionSpecs: { subagent: boom, context: boom, ptc: boom },
    });
    const rows = kernel.roster();
    for (const name of ['subagent', 'context', 'ptc']) {
      const row = rows.find((entry) => entry.name === name);
      expect(row, `${name} row`).toBeDefined();
      expect(row?.origin).toBe('extension');
      expect(row?.enabled).toBe(false);
      // Not imported ⇒ no error. An import while disabled would surface here.
      expect(row?.error).toBeUndefined();
    }
    await kernel.dispose();
  });

  it('a MISSING module for an enabled extension degrades to a row error — boot and the rest keep working', async () => {
    const kernel = await createAgentKernel({
      rootDir: await dir(),
      sessionDir: await dir(),
      provider: provider(),
      config: { approval: 'read-only', plugins: { enable: ['subagent'] } },
      extensionSpecs: { subagent: path.join(await dir(), 'does-not-exist.mjs') },
    });
    const row = kernel.roster().find((entry) => entry.name === 'subagent');
    expect(row?.enabled).toBe(false);
    expect(row?.error).toMatch(/cannot find|module_not_found|does not exist/i);
    // The base roster still assembled: its tools are present.
    expect(kernel.host.tools.some((tool) => tool.name === 'bash')).toBe(true);
    await kernel.dispose();
  });

  it('enabling an extension loads it FROM THE PACKAGE and registers its tool', async () => {
    const kernel = await createAgentKernel({
      rootDir: await dir(),
      sessionDir: await dir(),
      provider: provider(),
      config: { approval: 'read-only', plugins: { enable: ['subagent'] } },
    });
    const row = kernel.roster().find((entry) => entry.name === 'subagent');
    expect(row?.enabled).toBe(true);
    expect(row?.origin).toBe('extension');
    expect(kernel.host.tools.some((tool) => tool.name === 'subagent')).toBe(true);
    await kernel.dispose();
  });
});
