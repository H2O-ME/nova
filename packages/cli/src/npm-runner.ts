/**
 * The default package-manager runner for `nova plugin add|remove`.
 *
 * npm, because it ships with Node: nothing in the product assumes the user runs
 * the same package manager nova itself was installed with (the plugin root is a
 * plain package directory, and any of them can drive it — this is the one that
 * is always there).
 *
 * Split from `plugin-command.ts` because this is a different question: that file
 * decides WHAT to install and in what order, this one only knows how to drive a
 * package manager and report its outcome. The command's tests replace it
 * wholesale, so the repo's tests never touch the network.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { errMessage } from '@nova-agent/core';
import type { PluginRunOutcome } from './plugin-command.js';

/** cmd.exe quoting: wrap in double quotes, doubling any quote inside. */
function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** One install/uninstall attempt through the system package manager. */
export function npmRun(verb: 'install' | 'uninstall'): (spec: string, dir: string) => Promise<PluginRunOutcome> {
  return async (spec, dir) => {
    try {
      // npm would create the prefix itself; doing it here keeps the failure (a
      // home directory the process cannot write) attributed to this step.
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: false, message: `无法创建 ${dir}：${errMessage(err)}` };
    }
    // On Windows `npm` is a `.cmd` shim: spawning it without a shell fails with
    // EINVAL, and the shell is what resolves the shim. A shell run passes the
    // WHOLE command as one string (below) rather than shell + argv — Node's
    // shell mode concatenates argv without escaping (DEP0190), so the quoting is
    // ours: double quotes with cmd.exe's `""` doubling, or sh's single quotes.
    const result =
      process.platform === 'win32'
        ? spawnSync(`npm.cmd ${verb} --prefix ${quoteCmd(dir)} ${quoteCmd(spec)}`, { stdio: 'inherit', cwd: dir, shell: true })
        : spawnSync('npm', [verb, '--prefix', dir, spec], { stdio: 'inherit', cwd: dir });
    if (result.error !== undefined) return { ok: false, message: errMessage(result.error) };
    return result.status === 0 ? { ok: true } : { ok: false, message: `npm 退出码 ${String(result.status)}` };
  };
}
