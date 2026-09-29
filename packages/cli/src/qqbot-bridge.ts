/**
 * `nova --web` 里的 QQ 机器人接入。
 *
 * 这是**同一个进程**里的第二条入站通道：WebUI 是人按的，QQ 是别人发的，两者共用同一个
 * 内核、同一份会话归档、同一套审批引擎。此前 `qqbot` 只在 `nova qqbot` 一个形态下真的
 * 启动，于是设置页把凭据填好、插件开关也打开之后 **什么都不会发生**——凭据存着，通道
 * 没跑。用户报的「即使输入设置好连接参数也不会实际运行」就是这条。
 *
 * 三条纪律：
 *  - **桥永远存在，启动是独立一步**。它在 `advanced` 层（默认关），只有操作者主动打开时
 *    才加载；而「第一次运行时还没有凭据」恰恰是最需要他能在设置页填完就把通道起起来的
 *    场景。所以这里从不返回「没有启动路径」——启动失败只体现为 `start()` 的返回值，
 *    插件照旧交出去。A2 那个「存了却什么都没发生」的 bug，就是启动路径绑在启动时的
 *    配置快照上长出来的。
 *  - **凭据迟读**：通道对象必须**保持稳定**（它已经在 roster 的候选清单里，重建等于换掉
 *    roster 身份），而凭据是设置页在进程运行中改写的文件内容。所以通道拿到的是**取值
 *    函数**，指向这里一个可变持有者；每次 `start()` 先重读文件再写进去，换过凭据时
 *    `AccessTokenManager` 按指纹自己丢弃旧 token。这是「保存后不用重启」的另一半。
 *  - **凭据不可用就不启动，且不抛**：`qqBotConfigProblem()` 是「存的东西能不能用」的唯一
 *    定义处（它读 raw 文档，看得见 `{env:NAME}` 引用）。把原因当**返回值**交给设置页，
 *    而不是让一个插件没配好就把整个 WebUI 挡住。
 *
 * 启动时与保存后走**同一个** `start()`：只有一条「让它跑起来」的路径，两条入口不会各自
 * 漂移。
 */
import { errMessage } from '@nova-agent/core';
import {
  createQqBotChannel,
  type FetchLike,
  type QqBotChannel,
  type QqBotChannelReading,
  type SocketFactory,
} from '@nova-agent/qqbot';
import { qqBotConfigProblem } from './config-read.js';
import { readQqBotCredentials } from './qqbot-credentials.js';
import { parseRemoteCommand } from './qqbot-remote-parse.js';
import { emptyCredentials, wireTurns } from './qqbot-wiring.js';
import type { QqBotKernelPort } from './qqbot-peer.js';

export type { QqBotKernelPort } from './qqbot-peer.js';

/** 传输层注入点（测试用假 fetch / 假 socket；生产走真实网络）。 */
export interface QqBotTransport {
  fetchFn?: FetchLike;
  socketFactory?: SocketFactory;
  gatewayUrl?: () => Promise<string>;
}

/** 一台跑在本进程里的 QQ 通道，加两个设置页需要的事实。 */
export interface QqBotBridge {
  /** 装进内核装配的插件（由通道自己提供）。 */
  readonly plugin: QqBotChannel['plugin'];
  /**
   * 重读凭据后启动网关；已在运行则是 no-op。
   *
   * 这是**保存之后**的入口，也是启动时的入口：设置页在进程运行中改写文件，随后问到
   * 这里。重读是全部意义所在——启动时交给通道的那对凭据，是一份此后已被改掉的文件快照。
   * @returns 成功（或本来就在跑）时 undefined，否则是为什么不启动。
   */
  start(): Promise<string | undefined>;
  /** 本进程里网关**此刻**是否在跑。 */
  running(): boolean;
  /** 连接读数：`running()` 只管启没启动，这里说连没连上、BOT 是谁、收发了多少。 */
  reading(): Promise<QqBotChannelReading & { connecting: boolean; failure?: string }>;
  /**
   * 把网关挂断（幂等，未启动时也安全）。关掉插件开关必须**真的**停通道：网关住在
   * 本进程的桥里，不在插件的 effect 里——roster 翻面只卸工具注册，socket 不会自己关。
   */
  stop(): void;
}

/**
 * 装配本进程的 QQ 通道。**总是**返回一个可启动的桥，无论此刻能不能连。
 *
 * 通道用一个空凭据构造也是安全的：它只是一份工具注册 + 一个网关值，真正拨号的是
 * `start()` → `connect()`，而那只有在有东西可拨时才调用。
 * @param kernel - 装配好的内核，惰性解析（对端只在真有人发消息后才出现）。
 * @param transport - 传输层注入（测试）；缺省即真实网络。
 * @returns 要注册的插件与它的桥。
 */
export async function startQqBotBridge(
  kernel: () => QqBotKernelPort | undefined,
  transport: QqBotTransport = {},
): Promise<QqBotBridge> {
  // 可变的凭据持有者与迟绑定的通道引用（见 `qqbot-wiring.ts`）：取值函数必须同步
  // （`AccessTokenManager` 在发请求的同步路径上取凭据），所以读盘的异步与取值的同步
  // 必须在这里分开。
  const live = emptyCredentials();
  const wiring = wireTurns(kernel);
  const turns = wiring.turns;
  const built: QqBotChannel = createQqBotChannel({
    appId: () => live.appId,
    clientSecret: () => live.clientSecret,
    brain: wiring.brain,
    // 遥控指令走队列**之外**的旁路：一轮可能停在审批上等人回答，而答复要排队的话
    // 就会永远排在自己等的那一轮后面（死锁）。`claim` 用同一个纯解析器判定。
    remote: {
      claim: (text) => parseRemoteCommand(text).command !== undefined,
      handle: (text, peer) => turns.run(text, peer),
    },
    // The web surface has no console owner: the transcript is the record, and a
    // plugin writing to stdout would reach nobody.
    log: () => undefined,
    ...transport,
  });
  wiring.attachChannel(built);
  // 「能不能用」先于「是什么」：`qqBotConfigProblem` 看得见未兑现的 `{env:NAME}`，
  // 而直接去读会把它当成字面量送去换 token、再报一个看不懂的鉴权失败。
  const attempt = async (): Promise<string | undefined> => {
    const problem = await qqBotConfigProblem();
    if (problem !== undefined) return problem;
    // 重读并把新凭据写进持有者，再启动。顺序不可颠倒：先启动就会用上一对凭据拨号。
    const creds = await readQqBotCredentials();
    if (creds === undefined) {
      return 'QQ 机器人未配置：在设置 → QQ 机器人里填写 AppID 与密钥后启用该插件。';
    }
    live.appId = creds.appId;
    live.clientSecret = creds.clientSecret;
    try {
      await built.start();
    } catch (err) {
      // 连不上是**答复**（设置页要显示它），不是崩溃：磁盘上的凭据大概率不对。
      return `QQ 机器人连接失败：${errMessage(err)}`;
    }
    return undefined;
  };
  /** 上一次启动为什么没成功、此刻是否正在拨号。记在桥里而不是让调用方存：`start()`
   * 有两个入口（启动时、保存后），只记一个入口就会漏掉另一个入口的失败——而「看不出
   * 连没连上」正是要修的那件事。 */
  let failure: string | undefined;
  let connecting = false;
  return {
    plugin: built.plugin,
    start: async () => {
      connecting = true;
      failure = await attempt().finally(() => { connecting = false; });
      return failure;
    },
    reading: async () => ({ ...(await built.reading()), connecting, ...(failure !== undefined ? { failure } : {}) }),
    running: () => built.running,
    stop: () => built.stop(),
  };
}
