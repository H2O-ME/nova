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
  { name: '/model', usage: '/model', description: '打开模型选择面板（从站点目录切换模型）' },
  { name: '/approvals', usage: '/approvals', description: '循环切换审批档位（只读 → 自动编辑 → 全部放行）' },
  { name: '/mode', usage: '/mode', description: '查看三种执行模式的区别与当前模式（新会话按 Tab 切换）' },
  { name: '/plugins', usage: '/plugins', description: '列出插件、工具与权限级别' },
  { name: '/skill', usage: '/skill <name>', description: '加载指定技能的完整指令并立即执行' },
  { name: '/session', usage: '/session', description: '查看会话统计，选择并切换历史会话' },
  { name: '/new', usage: '/new', description: '开启新会话' },
  { name: '/compact', usage: '/compact', description: '原位压缩当前会话（总结上下文，日志保留完整历史）' },
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
  // specs are stored with the leading '/' already; a `${spec.name}`-without-
  // slash match can never hit and only muddied the lookup.
  return COMMAND_SPECS.find((spec) => spec.name === base);
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
