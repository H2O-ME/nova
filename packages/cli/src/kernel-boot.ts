/**
 * Runner 共享的内核装配小件（M11 批1c）：config → `KernelConfig` 的降维
 * （cli 的配置面比内核宽——notify/ui/qqbot 归壳层）与 provider 工厂。
 * exec / repl / qqbot 三个 runner 都从这里取，装配语义只有一份；
 * provider 注入缝（ChatProvider）让测试不换配置只换假模型。
 */
import { OpenAICompatClient } from '@nova-agent/ai';
import { type ApprovalMode, type KernelConfig } from '@nova-agent/plugins';
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
  return kernel;
}

/**
 * 配置 → OpenAI 兼容客户端。sessionId 不在此绑定：会话文件由内核创建，
 * runner 在拿到 AgentSession 后 `client.setSessionId(session.id)` 重绑
 * 缓存亲和身份（/new、会话切换、qqbot 对端切换同一通道）。
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

/** 等一轮跑完：轮次生命周期由内核持有，runner 只观察 status。 */
export async function awaitIdle(agent: { readonly running: boolean }, stepMs = 20): Promise<void> {
  while (agent.running) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
