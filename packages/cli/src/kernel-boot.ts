/**
 * 内核装配的**唯一入口** `bootKernel`（配置降维与 provider 工厂在
 * `kernel-config.ts`）。
 *
 * 生产代码里 `createAgentKernel` 只被这里调用一次；任何 surface（内置四家或
 * 配置加载的）都经 `cli/src/surface-host.ts` 的 `buildSurfaceRuntime` 走到此处。
 * 各内置的装配差异以 `SurfaceBoot` 贡献表达（`exec` / web），转发只
 * 在 surface-host 一处——「逐字段手抄漏掉新选项」不再有地方可漏。
 */
import {
  createAgentKernel,
  type ApprovalMode,
  type CreateKernelOptions,
  type Kernel,
} from '@nova-agent/plugins';
import type { ChatProvider, ModelCatalogPort, PluginEntryOptions, SurfaceRows } from '@nova-agent/core';
import { discoverPacks, type LoadedPack } from '@nova-agent/plugins';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { novaHome } from '@nova-agent/core';
import { loadConfig, type Config } from './config.js';
import { createProvider, createTitleProvider, configuredModel, toKernelConfig } from './kernel-config.js';

export { createProvider, configuredModel, toKernelConfig } from './kernel-config.js';

/**
 * The packs that SHIP with the product, as a directory of pack directories.
 *
 * Two layouts, both two answers away from `import.meta.url`:
 *   - a checkout / dev run — this module is `<repo>/packages/cli/{src,dist}/`,
 *     so the packs are three levels up at `<repo>/packs`;
 *   - a bundled runtime — the shell ships `<resources>/runtime/dist/index.mjs`
 *     and the same directory carries `runtime/packs`, one level up.
 *
 * Absent simply means "the product shipped no packs" — a normal state, not an
 * error, so this returns `undefined` rather than throwing.
 */
function bundledPacksRoot(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '..', '..', '..', 'packs'),
    path.resolve(here, '..', 'packs'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Load every plugin pack this process may load.
 *
 * Three roots, two defaults: the installed packs directory (`~/.nova/plugins`)
 * and whatever `plugins.dirs` names are ON unless a row turns them off; the
 * bundles that ship with the product are OFF unless a row turns them on. The
 * asymmetry is deliberate — see `packs/README.md`: a bundled pack is something
 * the product carries, not something the operator asked to run, and its hooks
 * execute local commands and can write beside the scan root.
 *
 * Failures are reported, never thrown: a malformed pack must not keep the
 * agent from starting.
 * @param config - the loaded config document.
 * @param rootDir - the workspace root (relative `plugins.dirs` resolve against it).
 * @param onDiagnostic - sink for load problems; defaults to stderr.
 * @returns the loaded packs, ready for `createAgentKernel`.
 */
export async function loadConfiguredPacks(
  config: Config,
  rootDir: string,
  onDiagnostic: (message: string) => void = (message) => {
    process.stderr.write(`nova: ${message}\n`);
  },
): Promise<LoadedPack[]> {
  const bundled = bundledPacksRoot();
  const extraDirs = (config.plugins?.dirs ?? []).map((dir) => path.resolve(rootDir, dir));
  return discoverPacks(
    {
      installedRoot: path.join(novaHome(), 'plugins'),
      ...(extraDirs.length > 0 ? { extraDirs } : {}),
      ...(bundled === undefined ? {} : { bundledDirs: [bundled] }),
      ...(config.plugins?.entries !== undefined ? { entries: config.plugins.entries } : {}),
    },
    onDiagnostic,
  );
}

/** 一个 surface 需要内核替它做的事——五种形态的全部差异就在这里。 */
export interface BootOptions {
  rootDir: string;
  config: Config;
  approvalOverride?: ApprovalMode;
  /** 续接历史会话文件（首个 session handle）。 */
  resumeFile?: string;
  /** 会话归档桶（渠道面可用它与交互会话隔离）。 */
  sessionDir?: string;
  /** 单次执行形态：整个任务一次 run，自动压缩按请求门控（exec）。 */
  perRequestCompact?: boolean;
  /** The surface's own plugin rows (each carrying the id its config uses). */
  extraPlugins?: readonly PluginEntryOptions[];
  /**
   * Configured surfaces already loaded (by `loadDynamicSurfaces`), forwarded so
   * the kernel adopts them as ordinary plugin rows — a configured surface shows
   * up in `/plugins` regardless of which surface is the host. Also what makes
   * `registry.current()` (the userQuestions source) available to the kernel.
   */
  surfaces?: SurfaceRows;
  /**
   * Model metadata for the picker（web 面用）。原样透传：只有浏览器界面渲染
   * 模型选择器，而内核的 `models` 控制恰好在此端口被提供时出现。
   */
  modelCatalog?: ModelCatalogPort;
  /**
   * 设置页开关的写回器（web 面用）。原样透传：写的是操作者的配置文件，
   * 所以只有掌握该文件的界面才会提供。
   */
  persist?: CreateKernelOptions['persist'];
  /** 模型侧 `switch_workspace` 入口；不给就不注册该工具。由 `buildSurfaceRuntime` 以 holder 包裹后传入。 */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
  /**
   * 这个 surface 有没有「人」可以回答 `ask_user_question`。默认 false =
   * fail-closed：无人值守形态（exec）给了回答器就会卡在提问里，而没有
   * 任何界面能把它放出来。`buildSurfaceRuntime` 传 `deriveUserQuestions(surface)`；
   * 覆盖没有注册表的装配（内核测试 / 嵌入方）。
   */
  userQuestions?: boolean;
  /** 测试注入的假 provider（省略则按 config 建真客户端）。 */
  provider?: ChatProvider;
}

/** 装配内核：五个 surface 共用的唯一一段装配。 */
export async function bootKernel(opts: BootOptions): Promise<Kernel> {
  const provider = opts.provider ?? (await createProvider(opts.config));
  // The title model is read per SESSION OPEN, not captured here: the settings
  // page writes the config file, and a boot-time client would keep titling new
  // conversations with a model the operator already replaced. The read fails
  // soft (no endpoint / broken file / no title model → no titles) — a label
  // never blocks a turn.
  //
  // Deliberately NOT gated on the boot config's `titleModel`: gating here made
  // the per-open read a lie — a title model configured from the settings page
  // during the run was never seen, so every conversation opened afterwards (the
  // channel surfaces' included) stayed untitled until a restart. `createTitleProvider`
  // already answers `undefined` when the file names none, which is the honest
  // place for that decision: it is re-made on every read.
  const titleProvider = async (): Promise<ChatProvider | undefined> => {
    try {
      return createTitleProvider(await loadConfig());
    } catch {
      return undefined;
    }
  };
  const packs = await loadConfiguredPacks(opts.config, opts.rootDir);
  const kernel = await createAgentKernel({
    rootDir: opts.rootDir,
    provider,
    // The client's id, not the config's: `createProvider` reconciled it against
    // the endpoint's catalog, and the `llm` service publishes what requests
    // carry. A caller-injected provider has its own `model` (often none).
    model: provider.model ?? configuredModel(opts.config),
    config: toKernelConfig(opts.config, opts.approvalOverride),
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    ...(opts.sessionDir !== undefined ? { sessionDir: opts.sessionDir } : {}),
    ...(opts.perRequestCompact !== undefined ? { perRequestCompact: opts.perRequestCompact } : {}),
    ...(opts.extraPlugins !== undefined ? { extraPlugins: opts.extraPlugins } : {}),
    // The anchor for bare module specs: the app's OWN module URL, never the
    // resolver library's. A row may name a package this product ships, and those
    // are siblings of this executable (a channel PACKAGE is a cli dependency,
    // not a plugins one) — see plugins/src/module-spec.ts.
    appModulesUrl: import.meta.url,
    ...(opts.surfaces !== undefined ? { surfaces: opts.surfaces } : {}),
    ...(opts.modelCatalog !== undefined ? { modelCatalog: opts.modelCatalog } : {}),
    ...(opts.persist !== undefined ? { persist: opts.persist } : {}),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.userQuestions !== undefined ? { userQuestions: opts.userQuestions } : {}),
    ...(packs.length > 0 ? { packs } : {}),
    titleProvider,
  });
  return kernel;
}

/** 等一轮跑完：轮次生命周期由内核持有，runner 只观察 status。 */
export async function awaitIdle(agent: { readonly running: boolean }, stepMs = 20): Promise<void> {
  while (agent.running) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
