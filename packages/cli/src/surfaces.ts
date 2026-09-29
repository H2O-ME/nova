/**
 * The surface registry — which human-facing end this invocation gets.
 *
 * Four surfaces are wired into the cli itself: the browser UI, the readline
 * REPL, the headless runner and the QQ bot channel (they are inseparable from
 * the product shell — argv grammar, the exec event stream, the bot channel).
 * Every OTHER surface — the terminal UI included — is a plugin loaded from
 * `~/.nova/config.json` `surfaces` (module specs), resolved dynamically by
 * `loadDynamicSurfaces`. Adding a surface is a config row, not a source change;
 * the cli never imports a surface package.
 *
 * Precedence: subcommands outrank flags; a configured surface is consulted
 * before the browser/REPL defaults (so an explicit opt-in like `--tui` can win)
 * but after the subcommands. `--repl` (the force-fallback) wins over a
 * configured surface because the surface's own `claim` includes `!repl`. Every
 * invocation is claimed exactly once. Entries load lazily: a plain run never
 * pays for the other graphs.
 *
 * argv → options lives in `cli-args.ts`; this file only answers "who serves it".
 */
import path from 'node:path';
import process from 'node:process';
import { errMessage, type SurfaceRegistry, type SurfaceRows } from '@nova-agent/core';
import { loadSurfacePlugins } from '@nova-agent/plugins';
import { resumeAndApproval, type ParsedArgs } from './cli-args.js';
import type { Config, ConfigDiagnostic } from './config.js';
import { runSurface, toAgentSurfaceRequest } from './surface-host.js';

export { parseArgs, resumeAndApproval, type ParsedArgs } from './cli-args.js';

/** What a surface entry is handed: the parsed argv plus the resolved context. */
export interface SurfaceRequest {
  rootDir: string;
  config: Config;
  parsed: ParsedArgs;
  /**
   * Non-fatal config problems (`config.ts`): a PLUGIN-owned section whose
   * `{env:NAME}` did not resolve. A surface that can SHOW one must; a surface
   * that cannot stays silent rather than refusing to start — one unconfigured
   * plugin must not take the product down (see `config-expand.ts`).
   */
  diagnostics: readonly ConfigDiagnostic[];
  /** Both stdio ends are a TTY — what the browser surface needs to launch. */
  interactive: boolean;
  /**
   * The configured surfaces this invocation was resolved against (loaded by
   * `loadDynamicSurfaces`). Threaded to every assembly point (`opts.surfaces`)
   * so the kernel adopts them as ordinary plugin rows — a surface listed in
   * `/plugins`. Absent when no configured surface exists.
   */
  surfaces?: SurfaceRows;
}

export interface SurfaceEntry {
  /** Stable id; `/plugins` and the help text use it. */
  name: string;
  /** Interactive surfaces treat stray positionals as noise, not as a task. */
  interactive?: boolean;
  claim(m: SurfaceRequest): boolean;
  start(m: SurfaceRequest): Promise<void>;
}

/** Subcommands outrank every flag (exec is the CI surface, qqbot the channel). */
const SUBCOMMAND_SURFACES: readonly SurfaceEntry[] = [
  {
    name: 'qqbot',
    claim: (m) => m.parsed.positional[0] === 'qqbot',
    start: async (m) => {
      const { startQqBot } = await import('./qqbot-mode.js');
      await startQqBot({
        rootDir: m.rootDir,
        config: m.config,
        ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
      });
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
        ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
      });
    },
  },
];

/**
 * The defaults, consulted LAST: `--web` is the product surface (claims with or
 * without a TTY — the smoke harness drives it down a pipe), `--repl` is the
 * force-fallback and the only option without a TTY.
 */
const DEFAULT_SURFACES: readonly SurfaceEntry[] = [
  {
    name: 'web',
    interactive: true,
    claim: (m) => !m.parsed.repl && (m.parsed.web || m.interactive),
    start: async (m) => {
      const { startWeb } = await import('./web-mode.js');
      await startWeb({
        rootDir: m.rootDir,
        config: m.config,
        diagnostics: m.diagnostics,
        ...resumeAndApproval(m.parsed),
        ...webPort(),
        ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
      });
    },
  },
  {
    name: 'repl',
    interactive: true,
    claim: (m) => m.parsed.repl || !m.interactive,
    start: async (m) => {
      const { startRepl } = await import('./repl.js');
      await startRepl({
        rootDir: m.rootDir,
        config: m.config,
        ...resumeAndApproval(m.parsed),
        ...(m.parsed.themeOverride !== undefined ? { theme: m.parsed.themeOverride } : {}),
        ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
      });
    },
  },
];

/** All built-in entries (kept for `/plugins`-style enumeration if needed). */
export const SURFACES: readonly SurfaceEntry[] = [...SUBCOMMAND_SURFACES, ...DEFAULT_SURFACES];

/**
 * Load configured surface plugins (`~/.nova/config.json` `surfaces`) and adapt
 * each to the cli's `SurfaceEntry` shape. A loaded surface's `claim` reads the
 * host-owned flags through the public `AgentSurfaceRequest`; its `start` hands
 * the host-assembled runtime to the plugin. The registry holds the loaded
 * surfaces for `resolve` and is built here so the cli resolves argv against the
 * same instance that registered them.
 */
/**
 * The adapter entries the resolver consults (`entries`) plus the loaded surface
 * implementations and the shared registry (`rows`), handed to the kernel so it
 * adopts every configured surface as an ordinary plugin row.
 */
export interface LoadedSurfaces {
  entries: SurfaceEntry[];
  rows: SurfaceRows;
}

/** Load configured surfaces; empty `surfaces` yields no entries nor rows. */
export async function loadDynamicSurfaces(
  config: Config,
  cwd: string,
  argv: readonly string[],
  registry: SurfaceRegistry,
): Promise<LoadedSurfaces> {
  // An absent or empty `surfaces` key yields no surfaces — the cli never names
  // a surface package in source, so what loads is exactly what the operator
  // declared in `~/.nova/config.json`. `--tui` with nothing configured is a
  // guided error (see `main()`), not a silent fallthrough.
  const specs = config.surfaces;
  if (specs === undefined || specs.length === 0) return { entries: [], rows: { registry, loaded: [] } };
  const surfaces = await loadSurfacePlugins(specs, cwd);
  for (const surface of surfaces) registry.register(surface);
  const entries: SurfaceEntry[] = surfaces.map((surface) => ({
    name: surface.name,
    ...(surface.interactive === true ? { interactive: true } : {}),
    claim: (m) => surface.claim(toAgentSurfaceRequest(m, argv)),
    start: (m) => runSurface(surface, m, argv),
  }));
  return { entries, rows: { registry, loaded: surfaces } };
}

/**
 * The first entry that claims this invocation. Configured surfaces sit between
 * the subcommands and the defaults, so an explicit opt-in (`--tui`) outranks
 * the browser default but yields to `--repl` (via the surface's own `claim`).
 */
export function resolveSurface(m: SurfaceRequest, extras: readonly SurfaceEntry[] = []): SurfaceEntry | undefined {
  return [...SUBCOMMAND_SURFACES, ...extras, ...DEFAULT_SURFACES].find((entry) => entry.claim(m));
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

/** `NOVA_WEB_PORT` pins the port for the frontend dev-server proxy flow. */
function webPort(): { port?: number } {
  const fixed = Number.parseInt(process.env['NOVA_WEB_PORT'] ?? '', 10);
  return Number.isInteger(fixed) && fixed > 0 ? { port: fixed } : {};
}

/** The invocation context: resolved cwd + stdio shape. */
export function surfaceRequest(
  rootDir: string,
  config: Config,
  parsed: ParsedArgs,
  diagnostics: readonly ConfigDiagnostic[] = [],
  surfaces?: SurfaceRows,
): SurfaceRequest {
  return {
    rootDir: path.resolve(rootDir),
    config,
    parsed,
    diagnostics,
    interactive: process.stdout.isTTY === true && process.stdin.isTTY === true,
    ...(surfaces !== undefined ? { surfaces } : {}),
  };
}

/** Errors reach the terminal as one line, never as a stack (user-facing CLI). */
export function reportError(err: unknown): void {
  console.error(errMessage(err));
  process.exitCode = 1;
}