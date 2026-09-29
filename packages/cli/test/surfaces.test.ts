/**
 * The surface registry's claim table: which argv + stdio shape gets which end.
 * Pure — no surface is started, only resolved (each `start` is an import).
 *
 * The terminal UI is NOT a built-in entry here anymore — it is a dynamically
 * loaded surface plugin (see `tui-app/src/surface.ts`). `loadDynamicSurfaces`
 * adapts each loaded `AgentSurface` into a `SurfaceEntry` consulted between the
 * subcommands and the defaults; the `tui` extra below is the fake a config row
 * would have produced, so this test pins the SAME precedence the real loader
 * establishes (an explicit opt-in outranks the browser default, yields to the
 * force-fallback `--repl`, needs a TTY).
 */
import { describe, expect, it } from 'vitest';
import { parseArgs, resolveSurface, type SurfaceEntry, type SurfaceRequest } from '../src/surfaces.js';
import type { Config } from '../src/config.js';

const config = { provider: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' } } as unknown as Config;

/**
 * The terminal-UI surface, as `loadDynamicSurfaces` would adapt it: claim reads
 * the host-owned flags off the parsed argv (`flags.tui` etc. in the real plugin
 * map to `parsed.tui` here). A real surface's `start` assembles its own kernel;
 * here it is a no-op since this test only resolves.
 */
const tuiExtra: SurfaceEntry = {
  name: 'tui',
  interactive: true,
  claim: (m) => m.parsed.tui && !m.parsed.repl && m.interactive,
  start: async () => {},
};

function request(argv: string, interactive: boolean): SurfaceRequest {
  const parsed = parseArgs(argv.split(' ').filter((s) => s.length > 0));
  if (parsed === undefined) throw new Error(`unparsable argv: ${argv}`);
  return { rootDir: '/repo', config, parsed, interactive };
}

function claim(argv: string, interactive: boolean, extras: readonly SurfaceEntry[] = []): string | undefined {
  return resolveSurface(request(argv, interactive), extras)?.name;
}

describe('surface claims', () => {
  it('routes subcommands above the interactive defaults', () => {
    expect(claim('qqbot', true)).toBe('qqbot');
    expect(claim('exec 修复测试', true)).toBe('exec');
    // A subcommand wins even without a TTY (exec is the CI surface), and even
    // when a configured surface is present — subcommands outrank everything.
    expect(claim('exec 修复测试', false)).toBe('exec');
    expect(claim('exec 修复测试', true, [tuiExtra])).toBe('exec');
  });

  it('opens the browser UI by default, and only --repl leaves it', () => {
    expect(claim('', true)).toBe('web');
    expect(claim('--web', true)).toBe('web');
    expect(claim('--repl', true)).toBe('repl');
    expect(claim('--repl --web', true)).toBe('repl');
  });

  it('opens a configured terminal UI on --tui, and --repl is never overridden', () => {
    // The terminal UI is a loaded surface; without it configured, `--tui`
    // falls through to the browser default (main() then errors with guidance —
    // an explicit opt-in must not silently pick the wrong end).
    expect(claim('--tui', true)).toBe('web');
    // With the tui surface configured, `--tui` claims it (consulted between the
    // subcommands and the browser default).
    expect(claim('--tui', true, [tuiExtra])).toBe('tui');
    // Two explicit spellings of "the terminal end" — neither may win silently,
    // so the plainest one (`--repl`) takes it. The tui surface's own claim
    // yields to `--repl` (force-fallback is stronger than "full-screen please").
    expect(claim('--tui --repl', true, [tuiExtra])).toBe('repl');
    expect(claim('--repl --tui', true, [tuiExtra])).toBe('repl');
    // The TUI keeps `--resume` / `--theme`, like every interactive surface: the
    // flags are parsed once, for all of them.
    expect(claim('--tui --resume /tmp/s.jsonl', true, [tuiExtra])).toBe('tui');
    expect(claim('--tui --theme dark', true, [tuiExtra])).toBe('tui');
  });

  it('never claims the terminal UI without a TTY on both ends', () => {
    // A raw-mode frame down a pipe has nowhere to draw and no keys to read, so
    // `--tui` degrades to the REPL instead of corrupting the stream. The tui
    // surface's own claim carries the `interactive` guard.
    expect(claim('--tui', false, [tuiExtra])).toBe('repl');
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
    expect(claim('', true, [tuiExtra])).toBe('web');
    expect(claim('qqbot', true, [tuiExtra])).toBe('qqbot');
  });

  it('claims every invocation exactly once', () => {
    for (const argv of ['', '--web', '--repl', '--tui', '--tui --repl', 'exec t', 'qqbot']) {
      for (const interactive of [true, false]) {
        expect(claim(argv, interactive, [tuiExtra])).toBeTypeOf('string');
      }
    }
  });
});
