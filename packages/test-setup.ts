/**
 * Test-run isolation: point `~/.nova` at a throwaway directory before any test
 * module loads.
 *
 * WHY THIS EXISTS — and why it is here rather than in each test:
 *
 * `novaHome()` resolves against `os.homedir()`, which follows `USERPROFILE` /
 * `HOME` at CALL time. Individual tests that remembered to swap those variables
 * were isolated; the ones that did not (five of them, including
 * `plugins/test/runtime.test.ts`, which builds a REAL kernel over a temp
 * workspace) wrote their session logs, spill caches and config into the
 * developer's actual `~/.nova/`. The result was hundreds of junk session files
 * in the real home — a test suite must never touch the operator's data, and a
 * rule every author has to REMEMBER is a rule that will be forgotten.
 *
 * So the isolation is installed ONCE, below every suite, and it is total: there
 * is no opt-in, no per-file helper to call, and no way to forget. A test that
 * genuinely needs a specific home still uses `withFakeHome`, which now merely
 * narrows the window further — it no longer has to be the thing that saves the
 * developer's data.
 *
 * The directory is left behind deliberately (the OS temp reaper owns it): a
 * failed run's state is then still inspectable, which is exactly when a test
 * author wants it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(tmpdir(), 'nova-test-home-'));
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
// `os.homedir()` on POSIX prefers `HOME`; on Windows it prefers `USERPROFILE`.
// Both are set above, and `HOMEDRIVE`/`HOMEPATH` are cleared so a Windows
// lookup cannot fall back to the real profile through those instead.
delete process.env['HOMEDRIVE'];
delete process.env['HOMEPATH'];
