/**
 * 斜杠命令的逻辑核（无色、无 IO）：repl 与 TUI 的命令 switch 只做呈现。
 * 此前公式/文案/序列各写一份且已出现漂移——/new 的重置序列逐行拷贝但
 * resetSessionCache 只在 TUI 有、/plugins 两壳信息量不一致、/session 命中率
 * 一个一位小数一个取整。纯函数便于 commands.test 直接断言。
 */
import path from 'node:path';
import { errMessage, Session, emptyStats, type AgentMessage, type Session as SessionT, type Usage, type UsageStats } from '@nova-agent/core';
import { APPROVAL_ORDER, approvalLabel, padDisplay } from '@nova-agent/tui-view';
import type { ApprovalMode } from '@nova-agent/plugins';
import { resetUsageAnchors, type UsageAnchorState } from './runner-loop.js';

/** /approvals：循环切换到下一档位（只读 → 自动编辑 → 全部放行 → 只读…）。 */
export function nextApprovalMode(current: ApprovalMode): ApprovalMode {
  const idx = APPROVAL_ORDER.indexOf(current);
  return APPROVAL_ORDER[(idx + 1) % APPROVAL_ORDER.length] ?? 'read-only';
}

/** /approvals 切换后的反馈行正文（两壳同串；gutter/颜色由调用方加）。 */
export function approvalSwitchLine(mode: ApprovalMode): string {
  return `审批档位：${approvalLabel(mode)}`;
}

/** /help：命令清单行（usage 列宽 24、CJK 安全；颜色由调用方决定）。 */
export function helpRows(specs: { usage: string; description: string }[]): string[] {
  return specs.map((spec) => `  ${padDisplay(spec.usage, 24)}${spec.description}`);
}

/** /theme：三候选主题（开屏 --theme 校验与命令面板共用同一清单）。 */
export const THEME_NAMES = ['dark', 'light', 'plain'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** /theme 参数校验：合法返回主题名，未知返回 undefined。 */
export function themeTarget(arg: string): ThemeName | undefined {
  return (THEME_NAMES as readonly string[]).includes(arg) ? (arg as ThemeName) : undefined;
}

/** /theme 未知参数与切换成功的反馈正文（两壳同串）。 */
export function themeUnknownMessage(arg: string): string {
  return `未知主题：${arg}（可选 dark / light / plain）`;
}
export function themeSwitchedMessage(name: ThemeName): string {
  return `主题已切换为 ${name}`;
}

/** /new 与 /init 的反馈行正文（两壳同串）。 */
export function newSessionLine(file: string): string {
  return `新会话：${file}`;
}
export function agentsMdWrittenLine(file: string): string {
  return `已写入 ${path.basename(file)}`;
}

/** 未知命令：正文与提示拆两段（TUI 两段异色；repl 连排即整句）。 */
export function unknownCommandParts(cmd: string): { head: string; hint: string } {
  return { head: `未知命令：${cmd}`, hint: '（输入 /help 查看命令）' };
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
  return `模型列表获取失败：${errMessage(err)}`;
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
