import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { truncateUtf8Head } from '@nova-agent/core';

/**
 * Total byte budget shared by every AGENTS.md collected for one session
 * (mirrors codex `project_doc_max_bytes`).
 */
export const PROJECT_DOC_MAX_BYTES = 32_000;

/**
 * Project-doc discovery chain (codex agents_md.rs, simplified): collect the
 * AGENTS.md of every directory from the workspace root down to the current
 * working directory (inclusive), root first. Nothing outside the workspace
 * is ever read, and the shared byte budget stops collection once spent.
 */
export async function collectProjectDocs(
  rootDir: string,
  cwd: string,
  maxBytes = PROJECT_DOC_MAX_BYTES,
): Promise<string[]> {
  const root = path.resolve(rootDir);
  const dirs: string[] = [root];
  const resolvedCwd = path.resolve(cwd);
  const rootLower = `${root.toLowerCase()}${path.sep}`;
  const cwdLower = resolvedCwd.toLowerCase();
  if (cwdLower !== root.toLowerCase() && cwdLower.startsWith(rootLower)) {
    let current = root;
    for (const part of path.relative(root, resolvedCwd).split(path.sep)) {
      current = path.join(current, part);
      dirs.push(current);
    }
  }

  const docs: string[] = [];
  let remaining = maxBytes;
  for (const dir of dirs) {
    if (remaining <= 0) break;
    const text = await readFile(path.join(dir, 'AGENTS.md'), 'utf8').catch(() => undefined);
    if (text === undefined || text.trim().length === 0) continue;
    // Per-doc cap (codex project_doc_max_bytes semantics): a single huge
    // doc is truncated into the remaining budget instead of being taken
    // whole — one bloated AGENTS.md must not starve the deeper directories'
    // docs that follow it, and the total budget stays a hard bound.
    const trimmed = text.trim();
    const bytes = Buffer.byteLength(trimmed, 'utf8');
    if (bytes > remaining) {
      docs.push(`${truncateUtf8Head(trimmed, remaining)}…[truncated]`);
      remaining = 0;
    } else {
      docs.push(trimmed);
      remaining -= bytes;
    }
  }
  return docs;
}

/**
 * Generate a starter AGENTS.md at the workspace root (the /init command).
 * The file summarizes package.json so agents get basic orientation; users
 * are expected to edit it afterwards.
 */
export async function writeAgentsMd(root: string): Promise<string> {
  const file = path.join(root, 'AGENTS.md');
  const parts: string[] = ['# AGENTS.md', '', 'Instructions for Nova agents working in this workspace.', '', '## Workspace'];
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    if (pkg.name) parts.push(`- package: ${pkg.name}`);
    if (pkg.scripts) {
      parts.push('- scripts:');
      for (const [name, script] of Object.entries(pkg.scripts)) {
        parts.push(`  - \`${name}\`: \`${script}\``);
      }
    }
  } catch {
    parts.push('- no package.json at the workspace root');
  }
  await writeFile(file, `${parts.join('\n')}\n`, 'utf8');
  return file;
}
