/** 斜杠命令目录（壳自有命令）：/help 与 surface 命令端口共用。 */

import type { PtcMode } from '@nova-agent/core';
import { CODE_MODE_HINT, codeModeLabel, padDisplay } from './lines.js';

export interface CommandSpec {
  /** 命令名（含开头的 /），例如 '/model'。 */
  name: string;
  /** 面板中显示的用法提示，例如 '[name]'。 */
  usage: string;
  description: string;
}

export const COMMAND_SPECS: CommandSpec[] = [
  { name: '/help', usage: '/help', description: '显示可用命令' },
  { name: '/init', usage: '/init', description: '扫描工作区并生成 AGENTS.md' },
  { name: '/model', usage: '/model [name]', description: '打开模型选择面板（从站点目录切换模型）；带参数时直接切换/回退到指定模型' },
  { name: '/approvals', usage: '/approvals', description: '循环切换审批档位（只读 → 自动编辑 → 全部放行）' },
  { name: '/mode', usage: '/mode', description: '查看三种执行模式的区别与当前模式（新会话按 Tab 切换）' },
  { name: '/theme', usage: '/theme [name]', description: '查看或切换界面主题：dark（默认）/ light（亮背景）/ plain（无色）' },
  { name: '/plugins', usage: '/plugins', description: '列出插件、工具与权限级别' },
  { name: '/skill', usage: '/skill <name>', description: '加载指定技能的完整指令并立即执行' },
  { name: '/session', usage: '/session', description: '查看会话统计，选择并切换历史会话' },
  { name: '/new', usage: '/new', description: '开启新会话' },
  { name: '/clear', usage: '/clear', description: '清空当前显示（会话记录保留在磁盘）' },
  { name: '/exit', usage: '/exit', description: '退出 nova（别名 /quit）' },
];

/**
 * 壳清单与 kernel 活目录的合并视图：/help 与 surface 命令端口共用这一份，
 * 注册命令（/goal 与第三方 /registerCommand）自动出现在每个壳的目录里。
 * 同名以壳为准（壳命令需要界面才能完成，归壳所有）。
 */
export function mergedCommandSpecs(registry: readonly { readonly name: string; readonly description: string }[]): CommandSpec[] {
  return [
    ...COMMAND_SPECS,
    ...registry
      .filter((command) => !COMMAND_SPECS.some((spec) => spec.name === `/${command.name}`))
      .map((command) => ({ name: `/${command.name}`, usage: `/${command.name}`, description: command.description })),
  ];
}

/** /mode 的单行：current 标记决定调用方如何上色。 */
export interface ModeOverviewRow {
  current: boolean;
  text: string;
}

/** /mode 的三态行（无色）：❯ 标当前模式，后跟一行语义提示。 */
export function modeOverviewRows(current: PtcMode): ModeOverviewRow[] {
  return (['native', 'ptc', 'both'] as PtcMode[]).map((m) => ({
    current: m === current,
    text: `${m === current ? '❯' : ' '} ${padDisplay(codeModeLabel(m), 6)} ${CODE_MODE_HINT[m]}`,
  }));
}

/**
 * /model 的模型列表缓存：站点目录短时间内不会变，60s 内复用上次结果，
 * 避免连续打开选择面板时反复打 /models 接口。失败同样负缓存 60s：站点
 * 故障时连续打开面板不应每次都等一个完整的请求超时。
 */
export function createModelListCache(fetchList: () => Promise<string[]>, ttlMs = 60_000): () => Promise<string[]> {
  let cache: { at: number; models: string[] } | undefined;
  return async (): Promise<string[]> => {
    if (cache !== undefined && Date.now() - cache.at < ttlMs) return cache.models;
    try {
      const models = await fetchList();
      cache = { at: Date.now(), models };
      return models;
    } catch (err) {
      cache = { at: Date.now(), models: [] };
      throw err;
    }
  };
}
