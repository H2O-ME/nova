/**
 * 插件行的失败汇报：把 roster 上「这一行没起来」的事实翻成给人看的一行。
 *
 * 一处读取、两处交付：启动时的横幅（`repl` / `exec`）与 `nova qqbot` 的拒绝都问这里，
 * 于是「这一行到底怎么了」全仓只有一个答案。判据**全部**来自 roster 自己的
 * `error` / `state` / `enabled` 字段——宿主不认识任何插件名，所以这里不出现任何插件
 * id；需要问哪一行，由调用方带上它自己关心的那个 id（`pluginRowState`）。
 *
 * 失败行**绝不阻断启动**：这里只产出文字，没有任何一条路径因此抛出或退出。一个坏插件
 * 不能挡住启动、不能挡住别的行、不能把进程带走，操作者看到的是那一行带原因（AGENTS.md
 * §5「插件出错是数据，不是崩溃」）。
 */
import type { AgentSurfacePluginRow } from '@nova-agent/core';
import { oneLineText } from './lines.js';

/**
 * 这一行为什么算失败，或 undefined＝不算失败。
 *
 * 「失败」的唯一定义在此：`error` 非空，或容器已经把它标成 `failed`（一条激活失败的
 * 行没有 fiber，`describePlugins` 会给出 `state: 'failed'` 而 `enabled: false`——那**不是**
 * 「关着」，把它读成关着正是一次误导性提示的成因）。
 * @param row - one roster row.
 * @returns the reason to show, or undefined for a healthy (loaded or switched-off) row.
 */
export function rowFailureReason(row: AgentSurfacePluginRow): string | undefined {
  if (row.error !== undefined && row.error.length > 0) return row.error;
  if (row.state === 'failed') return '插件没有激活（容器状态 failed，未提供原因）';
  return undefined;
}

/**
 * 启动时的失败行报告：**一行一个**，点名行 id 与失败原因。
 *
 * 刻意不做「只报第一个」也不做「合并成一句」：一个坏掉的插件行是一条独立的事实，合并
 * 会让人以为只坏了一处。列表为空＝每一行都健康，调用方什么都不打印。
 *
 * 行 id 与原因都经 `oneLineText`：它们来自插件界面的数据（模块名、错误信息），一个带
 * `\r` / ANSI 的原因不该能把终端上已经打印的字覆盖掉。
 * @param rows - the live roster (`AgentSurfaceKernel.roster()`).
 * @returns one line per failed row, in roster order.
 */
export function failedPluginLines(rows: readonly AgentSurfacePluginRow[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const reason = rowFailureReason(row);
    if (reason !== undefined) lines.push(`插件行「${oneLineText(row.name)}」加载失败：${oneLineText(reason)}`);
  }
  return lines;
}

/**
 * 一行此刻的装载状态，按**行 id**查。
 *
 * 与容器自己的 `roster()` 分开读：容器按插件自己的 `name` 寻址，而读错误的那个键正是
 * 「一个 active 的插件被读成缺失」的历史缺陷（spec 装载的包，行 id 与插件名不是同一个
 * 字符串）。所以这里的键是操作者配置里写的那个 id——通用实现，没有插件名单。
 */
export type PluginRowState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'off' }
  | { readonly kind: 'active' };

/**
 * 查一行：缺席 / 加载失败 / 关着 / 活着。
 *
 * 顺序即是语义：**加载失败优先于关着**——一条失败的行的确是 `enabled: false`（它没有
 * fiber），先问 `enabled` 就会把「模块加载不了」说成「你去把它打开」，而那正是要被修掉
 * 的那句提示。
 * @param rows - the live roster.
 * @param id - the row id as the operator's `plugins.entries` writes it.
 * @returns the row's state.
 */
export function pluginRowState(rows: readonly AgentSurfacePluginRow[], id: string): PluginRowState {
  const row = rows.find((entry) => entry.name === id);
  if (row === undefined) return { kind: 'absent' };
  const reason = rowFailureReason(row);
  if (reason !== undefined) return { kind: 'failed', error: reason };
  if (row.enabled === false) return { kind: 'off' };
  return { kind: 'active' };
}
