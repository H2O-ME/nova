/**
 * Runtime version single source of truth. Reads packages/cli/package.json via
 * createRequire — the pattern resolves identically in the src world (tsx type
 * stripping, where ./version.ts sits next to ../package.json) and the built
 * world (tsdown bundles to dist/index.mjs but still resolves ../package.json
 * under packages/cli). The read is cached so repeated calls never re-require.
 */
import { createRequire } from 'node:module';

const requireFromCli = createRequire(import.meta.url);

let cached: string | undefined;

export function cliVersion(): string {
  if (cached === undefined) {
    cached = (requireFromCli('../package.json') as { version: string }).version;
  }
  return cached;
}