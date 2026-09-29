/**
 * Runner 共享的内核装配**唯一一处** `bootKernel`（配置降维与 provider 工厂在
 * `kernel-config.ts`）。
 *
 * 批10 起五个 surface 的装配差异（续接文件 / 会话桶 / 请求内压缩 / 额外插件 /
 * workspace 回调 / 子代理进度 / 审批策略 / 有无人类可答问题）都落在这一个调用点
 * 上——此前每个 surface 各抄一份 `createAgentKernel`，改一处缝要改五处。
 */
import {
  createAgentKernel,
  type ApprovalMode,
  type Kernel,
} from '@nova-agent/plugins';
import type { ApprovalPolicy, ChatProvider, Plugin, SubagentProgress, SurfaceRows } from '@nova-agent/core';
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
  /** surface 自带插件（qqbot 的 send 工具）。 */
  extraPlugins?: Plugin[];
  /**
   * Configured surfaces already loaded (by `loadDynamicSurfaces`), forwarded so
   * the kernel adopts them as ordinary plugin rows. Every assembly point passes
   * its `SurfaceRequest.surfaces` here — this is the ① 调用点 half of the same
   * rule ③ uses (`buildSurfaceRuntime`): a configured surface shows up in
   * `/plugins` regardless of which surface is the host.
   */
  surfaces?: SurfaceRows;
  /** 模型侧 `switch_workspace` 入口；不给就不注册该工具。 */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
  /** 嵌套子代理的活行回馈（best-effort）。 */
  onSubagentProgress?: (progress: SubagentProgress) => void;
  /** 无人值守形态：'never' 连询问器都不派发，确定性拒绝（exec/qqbot）。 */
  policy?: ApprovalPolicy;
  /**
   * 这个 surface 有没有「人」可以回答 `ask_user_question`。默认 false =
   * fail-closed：无人值守形态（exec / qqbot）给了回答器就会卡在提问里，而没有
   * 任何界面能把它放出来。REPL 传 true；WebUI 不经 `bootKernel`，在
   * `WebController` 那侧直接传。
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
    ...(opts.surfaces !== undefined ? { surfaces: opts.surfaces } : {}),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.onSubagentProgress !== undefined ? { onSubagentProgress: opts.onSubagentProgress } : {}),
    ...(opts.userQuestions !== undefined ? { userQuestions: opts.userQuestions } : {}),
  });
  if (opts.policy !== undefined) kernel.permission.setPolicy(opts.policy);
  return kernel;
}

/** 等一轮跑完：轮次生命周期由内核持有，runner 只观察 status。 */
export async function awaitIdle(agent: { readonly running: boolean }, stepMs = 20): Promise<void> {
  while (agent.running) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
