/** 斜杠命令目录：TUI 命令面板、/help 与 readline 模式共用。 */

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
  { name: '/model', usage: '/model [序号|名称]', description: '列出站点模型或切换模型' },
  { name: '/approvals', usage: '/approvals', description: '循环切换审批档位（只读 → 自动编辑 → 全部放行）' },
  { name: '/plugins', usage: '/plugins', description: '列出插件、工具与权限级别' },
  { name: '/mcp', usage: '/mcp', description: '查看 MCP 服务器与工具加载状态' },
  { name: '/skill', usage: '/skill <name>', description: '加载指定技能的完整指令并立即执行' },
  { name: '/session', usage: '/session', description: '查看会话信息与 token 统计' },
  { name: '/new', usage: '/new', description: '开启新会话' },
  { name: '/compact', usage: '/compact', description: '总结当前会话并开启新会话（重置上下文）' },
  { name: '/clear', usage: '/clear', description: '清空当前显示（会话记录保留在磁盘）' },
  { name: '/exit', usage: '/exit', description: '退出 nova（别名 /quit）' },
];

/** 命令面板过滤：仅当输入是“裸命令”（无空格）时匹配。 */
export function filterCommands(input: string): CommandSpec[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || trimmed.includes(' ')) return [];
  return COMMAND_SPECS.filter((spec) => spec.name.startsWith(trimmed));
}

export function findCommand(input: string): CommandSpec | undefined {
  const base = input.trim().split(/\s+/)[0] ?? '';
  return COMMAND_SPECS.find((spec) => spec.name === base || `/${spec.name}` === base);
}

/**
 * /model 的模型列表缓存：站点目录短时间内不会变，60s 内复用上次结果，
 * 避免连续 `/model 2` 之类操作反复打 /models 接口。
 */
export function createModelListCache(fetchList: () => Promise<string[]>, ttlMs = 60_000): () => Promise<string[]> {
  let cache: { at: number; models: string[] } | undefined;
  return async (): Promise<string[]> => {
    if (cache !== undefined && Date.now() - cache.at < ttlMs) return cache.models;
    const models = await fetchList();
    cache = { at: Date.now(), models };
    return models;
  };
}

/**
 * 解析 /model 的参数：纯数字按（1 基）列表序号取模型名，其余按名称原样返回。
 * 序号越界抛错，由调用方决定如何展示。
 */
export async function resolveModelArg(arg: string, fetchList: () => Promise<string[]>): Promise<string> {
  if (!/^\d+$/.test(arg)) return arg;
  const models = await fetchList();
  const picked = models[Number.parseInt(arg, 10) - 1];
  if (picked === undefined) {
    throw new Error(`序号 ${arg} 超出范围（模型列表共 ${models.length} 个）`);
  }
  return picked;
}
