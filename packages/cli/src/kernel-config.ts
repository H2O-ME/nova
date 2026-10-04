/**
 * `~/.nova/config.json` → 内核需要的两件东西：`KernelConfig` 切片与 OpenAI 兼容
 * 客户端。
 *
 * 从 `kernel-boot.ts` 拆出：那个文件的职责是**唯一一处装配**（`bootKernel`），而
 * 这里只是配置面的降维与构造，读者与失败模式都不同——配置降维漏字段是「静默少
 * 传」，装配写错是「surface 之间不一致」。
 *
 * **降维现在是直通**：插件的开关与设置就是内核读的那一份（`plugins.entries`），
 * 所以这里没有「把 A 字段翻译成 B 名单」的投影，也就没有投影漂移的地方。曾经这里
 * 做三件事——把 `tools.code.mode` 折算成 `ptc` 的录取、把 `qqbot` 块折算成 `qqbot`
 * 的录取、再让这些推导去和 `plugins.disable` 较劲——那三处正是「关掉的插件自己复活」
 * 的来源。
 *
 * 会话亲和不在这里绑定：内核的 `llm` 服务在会话建立时绑定（/new、会话切换、
 * 对端切换同一通道）。
 */
import { OpenAICompatClient } from '@nova-agent/ai';
import type { ApprovalMode, KernelConfig } from '@nova-agent/plugins';
import type { Config } from './config.js';
import { NO_PROVIDER_MESSAGE, resolveProvider } from './provider-store.js';
import { resolveProviderModel } from './provider-model-resolve.js';

// The id-reconciliation half lives in `provider-model-resolve.ts` (it needs the
// network; this file only projects config) and is re-exported so callers of this
// module keep one import for "build the client, and know its real model name".
export { MODEL_RESOLVE_TIMEOUT_MS, resolveProviderModel, type ResolvedModel } from './provider-model-resolve.js';

/** `~/.nova/config.json` → 内核需要的最小切片（审批覆盖 = --approval）。 */
export function toKernelConfig(config: Config, approvalOverride?: ApprovalMode): KernelConfig {
  const kernel: KernelConfig = { approval: approvalOverride ?? config.approval ?? 'read-only' };
  if (config.systemPrompt !== undefined) kernel.userInstructions = config.systemPrompt;
  if (config.maxTurns !== undefined) kernel.maxTurns = config.maxTurns;
  if (config.autoCompactTokenLimit !== undefined) kernel.autoCompactTokenLimit = config.autoCompactTokenLimit;
  if (config.projectDocMaxTokens !== undefined) kernel.projectDocMaxTokens = config.projectDocMaxTokens;
  if (config.plugins !== undefined) kernel.plugins = { entries: config.plugins.entries ?? [] };
  if (config.skills?.disable !== undefined) kernel.skillsDisable = config.skills.disable;
  return kernel;
}

/**
 * 配置 → OpenAI 兼容客户端（真实 provider；测试注入假 provider 时不经这里）。
 *
 * 返回具体类而非 `ChatProvider`：`repl.ts` 用它读端点标签/窗口与 `setModel`
 * （模型座位需要就地改写同一实例），这些在接口上没有。
 *
 * **建客户端的同时把模型名对账到端点公布的拼写**（`resolveProviderModel`）：请求
 * 名以 `GET /models` 为准，配置里的大小写错误就不再是故障。这是**唯一**做这件事的
 * 地方——四个 surface 都从这里拿客户端，而注入假 provider 的测试根本不经过它，所以
 * 没有任何一条路径会各自决定「请求该报哪个名字」。
 *
 * **未配置端点时抛 `NO_PROVIDER_MESSAGE`**：那是产品里唯一一句「你还没配」的说明，
 * 由调用方在能显示它的地方渲染（WebUI 落到设置页），不是一句栈里的英文。
 * @param config - the loaded config.
 * @returns the client, already reconciled against the endpoint's own catalog.
 */
export async function createProvider(config: Config): Promise<OpenAICompatClient> {
  const endpoint = resolveProvider(config);
  if (endpoint === undefined) throw new Error(NO_PROVIDER_MESSAGE);
  const client = new OpenAICompatClient({
    baseURL: endpoint.baseURL,
    apiKey: endpoint.apiKey,
    model: config.provider?.model ?? '',
    ...(endpoint.temperature !== undefined ? { temperature: endpoint.temperature } : {}),
    ...(endpoint.maxTokens !== undefined ? { maxTokens: endpoint.maxTokens } : {}),
  });
  await resolveProviderModel(client);
  return client;
}

/** 在役端点的模型 id（老配置读 `provider.model`，新配置读在役端点自己的清单）。 */
export function configuredModel(config: Config): string | undefined {
  return config.provider?.model;
}
