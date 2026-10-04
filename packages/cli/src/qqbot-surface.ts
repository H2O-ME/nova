/**
 * `nova qqbot` 的**认领行**：argv 的形状留在这里（必须同步可答），产品形态全在
 * `@nova-agent/qqbot` 包里。
 *
 * 通道不再由宿主拨号：它随那一行插件一起启停（行开才有 socket，行关即收走），
 * 所以这个文件只剩四件事——认领 `qqbot` 这个子命令、把包里的 `qqbotSurface` 接上
 * 唯一那段装配、两条**宿主才知道**的装配贡献（对端会话桶与按请求自动压缩），以及
 * 在常驻之前**按 roster 说清通道为什么没起来**。
 *
 * 最后那件是本文件唯一一次点名一个插件 id，也是本仓唯一被允许点名 qqbot 的地方
 * （`AGENTS.md` §4：认领判据必须同步可答，所以认领行住在 cli）。判定逻辑本身是通用的
 * ——`plugin-report.ts` 按**行 id**读 roster 的 `error` / `state` / `enabled`，这里只把
 * 「缺席 / 加载失败 / 关着 / 活着但没通道」翻成四句各带下一步动作的中文。把这些成因
 * 合并成一句「请打开这一行」正是要被修掉的那个缺陷：已经照做过的操作者被叫去再做一遍，
 * 而真实成因是模块加载失败。
 *
 * 包仍是**动态边**：`@nova-agent/qqbot` 缺席时 cli 必须照常编译、照常起别的形态，
 * 所以引用只有这一处 `await import()`，装载失败换一句点名「扩展不可用」的中文错误。
 * 装载挂在 `boot.kernel` 而不是 `start`：启动前置跑在装配**之前**，缺包因此落在
 * 一个**早于任何会话日志**的启动错误上。
 *
 * 而「行关着 / 行加载失败」这两种成因**只能**在装配后才问得出来（它要 roster），
 * 所以它们留在 `start` 里拒绝——代价由宿主兜住：`surface-host.ts` 的 `runSurface`
 * 在 `start` 抛错时拆掉内核，并在「这次新建的会话还空着」时把那条日志删掉
 * （`discardRefusedBoot`）。于是拒绝照样不留垃圾会话。
 */
import path from 'node:path';
import { errMessage, sessionsRoot, type AgentSurface } from '@nova-agent/core';
import { pluginRowState, type PluginRowState } from './plugin-report.js';
import type { BuiltinSurface } from './surface-host.js';

/** 这一行的 id，也是动态导入用的模块 spec（一个身份，一处定义）。 */
const QQ_BOT_ROW_ID = '@nova-agent/qqbot';

/** 包交给宿主的两个读数：surface 本身，以及「通道在不在」。 */
interface QqBotModule {
  readonly surface: AgentSurface;
  /** 本进程此刻在跑的通道；行关着或凭据没填都是 undefined。 */
  channel(): unknown;
}

/**
 * `nova qqbot` 的 surface 行。
 *
 * claim 同步可答（判据是 argv 形状本身），包的装载迟到 `boot.kernel`：注册表构建
 * 时只需要 claim，而这条命令缺包时必须报「扩展不可用」，不能被 web / repl 悄悄接走。
 * @returns the built-in row the shell registers.
 */
export function qqbotBuiltinSurface(): BuiltinSurface {
  let loaded: QqBotModule | undefined;

  /** 包（迟装载 + 记忆化；包缺席即一句可读的启动错误）。 */
  async function qqbotModuleOf(): Promise<QqBotModule> {
    if (loaded !== undefined) return loaded;
    let module: Record<string, unknown>;
    try {
      module = (await import(QQ_BOT_ROW_ID)) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`QQ 机器人扩展不可用（无法加载 ${QQ_BOT_ROW_ID}）：${errMessage(err)}`);
    }
    const surface = module['qqbotSurface'];
    if (!isAgentSurface(surface)) {
      throw new Error(`${QQ_BOT_ROW_ID} 没有导出 surface（qqbotSurface）：这个包与本版 cli 不匹配`);
    }
    loaded = { surface, channel: channelReader(module) };
    return loaded;
  }

  return {
    surface: {
      name: 'qqbot',
      claim: (request) => request.flags.positional[0] === 'qqbot',
      start: async (runtime) => {
        // 先问 roster，再问包：行层面的成因（没有 / 关着 / 加载失败）与「通道在不在」
        // 无关，而包自己的 `start` 只会说一句「通道未启动」——那正是要换掉的提示。
        // 这三句拒绝发生在装配之后（roster 只有装配完才有），所以宿主在 `start` 抛错时
        // 负责收拾：`runSurface` 会拆内核并删掉这次留下的空会话日志（见文件头）。
        const refusal = refusalFor(pluginRowState(runtime.kernel.roster(), QQ_BOT_ROW_ID));
        if (refusal !== undefined) throw new Error(refusal);
        const qqbot = await qqbotModuleOf();
        // 行活着却仍没有通道，只剩一个通用成因：它自己的凭据没填（包在读不通的凭据上
        // 不建通道，见 qqbot/src/plugin.ts）。这是**读**，不是启动通道：谁拨号永远只有
        // fiber 一个答案。
        if (qqbot.channel() === undefined) throw new Error(credentialRefusal());
        await qqbot.surface.start(runtime);
      },
    },
    boot: {
      kernel: async () => {
        // 先装载：缺包要在这里失败，早于任何会话日志被创建。
        await qqbotModuleOf();
        return {
          // 对端会话与交互会话隔离，归档到 sessionsRoot()/qqbot——包内的对端轮次
          // 用同一个桶（它自己算的也是这一条路径）。
          sessionDir: path.join(sessionsRoot(), 'qqbot'),
          // 这一档一次跑完整个任务，自动压缩按请求门控（与 exec 同一条理由）。
          perRequestCompact: true,
        };
      },
    },
  };
}

/**
 * 四句拒绝，四种成因，四个下一步动作。
 *
 * 只有真的没有这一行、真的关着，才谈「去打开这一行」；加载失败的那一支**必须**贴出
 * 该行的 `error` 并让人去修加载，因为「打开一行已经开着的行」不是一个动作。
 * @param state - the row's state, read from the live roster by row id.
 * @returns the refusal to show, or undefined when the row itself is loaded.
 */
function refusalFor(state: PluginRowState): string | undefined {
  switch (state.kind) {
    case 'active':
      return undefined;
    case 'absent':
      return `QQ 机器人通道未启动：配置文件的 plugins.entries 里没有「${QQ_BOT_ROW_ID}」这一行，`
        + '这个包不会因此被加载。请在插件管理里加上这一行'
        + '（id 与包名同为 @nova-agent/qqbot，enabled: true），并在它的 config 里填写 appId 与 clientSecret。';
    case 'off':
      return `QQ 机器人通道未启动：「${QQ_BOT_ROW_ID}」这一行在 plugins.entries 里，但它是关着的`
        + '（enabled: false）——关着的行不建 socket。请在插件管理里打开这一行。';
    case 'failed':
      return `QQ 机器人通道未启动：「${QQ_BOT_ROW_ID}」这一行开着，但它没能加载——${state.error}。`
        + '这一行不是「没开」：请按上面的原因修好它的加载（模块装不上就重装或改这一行的 id，'
        + 'config 校验失败就按点到的键改配置），通道才会起来。';
  }
}

/** 行活着、模块也加载了，通道却不在：只剩下「凭据没填」这一个通用成因。 */
function credentialRefusal(): string {
  return `QQ 机器人通道未启动：「${QQ_BOT_ROW_ID}」这一行已打开且加载成功，但通道没有起来`
    + '——它的 config 里 appId / clientSecret 还没填，或引用的 {env:NAME} 没有设置。'
    + '请在它的插件设置页里填好凭据并用「测试连接」验证：凭据被网关拒绝时，答复也在那一页上。';
}

/**
 * 包自己的通道读数（`runningQqBotChannel`）。
 *
 * 缺这个导出＝这个包与本版 cli 不匹配，与缺 `qqbotSurface` 是同一类事实，所以在这里
 * 点名拒绝，而不是把「问不到」悄悄当成「没有通道」——那会把一句不匹配说成「凭据没填」。
 * @param module - the loaded package namespace.
 * @returns a reader for the process's live channel.
 */
function channelReader(module: Record<string, unknown>): () => unknown {
  const read = module['runningQqBotChannel'];
  if (typeof read !== 'function') {
    throw new Error(`${QQ_BOT_ROW_ID} 没有导出 runningQqBotChannel：这个包与本版 cli 不匹配`);
  }
  return () => (read as () => unknown)();
}

/** 包导出的东西必须是 surface 契约面（`{ name, claim, start }` 三件齐备）。 */
function isAgentSurface(value: unknown): value is AgentSurface {
  if (typeof value !== 'object' || value === null) return false;
  const shape = value as { name?: unknown; claim?: unknown; start?: unknown };
  return typeof shape.name === 'string' && typeof shape.claim === 'function' && typeof shape.start === 'function';
}
