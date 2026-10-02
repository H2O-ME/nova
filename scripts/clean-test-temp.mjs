/**
 * Sweep the test suite's leaked temp families (`nova-*` directories and
 * scratch files) from the OS temp dir.
 *
 * Individual test files `mkdtemp` their own scratch roots (`nova-web-home-`,
 * `nova-kernel-asm-`, `nova-pipe-`, …) and never remove them; the shared
 * setup file (`packages/test-setup.ts`) cleans its own home on green runs, so
 * only the per-file families accumulate. This script reaps them by AGE: a
 * directory younger than `--min-age-hours` (default 6) may belong to a run
 * that is in flight RIGHT NOW — possibly another agent session's — so it is
 * left alone. Nothing outside the `nova-` prefix is touched, and the sweep
 * is best-effort: a locked directory is reported and skipped, never fatal.
 *
 * Usage: `pnpm clean` (or `node scripts/clean-test-temp.mjs [--min-age-hours=N] [--dry-run]`).
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const ageArg = args.find((a) => a.startsWith('--min-age-hours='));
const minAgeHours = ageArg !== undefined ? Number.parseFloat(ageArg.split('=')[1]) : 6;
const dryRun = args.includes('--dry-run');
if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
  console.error(`invalid --min-age-hours: ${ageArg}`);
  process.exit(1);
}

const root = tmpdir();
const cutoff = Date.now() - minAgeHours * 3_600_000;
let freed = 0;
let skipped = 0;

for (const entry of readdirSync(root)) {
  if (!entry.startsWith('nova-')) continue;
  const full = path.join(root, entry);
  let stats;
  try {
    stats = statSync(full);
  } catch {
    continue; // vanished between readdir and stat: someone else owns it
  }
  if (stats.mtimeMs > cutoff) continue;
  if (dryRun) {
    freed += 1;
    continue;
  }
  try {
    rmSync(full, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
    freed += 1;
  } catch {
    skipped += 1; // a live handle holds it: report, don't die
  }
}

console.log(`clean-test-temp: removed ${freed} entr${freed === 1 ? 'y' : 'ies'} older than ${minAgeHours}h${skipped > 0 ? `, skipped ${skipped} locked` : ''}${dryRun ? ' (dry run)' : ''}`);
