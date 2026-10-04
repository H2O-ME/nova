/**
 * `nova plugin add|remove|list` — the command surface of the USER PLUGIN ROOT.
 *
 * Two decisions shape this file:
 *
 *  - **It runs before the config is loaded, and before any kernel exists.** The
 *    rows it rewrites are the ones the NEXT boot reads, and the failure it exists
 *    to repair — a plugin row whose module cannot be loaded — makes boot fail
 *    outright. A repair tool that needs a working boot cannot repair a boot.
 *  - **`add` writes the config row LAST.** Install, then prove the module really
 *    exports a plugin (through `loadPluginModule` + a throwaway host — the very
 *    check boot performs), and only then remember it. A failed install or a
 *    package that exports nothing leaves no row behind, so the next boot is never
 *    broken by a half-finished command. `remove` is the mirror image: the row
 *    goes first, because a leftover package on disk is inert while a leftover row
 *    fails boot.
 *
 * The installer defaults to `npm` (it ships with Node; nothing here assumes the
 * user runs the product's own package manager). The config row stores the bare
 * package NAME even when the install spec carried a version or tag — that name is
 * what Node imports and what `resolveModuleSpec` looks up.
 *
 * A row is `{ id, enabled }`: the SAME field the settings panel writes and the
 * boot path reads. The old `plugins.extra` list was a second door — an installed
 * plugin could be listed there and still be switched off elsewhere, or vice
 * versa, so `nova plugin list` and the panel could disagree about what was on.
 *
 * Everything these lines interpolate is EXTERNAL: the operator's argv, the row
 * ids a hand-edited config holds, the paths under the user root, and the npm /
 * plugin failure messages. Each of those goes through `oneLineText` (see
 * `lines.ts`) so a stray `\r` cannot overwrite what is already on the terminal;
 * the fixed copy around them is left alone.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { errMessage, userPluginsDir } from '@nova-agent/core';
import { resolvableFromProduct } from '@nova-agent/plugins';
import { readPluginSpecs } from './config-read.js';
import { removePluginEntry, setPluginEntry } from './config-write.js';
import { oneLineText } from './lines.js';
import { npmRun } from './npm-runner.js';
import { applyFailure } from './plugin-probe.js';

const USAGE = 'usage: nova plugin add <包名> | nova plugin remove <包名> | nova plugin list';

/** One install/uninstall attempt's outcome. */
export interface PluginRunOutcome {
  ok: boolean;
  message?: string;
}

/** The collaborators a test replaces: the package manager, and where lines go. */
export interface PluginCommandDeps {
  install(spec: string, dir: string): Promise<PluginRunOutcome>;
  uninstall(name: string, dir: string): Promise<PluginRunOutcome>;
  log(line: string): void;
}

/**
 * The package NAME a spec names.
 *
 * An install spec may carry a version or tag (`foo@1.2.3`, `@scope/foo@next`)
 * and the config row must hold the bare name: that is what `import` takes and
 * what the resolver looks up. A path (absolute or `.`-relative) is not a package
 * name at all.
 * @param spec - the operator's argument.
 * @returns the name, or undefined for a path / empty input.
 */
export function packageNameOf(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (trimmed.length === 0 || isAbsolute(trimmed) || trimmed.startsWith('.')) return undefined;
  const at = trimmed.lastIndexOf('@');
  const name = at > 0 ? trimmed.slice(0, at) : trimmed;
  return name.length > 0 ? name : undefined;
}

/**
 * Run one `nova plugin …` invocation.
 * @param argv - the arguments AFTER `plugin`.
 * @param overrides - test seam for the package manager and the log.
 * @returns the process exit code (0 ok, 1 refused/failed).
 */
export async function runPluginCommand(argv: readonly string[], overrides: Partial<PluginCommandDeps> = {}): Promise<number> {
  const log = overrides.log ?? ((line: string): void => { console.log(line); });
  const [sub, arg, ...rest] = argv;
  if (rest.length > 0) {
    log(USAGE);
    return 1;
  }
  const dir = userPluginsDir();
  // `list` takes no argument: `nova plugin list extra` is a typo, not a query.
  if (sub === 'list' && arg === undefined) return listPlugins(dir, log);
  if (sub === 'add' && arg !== undefined) return addPlugin(arg, dir, overrides, log);
  if (sub === 'remove' && arg !== undefined) return removePlugin(arg, dir, overrides, log);
  log(USAGE);
  return 1;
}

async function addPlugin(raw: string, dir: string, deps: Partial<PluginCommandDeps>, log: (line: string) => void): Promise<number> {
  const name = packageNameOf(raw);
  if (name === undefined) {
    log(`「${oneLineText(raw)}」不是可安装的包名（路径型扩展直接写进 plugins.entries 即可）。`);
    return 1;
  }
  log(`安装 ${oneLineText(raw)} → ${oneLineText(dir)}`);
  const outcome = await (deps.install ?? npmRun('install'))(raw, dir);
  if (!outcome.ok) {
    log(`安装失败：${oneLineText(outcome.message ?? '未知原因')}；配置未改动。`);
    return 1;
  }
  // The boot check, reused: the row is only worth writing if the module the next
  // boot will import actually loads and applies.
  let failure: string | undefined;
  try {
    failure = await applyFailure(name, import.meta.url);
  } catch (err) {
    failure = errMessage(err);
  }
  if (failure !== undefined) {
    log(`这个包没能作为一个插件加载起来：${oneLineText(failure)}`);
    log('配置未改动——包仍躺在用户插件根里，可用 nova plugin remove 清掉。');
    return 1;
  }
  await setPluginEntry(name, { enabled: true });
  log(`已启用插件：${oneLineText(name)}`);
  log('下次启动 nova 时加载；也可以在设置页的插件管理里看到它。');
  return 0;
}

async function removePlugin(raw: string, dir: string, deps: Partial<PluginCommandDeps>, log: (line: string) => void): Promise<number> {
  const name = packageNameOf(raw) ?? raw;
  const stored = await readPluginSpecs(BUILTIN_IDS);
  if (!stored.includes(name)) {
    log(`${oneLineText(name)} 不在插件清单里（nova plugin list 看当前清单）。`);
    return 1;
  }
  // Row FIRST: an orphan package on disk is inert, an orphan row fails boot.
  await removePluginEntry(name);
  log(`已移出插件清单：${oneLineText(name)}`);
  const outcome = await (deps.uninstall ?? npmRun('uninstall'))(name, dir);
  if (!outcome.ok) {
    log(`包没能从磁盘卸载：${oneLineText(outcome.message ?? '未知原因')}（配置已更新，留着不影响启动）。`);
    return 0;
  }
  log(`已从 ${oneLineText(dir)} 卸载。`);
  return 0;
}

/**
 * The ids this build provides IN-PROCESS, which the installer does not manage.
 *
 * Deliberately a static list rather than an import of the real tree: this command
 * runs before the config exists, and a plugin package that fails to resolve is
 * exactly the situation it exists to repair. Only used to keep built-ins out of
 * `nova plugin list` / `remove`.
 */
const BUILTIN_IDS: readonly string[] = [
  'ask-user', 'bash', 'fs-read', 'fs-write', 'goal', 'jobs', 'search', 'skill-tool', 'todo', 'workspace', 'toolbox',
];

async function listPlugins(dir: string, log: (line: string) => void): Promise<number> {
  const stored = await readPluginSpecs(BUILTIN_IDS);
  log(`用户插件根：${oneLineText(dir)}`);
  if (stored.length === 0) {
    log('插件清单为空。用 nova plugin add <包名> 装一个。');
    return 0;
  }
  for (const spec of stored) log(`  ${oneLineText(spec)}　${oneLineText(describeSpec(spec, dir))}`);
  return 0;
}

/**
 * Where a configured row will be found at boot — the resolver's own three cases
 * plus the honest fourth: nothing can resolve it, and that row will fail the
 * next boot (which is what `remove` is for).
 */
function describeSpec(spec: string, dir: string): string {
  if (isAbsolute(spec) || spec.startsWith('.')) return '（本地路径）';
  // Product BEFORE the user root — the resolver's own order, because the root is
  // a fallback and never a shadow: a row present in both trees really loads from
  // the product, so calling it "用户插件根" would name the wrong copy.
  // Same anchor boot uses — this cli's own module URL, not the resolver library's.
  if (resolvableFromProduct(spec, import.meta.url)) return '（随产品解析）';
  if (existsSync(join(dir, 'node_modules', spec, 'package.json'))) return '（用户插件根）';
  return '（缺失——启动时这一行会报错）';
}
