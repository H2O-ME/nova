import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolExecuteContext } from '@nova-agent/core';
import type { Plugin } from '../types.js';

/**
 * Resolve a user/model-supplied path against the workspace root and reject
 * anything that escapes it. This is the M1 sandbox: no writes outside root.
 */
export function resolveInRoot(rootDir: string, raw: unknown): string {
  const file = resolveAnywhere(rootDir, raw);
  const root = path.resolve(rootDir);
  if (file !== root && !file.startsWith(root + path.sep)) {
    throw new Error(`path escapes workspace root: ${raw as string}`);
  }
  return file;
}

/** Resolve without the workspace restriction (reads may cross it, gated). */
export function resolveAnywhere(rootDir: string, raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('path is required');
  return path.resolve(path.resolve(rootDir), raw);
}

/** True when a resolved path stays inside the workspace root. */
export function isInsideRoot(rootDir: string, resolved: string): boolean {
  const root = path.resolve(rootDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function intArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function fsReadPlugin(): Plugin {
  return {
    name: 'fs-read',
    description: 'Read files and list directories inside the workspace.',
    activate(ctx) {
      const rootDir = ctx.rootDir;
      ctx.registerTool({
        name: 'read_file',
        description:
          'Reads a text file. Paths inside the workspace are read freely; paths outside it require user approval. Args: path (required, absolute or workspace-relative), offset (1-based start line, optional), limit (max lines, default 400).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path, workspace-relative or absolute.' },
            offset: { type: 'number', description: '1-based line number to start from.' },
            limit: { type: 'number', description: 'Maximum number of lines to return (default 400).' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        /** In-root reads are free; out-of-root reads cross the sandbox boundary. */
        permissionFor(args) {
          const file = resolveAnywhere(rootDir, args['path']);
          return isInsideRoot(rootDir, file) ? 'read' : 'read-external';
        },
        async execute(args, c: ToolExecuteContext) {
          const file = resolveAnywhere(c.rootDir, args['path']);
          const info = await stat(file).catch(() => undefined);
          if (!info) return `Error: file not found: ${args['path'] as string}`;
          if (info.isDirectory()) return `Error: path is a directory, use list_dir: ${args['path'] as string}`;
          const text = await readFile(file, 'utf8');
          const lines = text.split('\n');
          const total = lines.length;
          const offset = Math.max(1, intArg(args, 'offset') ?? 1);
          const limit = Math.max(1, intArg(args, 'limit') ?? 400);
          const slice = lines.slice(offset - 1, offset - 1 + limit);
          const header =
            total > slice.length || offset > 1
              ? `[lines ${offset}-${offset - 1 + slice.length} of ${total}]\n`
              : '';
          return `${header}${slice.join('\n')}`;
        },
        // Read-only: safe to dispatch concurrently with sibling reads.
        isConcurrencySafe() {
          return true;
        },
      });

      ctx.registerTool({
        name: 'list_dir',
        description:
          'Lists the entries of a directory (directories first). Paths inside the workspace are read freely; paths outside it require user approval. Args: path (optional, defaults to the workspace root).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path, workspace-relative or absolute.' },
          },
          additionalProperties: false,
        },
        permissionFor(args) {
          const dir = resolveAnywhere(rootDir, strArg(args, 'path') ?? '.');
          return isInsideRoot(rootDir, dir) ? 'read' : 'read-external';
        },
        async execute(args, c: ToolExecuteContext) {
          const dir = resolveAnywhere(c.rootDir, strArg(args, 'path') ?? '.');
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
          if (!entries) return `Error: cannot read directory: ${strArg(args, 'path') ?? '.'}`;
          const sorted = [...entries].sort((a, b) => {
            const dirDelta = Number(b.isDirectory()) - Number(a.isDirectory());
            return dirDelta !== 0 ? dirDelta : a.name.localeCompare(b.name);
          });
          if (sorted.length === 0) return '(empty directory)';
          const lines = sorted.slice(0, 500).map((entry) => `${entry.isDirectory() ? 'd' : 'f'} ${entry.name}`);
          const suffix = sorted.length > 500 ? `\n(... ${sorted.length - 500} more)` : '';
          return lines.join('\n') + suffix;
        },
        // Read-only: safe to dispatch concurrently with sibling reads.
        isConcurrencySafe() {
          return true;
        },
      });
    },
  };
}

export function fsWritePlugin(): Plugin {
  return {
    name: 'fs-write',
    description: 'Create, overwrite and edit files inside the workspace.',
    activate(ctx) {
      ctx.registerTool({
        name: 'write_file',
        description:
          'Creates or overwrites a text file inside the workspace (parent directories are created). Args: path (required), content (required).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path, workspace-relative or absolute inside the workspace root.' },
            content: { type: 'string', description: 'Full file content to write.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
        async execute(args, c: ToolExecuteContext) {
          const file = resolveInRoot(c.rootDir, args['path']);
          const content = typeof args['content'] === 'string' ? args['content'] : '';
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, content, 'utf8');
          return `wrote ${content.length} chars to ${path.relative(c.rootDir, file) || file}`;
        },
      }, { permission: 'write' });

      ctx.registerTool({
        name: 'edit_file',
        description:
          'Replaces an exact substring in a workspace text file. Args: path (required), old_string (required), new_string (required), replace_all (optional boolean). Fails if old_string is not found or appears multiple times without replace_all.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path, workspace-relative or absolute inside the workspace root.' },
            old_string: { type: 'string', description: 'Exact text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of failing on multiples.' },
          },
          required: ['path', 'old_string', 'new_string'],
          additionalProperties: false,
        },
        async execute(args, c: ToolExecuteContext) {
          const file = resolveInRoot(c.rootDir, args['path']);
          const oldString = strArg(args, 'old_string');
          const newString = strArg(args, 'new_string') ?? '';
          if (oldString === undefined || oldString.length === 0) return 'Error: old_string must be a non-empty string';
          let text: string;
          try {
            text = await readFile(file, 'utf8');
          } catch {
            return `Error: cannot read file: ${args['path'] as string}`;
          }
          const occurrences = text.split(oldString).length - 1;
          if (occurrences === 0) return 'Error: old_string not found in file';
          const replaceAll = args['replace_all'] === true;
          if (occurrences > 1 && !replaceAll) {
            return `Error: old_string appears ${occurrences} times; pass replace_all=true or provide a longer unique snippet`;
          }
          const next = replaceAll ? text.replaceAll(oldString, newString) : text.replace(oldString, newString);
          await writeFile(file, next, 'utf8');
          const count = replaceAll ? occurrences : 1;
          return `edited ${count} occurrence(s) in ${path.relative(c.rootDir, file) || file}`;
        },
      }, { permission: 'write' });
    },
  };
}
