/**
 * Runner 共享的内核装配小件：config → `KernelConfig` 的降维（cli 的配置面比
 * 内核宽——notify/ui/qqbot 归壳层）、provider 工厂，以及**唯一一处**
 * `bootKernel`。
 *
 * 批10 起五个 surface 的装配差异（续接文件 / 会话桶 / 请求内压缩 / 额外插件 /
 * workspace 回调 / 子代理进度 / 审批策略）都落在这一段上——此前每个 surface
 * 各抄一份 `createAgentKernel`，改一处缝要改五处。provider 的缓存亲和也不再
 * 由各 surface 自己绑：内核的 `llm` 服务在会话建立时绑定。
 */
import { OpenAICompatClient } from '@nova-agent/ai';
import {
  createAgentKernel,
  type ApprovalMode,
  type Kernel,
  type KernelConfig,
  type Plugin,
} from '@nova-agent/plugins';
import type { ApprovalPolicy, ChatProvider, SubagentProgress } from '@nova-agent/core';
import type { Config } from './config.js';

/** `~/.nova/config.json` → 内核需要的最小切片（审批覆盖 = --approval）。 */
export function toKernelConfig(config: Config, approvalOverride?: ApprovalMode): KernelConfig {
  const kernel: KernelConfig = { approval: approvalOverride ?? config.approval ?? 'read-only' };
  if (config.systemPrompt !== undefined) kernel.userInstructions = config.systemPrompt;
  if (config.maxTurns !== undefined) kernel.maxTurns = config.maxTurns;
  if (config.autoCompactTokenLimit !== undefined) kernel.autoCompactTokenLimit = config.autoCompactTokenLimit;
  const bash = config.tools?.bash;
  if (bash !== undefined) {
    kernel.bash =
      bash.enabled === false
        ? false
        : {
            ...(bash.timeoutMs !== undefined ? { timeoutMs: bash.timeoutMs } : {}),
            ...(bash.shellPath !== undefined ? { shellPath: bash.shellPath } : {}),
          };
  }
  if (config.tools?.code !== undefined) kernel.code = config.tools.code;
  if (config.plugins !== undefined) kernel.plugins = config.plugins;
  return kernel;
}

/**
 * 配置 → OpenAI 兼容客户端。会话亲和不在此绑定：内核的 `llm` 服务在会话建立
 * 时绑定（/new、会话切换、qqbot 对端切换同一通道）。
 */
export function createProvider(config: Config): OpenAICompatClient {
  return new OpenAICompatClient({
    baseURL: config.provider.baseURL,
    apiKey: config.provider.apiKey,
    model: config.provider.model,
    ...(config.provider.temperature !== undefined ? { temperature: config.provider.temperature } : {}),
    ...(config.provider.maxTokens !== undefined ? { maxTokens: config.provider.maxTokens } : {}),
  });
}

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
  /** 模型侧 `switch_workspace` 入口；不给就不注册该工具。 */
  workspace?: { onChange: (dir: string) => void | Promise<void> };
  /** 嵌套子代理的活行回馈（best-effort）。 */
  onSubagentProgress?: (progress: SubagentProgress) => void;
  /** 无人值守形态：'never' 连询问器都不派发，确定性拒绝（exec/qqbot）。 */
  policy?: ApprovalPolicy;
  /** 测试注入的假 provider（省略则按 config 建真客户端）。 */
  provider?: ChatProvider;
}

/** 装配内核：五个 surface 共用的唯一一段装配。 */
export async function bootKernel(opts: BootOptions): Promise<Kernel> {
  const kernel = await createAgentKernel({
    rootDir: opts.rootDir,
    provider: opts.provider ?? createProvider(opts.config),
    model: opts.config.provider.model,
    config: toKernelConfig(opts.config, opts.approvalOverride),
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    ...(opts.sessionDir !== undefined ? { sessionDir: opts.sessionDir } : {}),
    ...(opts.perRequestCompact !== undefined ? { perRequestCompact: opts.perRequestCompact } : {}),
    ...(opts.extraPlugins !== undefined ? { extraPlugins: opts.extraPlugins } : {}),
    ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
    ...(opts.onSubagentProgress !== undefined ? { onSubagentProgress: opts.onSubagentProgress } : {}),
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