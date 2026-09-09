import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ToolExecuteContext } from '@nova-agent/core';
import type { Plugin } from '../types.js';
import { looksBinary, resolveAnywhere, rootPermissionKind } from './fs.js';

/**
 * Workspace search tool — the coding-agent staple codex/pi ship as
 * first-class tools and this project previously routed through bash (which
 * does not exist or means different things under the PowerShell fallback).
 * Two modes: name globbing (find files) and line-wise content regex
 * (find code). Reads only; safe to dispatch concurrently.
 */

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist']);
/** Content search never reads more than this per file (bounds regex cost). */
const SCAN_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS_CAP = 1000;
/** Search scans never enter symlinked directories (loop/escape safety). */

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

/** Minimal glob → RegExp over '/'-joined relative paths: `**`, `*`, `?`. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

interface WalkHalt {
  halted: boolean;
}

/**
 * Recursive directory walk. Skips dot-directories and the heavy standard
 * roots (node_modules / dist / .git), and never follows symlinks — both as
 * a speed measure and so a symlink loop or a link out of the workspace
 * cannot make the search scan foreign paths.
 */
async function walk(dir: string, onFile: (file: string, dirent: { size: number }) => Promise<void>, halt: WalkHalt): Promise<void> {
  if (halt.halted) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (entries === undefined) return;
  for (const entry of entries) {
    if (halt.halted) return;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), onFile, halt);
    } else if (entry.isFile()) {
      const info = await stat(path.join(dir, entry.name)).catch(() => undefined);
      if (info !== undefined && info.isFile()) await onFile(path.join(dir, entry.name), info);
    }
  }
}

export function searchPlugin(): Plugin {
  return {
    name: 'search',
    description: 'Recursive file/content search inside the workspace.',
    activate(ctx) {
      const rootDir = ctx.rootDir;
      ctx.registerTool({
        name: 'search_files',
        description:
          'Searches the workspace tree — use this instead of shell grep/rg/find. Provide name_glob (find files whose workspace-relative path matches a glob like "**/*.test.ts" or "*.ts") OR content_regex (find files whose text matches a regex, returning matching lines as path:line: text). path: starting directory (default workspace root). Skips .git, node_modules, dist and dot-directories; symlinks are never followed. Returns at most max_results hits (default 200).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory to search, workspace-relative or absolute (default workspace root).' },
            name_glob: { type: 'string', description: 'Glob matched against workspace-relative paths ("**", "*" and "?" allowed).' },
            content_regex: { type: 'string', description: 'Regular expression matched line-by-line against file contents.' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive matching (default false).' },
            max_results: { type: 'number', description: `Maximum result lines (default ${DEFAULT_MAX_RESULTS}, cap ${MAX_RESULTS_CAP}).` },
          },
          additionalProperties: false,
        },
        /** Same sandbox classification as the read tools. */
        permissionFor(args) {
          return rootPermissionKind(rootDir, strArg(args, 'path') ?? '.');
        },
        async execute(args, c: ToolExecuteContext) {
          const nameGlob = strArg(args, 'name_glob');
          const contentRegex = strArg(args, 'content_regex');
          if (nameGlob === undefined && contentRegex === undefined) {
            return 'Error: provide name_glob or content_regex';
          }
          let re: RegExp | undefined;
          if (contentRegex !== undefined) {
            try {
              re = new RegExp(contentRegex, args['case_insensitive'] === true ? 'i' : '');
            } catch (err) {
              return `Error: invalid content_regex: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
          const nameRe = nameGlob === undefined ? undefined : globToRegExp(nameGlob);
          const root = resolveAnywhere(c.rootDir, strArg(args, 'path') ?? '.');
          const rootInfo = await stat(root).catch(() => undefined);
          if (rootInfo === undefined || !rootInfo.isDirectory()) {
            return `Error: cannot search directory: ${strArg(args, 'path') ?? '.'}`;
          }
          const maxResults = Math.min(MAX_RESULTS_CAP, Math.max(1, intArg(args, 'max_results') ?? DEFAULT_MAX_RESULTS));

          const results: string[] = [];
          const halt: WalkHalt = { halted: false };
          const relOf = (file: string): string => path.relative(root, file).split(path.sep).join('/');

          await walk(
            root,
            async (file, info) => {
              const rel = relOf(file);
              if (nameRe !== undefined) {
                if (nameRe.test(rel) && results.length < maxResults) {
                  results.push(rel);
                  if (results.length >= maxResults) halt.halted = true;
                }
                return;
              }
              if (info.size > SCAN_MAX_BYTES) return; // too big to scan cheaply
              const text = await readFile(file, 'utf8').catch(() => undefined);
              if (text === undefined) return;
              // Skip binary files (same probe as read_file).
              if (looksBinary(text)) return;
              const lines = text.split('\n');
              for (let i = 0; i < lines.length && !halt.halted; i++) {
                if (re!.test(lines[i]!)) {
                  results.push(`${rel}:${i + 1}: ${lines[i]!.trimEnd()}`);
                  if (results.length >= maxResults) halt.halted = true;
                }
              }
            },
            halt,
          );

          if (results.length === 0) return '(no matches)';
          const truncated = halt.halted ? `\n（已达结果上限 ${maxResults}，缩小范围或改用 bash 检索其余部分）` : '';
          return results.join('\n') + truncated;
        },
        // Read-only: safe to dispatch concurrently with sibling reads.
        isConcurrencySafe() {
          return true;
        },
      }, { permission: 'read' });
    },
  };
}