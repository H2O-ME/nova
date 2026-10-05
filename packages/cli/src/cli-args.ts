/**
 * argv → `ParsedArgs`: the one place a command line becomes options.
 *
 * Split out of `surfaces.ts` because the two answer different questions: this
 * file decides **what was asked for** (and rejects what cannot be), while
 * `surfaces.ts` decides **who serves it**. Keeping them together meant a new
 * flag grew the registry file, and the registry's real subject — precedence
 * between surfaces — got harder to see.
 */
import process from 'node:process';
import { themeTarget, type ThemeName } from './command-core.js';

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

/**
 * Parse argv. Everything after a bare `--` is positional verbatim, so a task
 * starting with `-` (`nova exec -- "-check the config"`) passes through.
 */
export function parseArgs(args: string[]): ParsedArgs | undefined {
  const parsed: ParsedArgs = { json: false, repl: false, web: false, positional: [] };
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (positionalOnly) {
      // After `--` EVERYTHING is task text — including tokens that spell known
      // flags. The old parser kept reading them as options, so a task like
      // `nova exec -- --web --json fix the flag handling` silently switched
      // surfaces and output modes instead of being executed verbatim.
      parsed.positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (arg === '--resume') {
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
    } else if (arg.startsWith('-')) {
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
