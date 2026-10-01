/**
 * Surface precedence, through the ONE registry: subcommands → configured
 * surfaces → defaults, each invocation claimed exactly once, `--repl` the
 * force-fallback, and the winner RECORDED (`current()`) so the userQuestions
 * provider has a single source for built-ins and configured surfaces alike.
 *
 * Pure — no surface is started; the fake `custom` stands where a
 * `~/.nova/config.json` `surfaces` row would sit.
 */
import { describe, expect, it } from 'vitest';
import type { AgentSurface, AgentSurfaceRequest } from '@nova-agent/core';
import { createSurfaceRegistry } from '@nova-agent/plugins';
import { parseArgs } from '../src/cli-args.js';
import type { Config } from '../src/config.js';
import { toFlags } from '../src/surface-host.js';
import { builtinSurfaces } from '../src/surfaces.js';

const config = { provider: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' } } as unknown as Config;

/**
 * A configured surface, as `loadDynamicSurfaces` would register it: claim reads
 * the host-owned flags off the request (`flags.web` etc.). A real surface's
 * `start` assembles nothing — the host does (see `surface-host.ts`); here it is
 * a no-op since this test only resolves.
 */
function customSurface(): AgentSurface {
  return {
    name: 'custom',
    interactive: true,
    claim: (request) => request.flags.web && !request.flags.repl && request.interactive,
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
    expect(claim('qqbot', true)).toBe('qqbot');
    expect(claim('exec 修复测试', true)).toBe('exec');
    // A subcommand wins even without a TTY (exec is the CI surface), and even
    // when a configured surface is present — subcommands outrank everything.
    expect(claim('exec 修复测试', false)).toBe('exec');
    expect(claim('exec 修复测试', true, customSurface())).toBe('exec');
  });

  it('opens the browser UI by default, and only --repl leaves it', () => {
    expect(claim('', true)).toBe('web');
    expect(claim('--web', true)).toBe('web');
    expect(claim('--repl', true)).toBe('repl');
    expect(claim('--repl --web', true)).toBe('repl');
  });

  it('a configured surface claims its argv ahead of the browser default', () => {
    // With the surface configured, its own claim decides (`--web` here);
    // without it, the same argv falls through to the built-in web entry.
    expect(claim('--web', true)).toBe('web');
    expect(claim('--web', true, customSurface())).toBe('custom');
    // The force-fallback is stronger than any opt-in: the configured surface's
    // own claim yields to `--repl`.
    expect(claim('--web --repl', true, customSurface())).toBe('repl');
    expect(claim('--repl --web', true, customSurface())).toBe('repl');
    // A configured surface keeps `--resume` / `--theme`, like every interactive
    // surface: the flags are parsed once, for all of them.
    expect(claim('--web --resume /tmp/s.jsonl', true, customSurface())).toBe('custom');
    expect(claim('--web --theme dark', true, customSurface())).toBe('custom');
  });

  it('never claims a TTY-gated configured surface without a TTY', () => {
    // The configured surface's own claim carries the `interactive` guard, so a
    // piped invocation degrades to the built-ins instead of the plugin.
    expect(claim('--web', false, customSurface())).toBe('web');
  });

  it('falls back to the REPL without a TTY, but honors an explicit --web', () => {
    expect(claim('', false)).toBe('repl');
    // The smoke harness drives the browser surface down a pipe: `--web` must
    // not be demoted to the REPL just because stdio is not a terminal.
    expect(claim('--web', false)).toBe('web');
  });

  it('consults configured surfaces between subcommands and the defaults', () => {
    // A configured surface outranks the browser default but a subcommand wins
    // regardless — precedence is subcommand → configured → default, so adding
    // a surface is additive, not a re-routing of the built-ins.
    expect(claim('', true, customSurface())).toBe('web');
    expect(claim('qqbot', true, customSurface())).toBe('qqbot');
  });

  it('claims every invocation exactly once', () => {
    for (const argv of ['', '--web', '--repl', '--web --repl', 'exec t', 'qqbot']) {
      for (const interactive of [true, false]) {
        expect(claim(argv, interactive, customSurface())).toBeTypeOf('string');
      }
    }
  });
});

describe('the registry records the winner for every kind of surface', () => {
  it('records a BUILT-IN winner, so userQuestions derives from its declaration', () => {
    const { registry, winner } = resolveWith('', true);
    expect(winner?.name).toBe('web');
    // The recording is the ONE source `runtime-env`'s userQuestions provider
    // reads ("does the surface in force have a human?").
    expect(registry.current()).toBe(winner);
  });

  it('records a configured winner the same way', () => {
    const custom = customSurface();
    const { registry, winner } = resolveWith('--web', true, custom);
    expect(winner).toBe(custom);
    expect(registry.current()).toBe(custom);
  });

  it('leaves current() undefined before any resolve (fail-closed)', () => {
    const registry = createSurfaceRegistry();
    expect(registry.current()).toBeUndefined();
  });
});
