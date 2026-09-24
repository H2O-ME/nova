/**
 * The surface registry's claim table: which argv + stdio shape gets which end.
 * Pure — no surface is started, only resolved (each `start` is an import).
 */
import { describe, expect, it } from 'vitest';
import { parseArgs, resolveSurface, type SurfaceRequest } from '../src/surfaces.js';
import type { Config } from '../src/config.js';

const config = { provider: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' } } as unknown as Config;

function request(argv: string, interactive: boolean): SurfaceRequest {
  const parsed = parseArgs(argv.split(' ').filter((s) => s.length > 0));
  if (parsed === undefined) throw new Error(`unparsable argv: ${argv}`);
  return { rootDir: '/repo', config, parsed, interactive };
}

function claim(argv: string, interactive: boolean): string | undefined {
  return resolveSurface(request(argv, interactive))?.name;
}

describe('surface claims', () => {
  it('routes subcommands above the interactive defaults', () => {
    expect(claim('qqbot', true)).toBe('qqbot');
    expect(claim('exec 修复测试', true)).toBe('exec');
    // A subcommand wins even without a TTY (exec is the CI surface).
    expect(claim('exec 修复测试', false)).toBe('exec');
  });

  it('opens the browser UI by default, and only --repl leaves it', () => {
    expect(claim('', true)).toBe('web');
    expect(claim('--web', true)).toBe('web');
    expect(claim('--repl', true)).toBe('repl');
    expect(claim('--repl --web', true)).toBe('repl');
  });

  it('falls back to the REPL without a TTY, but honors an explicit --web', () => {
    expect(claim('', false)).toBe('repl');
    // The smoke harness drives the browser surface down a pipe: `--web` must
    // not be demoted to the REPL just because stdio is not a terminal.
    expect(claim('--web', false)).toBe('web');
  });

  it('claims every invocation exactly once', () => {
    for (const argv of ['', '--web', '--repl', 'exec t', 'qqbot']) {
      for (const interactive of [true, false]) {
        expect(claim(argv, interactive)).toBeTypeOf('string');
      }
    }
  });
});