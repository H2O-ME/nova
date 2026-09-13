/**
 * 斜杠命令的逻辑核（无色、无 IO）：repl 与 TUI 的命令 switch 只做呈现。
 * 此前公式/文案/序列各写一份且已出现漂移——/new 的重置序列逐行拷贝但
 * resetSessionCache 只在 TUI 有、/plugins 两壳信息量不一致、/session 命中率
 * 一个一位小数一个取整。纯函数便于 commands.test 直接断言。
 */
import { Session, emptyStats, type AgentMessage, type Session as SessionT, type Usage, type UsageStats } from '@nova-agent/core';
import { APPROVAL_ORDER } from '@nova-agent/tui-view';
import { resetUsageAnchors, type UsageAnchorState } from './runner-loop.js';

/** /approvals：循环切换到下一档位（只读 → 自动编辑 → 全部放行 → 只读…）。 */
export function nextApprovalMode(current: string): string {
  const idx = APPROVAL_ORDER.indexOf(current as (typeof APPROVAL_ORDER)[number]);
  return APPROVAL_ORDER[(idx + 1) % APPROVAL_ORDER.length] ?? 'read-only';
}

/** /session：缓存命中率（保留一位小数；无 promptTokens 时 0.0）。 */
export function cacheHitPct(promptTokens: number, cachedTokens: number): string {
  return promptTokens > 0 ? ((cachedTokens / promptTokens) * 100).toFixed(1) : '0.0';
}

/** /session：上轮命中率；无上轮 usage 或 promptTokens=0（coerce）时 null。 */
export function lastCacheHitPct(lastUsage: Usage | undefined): string | null {
  return lastUsage !== undefined && lastUsage.promptTokens > 0
    ? Math.round((lastUsage.cachedTokens / lastUsage.promptTokens) * 100).toString()
    : null;
}

/** /plugins 的工具行（两壳同串；颜色由调用方决定）。 */
export function pluginToolLine(plugin: string, toolName: string, permission: string): string {
  return `插件=${plugin} · 工具=${toolName} · 权限=${permission}`;
}

/** /plugins 的命令行。 */
export function pluginCommandLine(plugin: string, name: string, description: string): string {
  return `插件=${plugin} · /${name} — ${description}`;
}

/** /model 的空目录与失败文案（两壳同串）。 */
export const MODEL_LIST_EMPTY = '站点未返回任何模型';
export function modelListError(err: unknown): string {
  return `模型列表获取失败：${err instanceof Error ? err.message : String(err)}`;
}

export interface FreshSessionDeps {
  sessionsDir: string;
  rootDir: string;
  /** 重绑缓存亲和身份：保留旧 id 会把旧会话的缓存键带进新会话。 */
  setClientSessionId(id: string): void;
  stats: UsageStats;
  anchors: UsageAnchorState;
  /** TUI 的转录缓存清场；repl 无此态。 */
  resetSessionCache?(): void;
  recordWorkspace(session: SessionT, rootDir: string): Promise<void>;
  seedContext(session: SessionT, messages: AgentMessage[]): Promise<void>;
}

/**
 * /new 的新会话序列（两壳曾逐行拷贝，连注释都相同，且已漂移）：建会话 →
 * 记录工作区 → 重绑缓存亲和 → 清空消息面与统计 → 锚点归零（保留任一会让
 * 旧会话缓存键进入新会话或触发伪压缩）→ 重新注入上下文片段。
 */
export async function openFreshSession(deps: FreshSessionDeps): Promise<{ session: SessionT; messages: AgentMessage[] }> {
  const session = await Session.create(deps.sessionsDir);
  await deps.recordWorkspace(session, deps.rootDir);
  deps.setClientSessionId(session.id);
  const messages: AgentMessage[] = [];
  Object.assign(deps.stats, emptyStats());
  resetUsageAnchors(deps.anchors);
  deps.resetSessionCache?.();
  await deps.seedContext(session, messages);
  return { session, messages };
}
