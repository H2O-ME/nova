/**
 * The surface registry — which human-facing end this invocation gets.
 *
 * Four surfaces ship: the browser UI, the readline REPL, the headless runner
 * and the QQ bot channel. They used to be an if-chain inside `main()`, which
 * made "how do I add another one" answerable only by editing that chain.
 *
 * Here each surface is an entry: it claims an argv, then starts itself with
 * only the options it needs (`kernel-boot.bootKernel` is the shared assembly).
 * Order is precedence: a subcommand outranks a flag, `--repl` outranks the
 * default. Every invocation is claimed exactly once (the two interactive claims
 * are exhaustive: `--repl` or no TTY goes to the REPL, else the browser UI).
 * Entries load lazily: a plain interactive run never pays for the other graphs.
 */
import path from 'node:path';
import process from 'node:process';
import { errMessage } from '@nova-agent/core';
import { themeTarget, type ThemeName } from './command-core.js';
import type { Config } from './config.js';

/** Parsed argv, shared by every surface (and by the entries that claim it). */
export interface ParsedArgs {
  resumeFile?: string;
  approvalOverride?: 'read-only' | 'auto-edit' | 'full';
  themeOverride?: ThemeName;
  json: boolean;
  repl: boolean;
  web: boolean;
  positional: string[];
}

/** What a surface entry is handed: the parsed argv plus the resolved context. */
export interface SurfaceRequest {
  rootDir: string;
  config: Config;
  parsed: ParsedArgs;
  /** Both stdio ends are a TTY — what the browser surface needs to launch. */
  interactive: boolean;
}

export interface SurfaceEntry {
  /** Stable id; `/plugins` and the help text use it. */
  name: string;
  /** Interactive surfaces treat stray positionals as noise, not as a task. */
  interactive?: boolean;
  claim(m: SurfaceRequest): boolean;
  start(m: SurfaceRequest): Promise<void>;
}

export const SURFACES: readonly SurfaceEntry[] = [
  {
    name: 'qqbot',
    claim: (m) => m.parsed.positional[0] === 'qqbot',
    start: async (m) => {
      const { startQqBot } = await import('./qqbot-mode.js');
      await startQqBot({ rootDir: m.rootDir, config: m.config });
    },
  },
  {
    name: 'exec',
    claim: (m) => m.parsed.positional[0] === 'exec',
    start: async (m) => {
      const prompt = await execPrompt(m);
      if (prompt === undefined) return;
      const { runExec } = await import('./exec.js');
      await runExec({
        rootDir: m.rootDir,
        config: m.config,
        prompt,
        json: m.parsed.json,
        ...resumeAndApproval(m.parsed),
      });
    },
  },
  {
    name: 'web',
    interactive: true,
    // The default: `nova` on a terminal opens the browser UI (the product
    // surface) and prints the one-shot launch URL; `--web` is the explicit
    // spelling and claims even without a TTY (the URL goes to stdout fine, and
    // the smoke harness drives it down a pipe) — only `--repl` outranks it.
    claim: (m) => !m.parsed.repl && (m.parsed.web || m.interactive),
    start: async (m) => {
      const { startWeb } = await import('./web-mode.js');
      await startWeb({ rootDir: m.rootDir, config: m.config, ...resumeAndApproval(m.parsed), ...webPort() });
    },
  },
  {
    name: 'repl',
    interactive: true,
    // Forced, or the only option without a TTY: the browser UI wants a browser
    // to render in, which does not exist down a pipe.
    claim: (m) => m.parsed.repl || !m.interactive,
    start: async (m) => {
      const { startRepl } = await import('./repl.js');
      await startRepl({
        rootDir: m.rootDir,
        config: m.config,
        ...resumeAndApproval(m.parsed),
        ...(m.parsed.themeOverride !== undefined ? { theme: m.parsed.themeOverride } : {}),
      });
    },
  },
];

/** The first entry that claims this invocation. */
export function resolveSurface(m: SurfaceRequest): SurfaceEntry | undefined {
  return SURFACES.find((entry) => entry.claim(m));
}

/** `nova exec "<task>"`, or the task piped in on stdin (CI-friendly). */
async function execPrompt(m: SurfaceRequest): Promise<string | undefined> {
  let prompt = m.parsed.positional.slice(1).join(' ').trim();
  if (prompt.length === 0 && process.stdin.isTTY !== true) prompt = (await readStdin()).trim();
  if (prompt.length === 0) {
    console.error('usage: nova exec "<task>"（或通过管道传入任务文本）');
    process.exitCode = 1;
    return undefined;
  }
  return prompt;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
}

/** Flags every interactive surface accepts (resume + approval override). */
export function resumeAndApproval(parsed: ParsedArgs): {
  resumeFile?: string;
  approvalOverride?: 'read-only' | 'auto-edit' | 'full';
} {
  return {
    ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
    ...(parsed.approvalOverride !== undefined ? { approvalOverride: parsed.approvalOverride } : {}),
  };
}

/** `NOVA_WEB_PORT` pins the port for the frontend dev-server proxy flow. */
function webPort(): { port?: number } {
  const fixed = Number.parseInt(process.env['NOVA_WEB_PORT'] ?? '', 10);
  return Number.isInteger(fixed) && fixed > 0 ? { port: fixed } : {};
}

/**
 * Parse argv. Everything after a bare `--` is positional verbatim, so a task
 * starting with `-` (`nova exec -- "-check the config"`) passes through.
 */
export function parseArgs(args: string[]): ParsedArgs | undefined {
  const parsed: ParsedArgs = { json: false, repl: false, web: false, positional: [] };
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!positionalOnly && arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && arg === '--resume') {
      const value = args[++i];
      if (!value) return fail('--resume requires a session file path');
      parsed.resumeFile = value;
    } else if (arg === '--approval') {
      const value = args[++i];
      if (value !== 'read-only' && value !== 'auto-edit' && value !== 'full') {
        return fail('--approval must be one of: read-only, auto-edit, full');
      }
      parsed.approvalOverride = value;
    } else if (arg === '--theme') {
      const target = themeTarget(args[++i] ?? '');
      if (target === undefined) return fail('--theme must be one of: dark, light, plain');
      parsed.themeOverride = target;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--repl') {
      parsed.repl = true;
    } else if (arg === '--web') {
      // The explicit spelling of the default surface (the catch-all `web`
      // entry claims it either way; the flag stays for scripts and for help).
      parsed.web = true;
    } else if (!positionalOnly && arg.startsWith('-')) {
      return fail(`unknown option: ${arg}（--help 查看用法）`);
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

function fail(message: string): undefined {
  console.error(message);
  process.exitCode = 1;
  return undefined;
}

/** The invocation context: resolved cwd + stdio shape. */
export function surfaceRequest(rootDir: string, config: Config, parsed: ParsedArgs): SurfaceRequest {
  return {
    rootDir: path.resolve(rootDir),
    config,
    parsed,
    interactive: process.stdout.isTTY === true && process.stdin.isTTY === true,
  };
}

/** Errors reach the terminal as one line, never as a stack (user-facing CLI). */
export function reportError(err: unknown): void {
  console.error(errMessage(err));
  process.exitCode = 1;
}