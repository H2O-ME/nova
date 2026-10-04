/**
 * 内核装配的**唯一入口** `bootKernel`（配置降维与 provider 工厂在
 * `kernel-config.ts`）。
 *
 * 生产代码里 `createAgentKernel` 只被这里调用一次；任何 surface（内置四家或
 * 配置加载的）都经 `cli/src/surface-host.ts` 的 `buildSurfaceRuntime` 走到此处。
 * 各内置的装配差异以 `SurfaceBoot` 贡献表达（`exec` / `qqbot` / web），转发只
 * 在 surface-host 一处——「逐字段手抄漏掉新选项」不再有地方可漏。
 */
import {
  createAgentKernel,
  type ApprovalMode,
  type CreateKernelOptions,
  type Kernel,
} from '@nova-agent/plugins';
import type { ChatProvider, ModelCatalogPort, PluginEntryOptions, SurfaceRows } from '@nova-agent/core';
import type { Config } from './config.js';
import { createProvider, configuredModel, toKernelConfig } from './kernel-config.js';

export { createProvider, configuredModel, toKernelConfig } from './kernel-config.js';

/** 一个 surface 需要内核替它做的事——五种形态的全部差异就在这里。 */
export interface BootOptions {
  rootDir: string;
  config: Config;
  approvalOverride?: ApprovalMode;
  /** 续接历史会话文件（首个 session handle）。 */
  resumeFile?: string;
  /** 会话归档桶（qqbot 用 `sessionsRoot()/qqbot` 与交互会话隔离）。 */
  sessionDir?: string;
  /** 单次执行形态：整个任务一次 run，自动压缩按请求门控（exec/qqbot）。 */
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
   * fail-closed：无人值守形态（exec / qqbot）给了回答器就会卡在提问里，而没有
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
    // are siblings of this executable (`@nova-agent/qqbot` is a cli dependency,
    // not a plugins one) — see plugins/src/module-spec.ts.
    appModulesUrl: import.meta.url,
    ...(opts.surfaces !== undefined ? { surfaces: opts.surfaces } : {}),
    ...(opts.modelCatalog !== undefined ? { modelCatalog: opts.modelCatalog } : {}),
    ...(opts.persist !== undefined ? { persist: opts.persist } : {}),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.userQuestions !== undefined ? { userQuestions: opts.userQuestions } : {}),
  });
  return kernel;
}

/** 等一轮跑完：轮次生命周期由内核持有，runner 只观察 status。 */
export async function awaitIdle(agent: { readonly running: boolean }, stepMs = 20): Promise<void> {
  while (agent.running) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
