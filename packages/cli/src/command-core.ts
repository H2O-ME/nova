/**
 * 斜杠命令的逻辑核（无色、无 IO）：repl 的命令 switch 只做呈现。
 * 纯函数便于 commands.test 直接断言。M11 批1c：`/new` 的重置序列随
 * openFreshSession 一并退役——内核 `kernel.newAgentSession()` 是新会话
 * 的唯一公式（建日志 + 种片段 + 重指 current 一处收拢）。
 */
import path from 'node:path';
import { errMessage, type Usage, type UsageStats } from '@nova-agent/core';
import {
  readSkillBody,
  type ApprovalMode,
  type SkillMetadata,
} from '@nova-agent/plugins';
import { APPROVAL_ORDER, approvalLabel, padDisplay } from './lines.js';

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

/** 未知命令：正文与提示拆两段（连排即整句）。 */
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
/** /model 清单行：当前模型带 ❯ 箭头与（当前）标（repl 形态）。 */
export function modelListRows(current: string, models: string[]): string[] {
  return models.map(
    (model, i) => `  ${model === current ? '❯' : ' '} ${i + 1}. ${model}${model === current ? '（当前）' : ''}`,
  );
}
/** /session 报告体（repl 形态的平铺行）。 */
export function sessionReportLines(opts: {
  file: string;
  messageCount: number;
  stats: UsageStats;
  lastUsage: Usage | undefined;
  lastPromptTokens: number;
  autoCompactTokenLimit: number | undefined;
}): string[] {
  const hit = cacheHitPct(opts.stats.promptTokens, opts.stats.cachedTokens);
  const lastHit = lastCacheHitPct(opts.lastUsage);
  const compact = opts.autoCompactTokenLimit
    ? `阈值 ${opts.autoCompactTokenLimit} tok · 上轮 ${opts.lastPromptTokens} tok`
    : '未启用';
  return [
    `文件：${opts.file}`,
    `消息 ${opts.messageCount} 条 · ${opts.stats.turns} 轮 · 输入 ${opts.stats.promptTokens} tok · 缓存 ${hit}%${lastHit !== null ? `（上轮 ${lastHit}%）` : ''} · 输出 ${opts.stats.completionTokens} tok`,
    `缓存浪费 ${opts.stats.missTokens} tok（超噪声底 ${opts.stats.missTurns} 轮）`,
    `自动压缩：${compact}`,
  ];
}
/** /plugins 报告体（repl 形态）。 */
export function pluginReportLines(opts: {
  approvalMode: ApprovalMode;
  override: boolean;
  tools: { plugin: string; name: string; permission: string }[];
  commands: { plugin: string; name: string; description: string }[];
  /**
   * The live roster (name / state / declared deps) — what actually loaded.
   * Without it `/plugins` could only show registered tools, so a plugin that
   * failed to activate (or one whose provider is missing) was invisible: the
   * exact thing you open this command to find out.
   */
  roster?: readonly { name: string; state: string; inject: readonly string[] }[];
}): string[] {
  return [
    `审批档位：${approvalLabel(opts.approvalMode)}${opts.override ? '（来自 --approval）' : ''}`,
    ...(opts.roster === undefined || opts.roster.length === 0
      ? []
      : [
          `已加载插件（${opts.roster.length}）：`,
          ...opts.roster.map((entry) => `  ${pluginRosterLine(entry)}`),
        ]),
    ...(opts.tools.length === 0 ? ['（没有已注册的工具）'] : []),
    ...opts.tools.map((t) => `  ${pluginToolLine(t.plugin, t.name, t.permission)}`),
    ...opts.commands.map((c) => `  ${pluginCommandLine(c.plugin, c.name, c.description)}`),
  ];
}

/** One roster row: name, state, and what it declared it needs. */
export function pluginRosterLine(entry: {
  name: string;
  state: string;
  inject: readonly string[];
}): string {
  const deps = entry.inject.length > 0 ? ` ◂ ${entry.inject.join(', ')}` : '';
  return `${padDisplay(entry.name, 18)}${entry.state}${deps}`;
}
export function modelListError(err: unknown): string {
  return `模型列表获取失败：${errMessage(err)}`;
}

export type SkillInvocation = { ok: true; content: string } | { ok: false; error: string };

/**
 * `/skill <name>` expands to a user message carrying the skill's full
 * instructions, which then runs like any normal user input. Returns
 * undefined when the input is not a skill invocation.（M11：从 cli 的
 * context 壳文件收进命令逻辑核——片段装配本体已下沉 core。）
 */
export async function expandSkillInvocation(
  input: string,
  skills: readonly SkillMetadata[],
): Promise<SkillInvocation | undefined> {
  const trimmed = input.trim();
  if (trimmed !== '/skill' && !trimmed.startsWith('/skill ')) return undefined;
  const name = trimmed.slice('/skill'.length).trim().split(/\s+/)[0] ?? '';
  if (name.length === 0) {
    const available = skills.map((s) => s.name).join(', ');
    return { ok: false, error: `用法：/skill <name>${available.length > 0 ? `（可用：${available}）` : '（未安装任何技能）'}` };
  }
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    const available = skills.map((s) => s.name).join(', ');
    return { ok: false, error: `未知技能 "${name}"${available.length > 0 ? `（可用：${available}）` : '（未安装任何技能）'}` };
  }
  const body = await readSkillBody(skill).catch(() => undefined);
  if (body === undefined) {
    return { ok: false, error: `无法读取技能 "${name}" 的内容：${skill.file}` };
  }
  return {
    ok: true,
    content: `[调用技能 ${skill.name}]\n\n${body}\n\n请按照以上技能指令处理我的请求。`,
  };
}
