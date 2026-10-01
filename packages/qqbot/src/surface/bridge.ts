/**
 * 本进程里的一台 QQ 通道，以及「保存凭据之后真的跑起来」这条路径的通道侧。
 *
 * 从 cli 迁入本包（2026-10-01）：桥是 qqbot 的产品形态——通道用**空凭据**构造也
 * 安全（它只是一份工具注册 + 一个网关值），真正拨号的是 `start()` → `connect()`。
 * 凭据的**读取**由宿主注入（`QqBotCredentialPort`，读 raw 文档），因为
 * 「`{env:NAME}` 能不能兑现」是配置层的规则，不是这个包的规则。
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
 *  - **凭据不可用就不启动，且不抛**：`credentialsProblem` 是「存的东西能不能用」的唯一
 *    定义处（宿主读 raw 文档，看得见 `{env:NAME}` 引用）。把原因当**返回值**交给设置页，
 *    而不是让一个插件没配好就把整个 WebUI 挡住。
 *
 * 启动时与保存后走**同一个** `start()`：只有一条「让它跑起来」的路径，两条入口不会各自
 * 漂移。
 */
import { errMessage } from '@nova-agent/core';
import type { SocketFactory } from '../protocol.js';
import { createQqBotChannel, type QqBotChannel, type QqBotChannelReading } from '../runtime.js';
import type { FetchLike } from '../token.js';
import { qqBotRuntimeSeam, type QqBotEnablePort, type QqBotRuntimeSeam } from './activate.js';
import type { QqBotKernelPort } from './peer.js';
import { parseRemoteCommand } from './remote-parse.js';
import { emptyCredentials, wireTurns } from './wiring.js';

/**
 * 凭据的两个读法（宿主注入；包不读 `~/.nova/config.json`）。
 *
 * 与 `QqBotSurfaceDeps` 的前两个成员同义——`startQqBotBridge` 与
 * `createQqBotSurface` 接受**同一份**凭据端口，两条路径对「凭据可不可用」的判定
 * 不可能分叉。
 */
export interface QqBotCredentialPort {
  credentialsProblem(): Promise<string | undefined>;
  readCredentials(): Promise<{ appId: string; clientSecret: string } | undefined>;
}

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
  /** 设置页的活通道缝（见 `activate.ts`）：running / afterSave / connection / stop。 */
  runtime(kernel: () => QqBotEnablePort | undefined): QqBotRuntimeSeam;
}

/**
 * 装配本进程的 QQ 通道。**总是**返回一个可启动的桥，无论此刻能不能连。
 * @param credentials - 凭据的两个读法（宿主注入；见 `QqBotCredentialPort`）。
 * @param kernel - 装配好的内核，惰性解析（对端只在真有人发消息后才出现）。
 * @param transport - 传输层注入（测试）；缺省即真实网络。
 * @returns 要注册的插件与它的桥。
 */
export async function startQqBotBridge(
  credentials: QqBotCredentialPort,
  kernel: () => QqBotKernelPort | undefined,
  transport: QqBotTransport = {},
): Promise<QqBotBridge> {
  // 可变的凭据持有者与迟绑定的通道引用（见 `wiring.ts`）：取值函数必须同步
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
    // 就会永远排在自己所等的那一轮后面（死锁）。`claim` 用同一个纯解析器判定。
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
  // 「能不能用」先于「是什么」：`credentialsProblem` 看得见未兑现的 `{env:NAME}`，
  // 而直接去读会把它当成字面量送去换 token、再报一个看不懂的鉴权失败。
  const attempt = async (): Promise<string | undefined> => {
    const problem = await credentials.credentialsProblem();
    if (problem !== undefined) return problem;
    // 重读并把新凭据写进持有者，再启动。顺序不可颠倒：先启动就会用上一对凭据拨号。
    const creds = await credentials.readCredentials();
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
  const bridge: QqBotBridge = {
    plugin: built.plugin,
    start: async () => {
      connecting = true;
      failure = await attempt().finally(() => { connecting = false; });
      return failure;
    },
    reading: async () => ({ ...(await built.reading()), connecting, ...(failure !== undefined ? { failure } : {}) }),
    running: () => built.running,
    stop: () => built.stop(),
    runtime: (getKernel) => qqBotRuntimeSeam(bridge, getKernel),
  };
  return bridge;
}
