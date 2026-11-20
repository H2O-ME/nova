/**
 * Surface precedence, through the ONE registry: subcommands → configured
 * surfaces → defaults, each invocation claimed exactly once, `--repl` the
 * force-fallback, and the winner RECORDED (`current()`) so the userQuestions
 * provider has a single source for built-ins and configured surfaces alike.
 *
 * The default interactive surface is `desktop` since the browser entry was cut,
 * and its claim is deliberately WIDE (`!repl && !json`) rather than opt-in: the
 * Tauri shell spawns this process over pipes, where stdio is never a TTY, so a
 * TTY-gated default would leave a bare `nova` unclaimed — exit 1 instead of a
 * window. That is also why the "no TTY falls back to the REPL" rule is gone;
 * `--repl` is the explicit way to ask for the terminal form.
 *
 * Pure — no surface is started; the fake `custom` stands where a
 * `~/.nova/config.json` `surfaces` row would sit. The last case goes through the
 * real `loadDynamicSurfaces` with a real row module on disk, because THAT is the
 * seam where a closed row must stop claiming.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentSurface, AgentSurfaceRequest, SurfaceRows } from '@nova-agent/core';
import { createSurfaceRegistry } from '@nova-agent/plugins';
import { parseArgs } from '../src/cli-args.js';
import type { Config } from '../src/config.js';
import { toFlags } from '../src/surface-host.js';
import { builtinSurfaces, loadDynamicSurfaces } from '../src/surfaces.js';

const config = { provider: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' } } as unknown as Config;

/**
 * A configured surface, as `loadDynamicSurfaces` would register it: it claims a
 * positional word (what a real channel surface does with its own subcommand).
 * A real surface's `start` assembles nothing — the host does (see
 * `surface-host.ts`); here it is a no-op since this test only resolves.
 */
function customSurface(): AgentSurface {
  return {
    name: 'custom',
    interactive: true,
    claim: (request) => request.flags.positional[0] === 'surf-x',
    start: async () => {},
  };
}

function request(argv: string, interactive: boolean): AgentSurfaceRequest {
  const parsed = parseArgs(argv.split(' ').filter((s) => s.length > 0));
  if (parsed === undefined) throw new Error(`unparsable argv: ${argv}`);
  return { rootDir: '/repo', argv: argv.split(' '), interactive, flags: toFlags(parsed) };
}

/** The registry exactly as `cli/index.ts` builds it: head → configured → tail. */
function resolveWith(
  argv: string,
  interactive: boolean,
  extra?: AgentSurface,
): { registry: ReturnType<typeof createSurfaceRegistry>; winner: AgentSurface | undefined } {
  const registry = createSurfaceRegistry();
  const builtins = builtinSurfaces({ config, diagnostics: [] });
  for (const entry of builtins.head) registry.register(entry.surface);
  if (extra !== undefined) registry.register(extra);
  for (const entry of builtins.tail) registry.register(entry.surface);
  return { registry, winner: registry.resolve(request(argv, interactive)) };
}

function claim(argv: string, interactive: boolean, extra?: AgentSurface): string | undefined {
  return resolveWith(argv, interactive, extra).winner?.name;
}

describe('surface claims', () => {
  it('routes subcommands above the interactive defaults', () => {
    expect(claim('exec 修复测试', true)).toBe('exec');
    // A subcommand wins even without a TTY (exec is the CI surface), and even
    // when a configured surface is present — subcommands outrank everything.
    expect(claim('exec 修复测试', false)).toBe('exec');
    expect(claim('exec 修复测试', true, customSurface())).toBe('exec');
  });

  it('opens the desktop window by default, and only --repl leaves it', () => {
    expect(claim('', true)).toBe('desktop');
    expect(claim('--repl', true)).toBe('repl');
  });

  it('claims a piped invocation too, because that is how the shell spawns it', () => {
    // THE regression this guards: the Tauri shell runs `node dist/index.mjs`
    // with `stdin`/`stdout` as pipes, so stdio is never a TTY. A default gated
    // on `interactive` would leave that invocation unclaimed and the process
    // would exit 1 instead of opening a window.
    expect(claim('', false)).toBe('desktop');
    expect(claim('--repl', false)).toBe('repl');
  });

  it('a configured surface claims its own argv ahead of the desktop default', () => {
    // With the surface configured, its own claim decides; without it, the same
    // argv falls through to the built-in desktop entry.
    expect(claim('surf-x', true)).toBe('desktop');
    expect(claim('surf-x', true, customSurface())).toBe('custom');
    // Registration order IS precedence: a configured surface sits between the
    // subcommands and the defaults, so it outranks `repl` too. That is the
    // contract — a surface that wants `--repl` to win must decline in its own
    // claim, which is what every real one does.
    expect(claim('surf-x --repl', true, customSurface())).toBe('custom');
    // A configured surface keeps `--resume` / `--theme`, like every interactive
    // surface: the flags are parsed once, for all of them.
    expect(claim('surf-x --resume /tmp/s.jsonl', true, customSurface())).toBe('custom');
    expect(claim('surf-x --theme dark', true, customSurface())).toBe('custom');
  });

  it('leaves --json unclaimed outside exec', () => {
    // The desktop surface declines `--json` (exec owns it) and `repl` only claims
    // `--repl` or a non-TTY invocation, so nothing claims this one. The shell
    // reports "没有 surface 认领这个调用" rather than starting a window that
    // would print frames nobody asked for.
    expect(claim('--json', true)).toBeUndefined();
    expect(claim('--json', false)).toBe('repl');
  });

  it('consults configured surfaces between subcommands and the defaults', () => {
    // A configured surface outranks the desktop default but a subcommand wins
    // regardless — precedence is subcommand → configured → default, so adding
    // a surface is additive, not a re-routing of the built-ins.
    expect(claim('surf-x', true, customSurface())).toBe('custom');
    expect(claim('exec 修复测试', true, customSurface())).toBe('exec');
  });

  it('claims every invocation exactly once', () => {
    for (const argv of ['', '--repl', 'surf-x', 'surf-x --repl', 'exec t']) {
      for (const interactive of [true, false]) {
        expect(claim(argv, interactive, customSurface())).toBeTypeOf('string');
      }
    }
  });
});

describe('the registry records the winner for every kind of surface', () => {
  it('records a BUILT-IN winner, so userQuestions derives from its declaration', () => {
    const { registry, winner } = resolveWith('', true);
    expect(winner?.name).toBe('desktop');
    // The recording is the ONE source `runtime-env`'s userQuestions provider
    // reads ("does the surface in force have a human?").
    expect(registry.current()).toBe(winner);
  });

  it('records a configured winner the same way', () => {
    const custom = customSurface();
    const { registry, winner } = resolveWith('surf-x', true, custom);
    expect(winner).toBe(custom);
    expect(registry.current()).toBe(custom);
  });

  it('leaves current() undefined before any resolve (fail-closed)', () => {
    const registry = createSurfaceRegistry();
    expect(registry.current()).toBeUndefined();
  });
});

/**
 * The shell's own wiring (`cli/index.ts`): `head` → the configured rows (loaded
 * from a real module spec) → `tail`, into ONE registry.
 */
async function wireConfigured(
  cfg: Config,
  cwd: string,
): Promise<{ registry: ReturnType<typeof createSurfaceRegistry>; rows: SurfaceRows }> {
  const registry = createSurfaceRegistry();
  const builtins = builtinSurfaces({ config: cfg, diagnostics: [] });
  for (const entry of builtins.head) registry.register(entry.surface);
  const rows = await loadDynamicSurfaces(cfg, cwd, registry);
  for (const entry of builtins.tail) registry.register(entry.surface);
  return { registry, rows };
}

describe('a closed surface row stops claiming, but keeps its place on the panel', () => {
  it('leaves a closed row out of the registry while `loaded` still carries it, and lists an open row once', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-cli-surface-'));
    const file = path.join(dir, 'surf-x.mjs');
    await writeFile(
      file,
      `export default {
  name: 'surf-x',
  interactive: true,
  claim: (request) => request.flags.positional[0] === 'surf-x',
  start: async () => {},
};
`,
      'utf8',
    );
    // The settings panel's switch is exactly this row in `plugins.entries`,
    // keyed by the surface's own name — the id the roster builds for it.
    const closed = { ...config, surfaces: [file], plugins: { entries: [{ id: 'surf-x', enabled: false }] } } as unknown as Config;
    const off = await wireConfigured(closed, dir);
    // R3: the row survives for the panel — deleting it from `loaded` would hide
    // the very switch that turns it back on.
    expect(off.rows.loaded.map((surface) => surface.name)).toEqual(['surf-x']);
    // R1: it is not in the registry, so it cannot claim (and `start()` cannot
    // run): the closed surface's argv falls through to the built-in default.
    expect(off.registry.all().map((entry) => entry.name)).not.toContain('surf-x');
    expect(off.registry.resolve(request('surf-x', true))?.name).toBe('desktop');

    const open = { ...config, surfaces: [file], plugins: { entries: [{ id: 'surf-x' }] } } as unknown as Config;
    const on = await wireConfigured(open, dir);
    const surface = on.rows.loaded[0];
    expect(surface).toBeDefined();
    expect(on.registry.resolve(request('surf-x', true))?.name).toBe('surf-x');
    // R4: the row's own fiber registers the SAME instance again when it
    // activates; one surface must stay one list entry, and `resolve` must keep
    // picking a surface (not a hole).
    on.registry.register(surface as AgentSurface);
    expect(on.registry.all().filter((entry) => entry.name === 'surf-x')).toHaveLength(1);
    expect(on.registry.resolve(request('surf-x', true))?.name).toBe('surf-x');
  });
});
