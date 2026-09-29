/**
 * Plugin TIERS and Chinese labels — the single table behind "can this row be
 * switched off?" and "what does the manager call it?".
 *
 * Two questions live here because they are answered from the same key (the
 * plugin's roster name) and a reader who changes one always has to check the
 * other:
 *
 *  - **tier** decides the DEFAULT and the CEILING. `core` is load-bearing (the
 *    registries and the services every tool call reads through) and is never
 *    switchable; `standard` ships on and may be turned off; `advanced` is OFF
 *    until the operator asks for it, which is what "按需开启" means for
 *    `subagent` / `ptc` / `qqbot`.
 *  - **labels** are the reader's words. The plugin's own `name` is an
 *    identifier (`fs-read`), never something to print, and its `description` on
 *    the plugin object is the MODEL-facing one (English, sent to the provider
 *    in tool schemas). A management page is read by a person, so its words
 *    belong in one Chinese table rather than being scraped off the plugins.
 *
 * An unknown name falls back to `standard`, i.e. "may be turned off, ships on".
 * That is the deliberate fail-open side: a third-party plugin must stay
 * switchable (the whole point of a plugin manager), and grouping it with the
 * load-bearing core would make it impossible to turn off — the exact defect
 * this module exists to fix.
 *
 * The `jobs` name collision: the background-jobs CAPABILITY provider and the
 * `jobs` TOOL plugin were both called `jobs`, so "core services are
 * load-bearing" locked the tool's switch too and clicking it threw. The
 * provider was renamed `jobs-service`; only that fiber name changed — the
 * service KEY is still `jobs`, and the tool keeps the name `/plugins` prints.
 */

export type PluginTier = 'core' | 'standard' | 'advanced';

/**
 * The load-bearing names: registries and capability providers plus the tools
 * that ARE the agent's basic reach (read / write / search / ask). Dropping one
 * takes the tool surface — or the panel's own ability to re-roster — down, so
 * the switch refuses.
 */
export const CORE_PLUGINS: readonly string[] = [
  // Registries + capability providers (one fiber each).
  'toolbox',
  'llm',
  'approval',
  'approval-gate',
  'jobs-service',
  'spill',
  'compaction',
  'sessions',
  'skills',
  'commands',
  // The surface registry and the answerer seam. Both are capability providers
  // (like `llm` / `approval`), so a switch that dropped one would take the
  // resolver — or the ask tool's ability to learn there is nobody to ask — down
  // with it. `surfaces` is a provider NAME; a surface's own fiber is named after
  // the surface (`tui`), so the two never collide.
  'surfaces',
  'user-questions',
  // The agent's basic tools: without them a run cannot read, write or search.
  'fs-read',
  'fs-write',
  'search',
  'ask-user',
];

/**
 * OFF until asked for. `subagent` and `ptc` add whole execution modes (`ptc`
 * also changes what the model is offered every turn), and `qqbot` opens an
 * external channel — none of them is something a new install should be paying
 * for by default.
 */
export const ADVANCED_PLUGINS: readonly string[] = ['subagent', 'ptc', 'qqbot'];

/**
 * The Chinese display name and one-line description of every name this build
 * can print. A name missing here falls back to the plugin's own `name` (never
 * an invented label) — see `labelFor`.
 */
export const PLUGIN_LABELS: Record<string, { title: string; description: string }> = {
  // ── core ──────────────────────────────────────────────────────────────────
  toolbox: { title: '工具注册表', description: '工具与命令注册表，所有插件注册的落点。' },
  llm: { title: '模型服务', description: '模型端点与缓存亲和绑定。' },
  approval: { title: '审批服务', description: '审批档位与「总是允许」授权的唯一持有者。' },
  'approval-gate': { title: '审批门', description: '在工具调用前按权限档位裁决放行或拒绝。' },
  'jobs-service': { title: '后台任务服务', description: '后台任务注册表，供 bash 与 jobs 工具共享。' },
  spill: { title: '输出落盘', description: '超大工具结果溢出到会话缓存目录。' },
  compaction: { title: '上下文压缩', description: '超限时总结历史，原始日志不改写。' },
  sessions: { title: '会话生命周期', description: '维护当前会话与缓存亲和的重绑定。' },
  skills: { title: '技能索引', description: '按需加载项目级与用户级技能的正文。' },
  commands: { title: '命令目录', description: '内核可自执行的斜杠命令目录。' },
  surfaces: { title: '界面注册表', description: '人类端界面的注册表，决定这次调用由哪个界面服务。' },
  'user-questions': { title: '提问能力', description: '向模型开放提问能力的接线：没有人的界面就不提供。' },
  'fs-read': { title: '读取文件', description: '读取工作区内的文件内容。' },
  'fs-write': { title: '写入文件', description: '创建、覆盖与编辑工作区内的文件。' },
  search: { title: '搜索文件', description: '按名称或正则递归搜索工作区。' },
  'ask-user': { title: '询问用户', description: '向用户提问并等待回答。' },
  // ── standard ──────────────────────────────────────────────────────────────
  bash: { title: '执行命令', description: '在工作区根目录运行 shell 命令。' },
  jobs: { title: '后台任务', description: '查看与停止 bash 启动的后台任务。' },
  todo: { title: '任务清单', description: '维护当前会话的待办清单。' },
  goal: { title: '目标模式', description: '维护跨轮持续的目标，并在预算内自动继续推进。' },
  workspace: { title: '切换工作区', description: '切换工具生效的工作区根目录。' },
  // ── advanced ──────────────────────────────────────────────────────────────
  subagent: { title: '子代理', description: '为自包含的子任务启动隔离的子代理。' },
  ptc: { title: '代码模式', description: '运行 run_code 程序，按需调用工具。' },
  qqbot: { title: 'QQ 机器人', description: 'QQ 渠道插件：向群与单聊发送消息。' },
};

/** One plugin's tier. Unknown names are `standard` (see the module doc). */
export function pluginTier(name: string): PluginTier {
  if (CORE_PLUGINS.includes(name)) return 'core';
  if (ADVANCED_PLUGINS.includes(name)) return 'advanced';
  return 'standard';
}

/** Core rows are load-bearing: the manager shows no switch and the switch refuses. */
export function isCorePlugin(name: string): boolean {
  return pluginTier(name) === 'core';
}

/**
 * The display pair for one name. A name with no entry keeps its own `name` as
 * the title and an empty description — inventing a Chinese label for a
 * third-party plugin would be a lie about what it does.
 * @param name - the plugin's roster name.
 * @returns the row's title and description, both ready to render.
 */
export function labelFor(name: string): { title: string; description: string } {
  const known = PLUGIN_LABELS[name];
  return known ?? { title: name, description: '' };
}

/**
 * The ONE rule that decides whether a known plugin loads: in `disable` → OFF
 * (disable wins over `enable` — an operator who turned something off means it,
 * and a config hint that implies otherwise must not silently re-enable it);
 * else in `enable` → ON (how an `advanced` plugin is asked for); else the tier
 * default — `core` / `standard` on, `advanced` off.
 * @param name - the plugin's roster name.
 * @param lists - the two operator lists in force (config merged with live state).
 * @returns whether the plugin should be in the roster.
 */
export function enabledByTier(
  name: string,
  lists: { enable?: readonly string[] | undefined; disable?: readonly string[] | undefined },
): boolean {
  if (lists.disable?.includes(name) === true) return false;
  if (lists.enable?.includes(name) === true) return true;
  return pluginTier(name) !== 'advanced';
}

/**
 * A DERIVED opt-in yields to the operator's off-switch. Two plugins have a
 * second door no `enable` write can close: a non-`native` `tools.code.mode`
 * implies `ptc`, and a `qqbot` config block implies `qqbot`. Both are
 * projections (nothing is written back), and one that outvotes `disable` makes
 * the row's switch a lie: the row reads OFF, the next roster puts it back. So the derivation is filtered through `disable`: the same
 * order `enabledByTier` applies, for the same reason (the off-switch is the
 * safety side). Callers: `cli/kernel-config.ts` (boot) and `runtime-roster.ts`'s
 * `codeModeOptIn` (live) — one rule, so the two cannot disagree.
 * @param names - the opt-ins the config implies.
 * @param disable - `plugins.disable` in force, config merged with live state.
 * @returns the implied names the off-switch leaves standing.
 */
export function impliedOptIns(names: readonly string[], disable?: readonly string[] | undefined): string[] {
  if (disable === undefined || disable.length === 0) return [...names];
  const off = new Set(disable);
  return names.filter((name) => !off.has(name));
}
