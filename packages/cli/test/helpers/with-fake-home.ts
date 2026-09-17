/**
 * Run a test body with `USERPROFILE`/`HOME` pointed at an isolated temp dir,
 * restoring both on exit. NovaAgent's sessions root derives from os.homedir(),
 * so this is how the cli tests keep runExec / session-runtime from writing
 * into the real ~/.nova. Extracted (M9.7 阶段 J) from a one-off inline in
 * session-runtime.test.ts.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function withFakeHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), 'nova-home-'));
  const prevProfile = process.env['USERPROFILE'];
  const prevHome = process.env['HOME'];
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  try {
    return await fn(home);
  } finally {
    if (prevProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevProfile;
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
  }
}
