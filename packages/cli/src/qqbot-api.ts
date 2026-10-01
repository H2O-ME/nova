/**
 * qqbot 包的公开面，按 **cli 侧的结构性镜像** 声明在这里——绝不从包里 import。
 *
 * qqbot 是一档扩展能力（advanced）：cli 必须在 qqbot 包缺席时也能编译、也能起。
 * 任何静态 import（连 `import type` 也算）都会把编译绑在包的存在上，所以在 cli
 * 源码里对包的引用只剩一处动态加载（`loadQqBot`，surface 适配、web 桥、探针都经它）。
 *
 * 形状与 `packages/qqbot/src/surface/{mode,bridge,activate,probe}.ts` 对齐，
 * 由真包在场的集成测试钉住（`cli/test/qqbot-activate.test.ts` 走真桥 + 假传输）；
 * 改包时同步这里。
 */
import { errMessage, type AgentSession, type AgentSurface, type Plugin } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';

/** 凭据的两个读法（surface 与桥共用同一份；宿主注入，包不读 `~/.nova/config.json`）。 */
export interface QqBotCredentialPortLike {
  /** 「存的东西能不能用」的一句话；undefined = 可用。 */
  credentialsProblem(): Promise<string | undefined>;
  /** 当下可用的凭据（读 raw 文档并展开引用）；未配置 = undefined。 */
  readCredentials(): Promise<{ appId: string; clientSecret: string } | undefined>;
}

/** `createQqBotSurface` 的注入面：凭据两个读法 + 一行 `[qqbot]` 怎么上色。 */
export interface QqBotSurfaceDepsLike extends QqBotCredentialPortLike {
  log(line: string): void;
}

/** 装配前置交给内核的东西（`SurfaceKernelContribution` 的子集）。 */
export interface QqBotSurfaceContributionLike {
  extraPlugins: readonly Plugin[];
  sessionDir: string;
  perRequestCompact: boolean;
}

/** `createQqBotSurface` 的返回：surface 契约面 + 装配前置 + 装配后的内核回填。 */
export interface QqBotSurfacePartsLike {
  surface: AgentSurface;
  prepare(): Promise<QqBotSurfaceContributionLike>;
  attach(kernel: Kernel): void;
}

/**
 * 内核里 QQ 对端需要的那一小块能力（`Kernel` 满足它；形状同包内
 * `surface/peer.ts` 的 `QqBotKernelPort`）。
 */
export interface QqBotKernelPortLike {
  setWorkspace(dir: string): Promise<unknown>;
  rootDir(): string;
  models?: {
    current(): string;
    list(): Promise<readonly { models: readonly { id: string }[] }[]>;
    select(model: string): Promise<{ id: string }>;
  };
  newAgentSession(): Promise<AgentSession>;
  activateSession(agent: AgentSession): void;
}

/** 打开插件所需的最小内核面（`Kernel` 满足它）。 */
export interface QqBotEnablePortLike {
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /** 只读 roster：「这个插件开着吗」是设置页开屏就要回答的问题（缺席 = 说不了）。 */
  roster?(): readonly { name: string; enabled: boolean }[];
}

/** 本次运行的通道计数（`stats` 的成员；`botName` 未询问时缺省）。 */
export interface QqBotChannelReadingLike {
  received: number;
  replied: number;
  lastReceivedAt?: number;
  botName?: string | null;
}

/**
 * 设置页的连接读数（形状同 `web/src/qqbot-frames.ts` 的 `QqBotLiveReading`）。
 *
 * `stats` 是**嵌套**的：通道计数是这条读数的一个成员，不是顶层字段。宿主 seam
 * 曾把通道读数平铺回来，而帧型声明的是嵌套——设置页的 收到/回复 行因此永远
 * 不渲染（夹具恰好喂了嵌套形状，测试全绿）。
 */
export interface QqBotLiveReadingLike {
  connecting: boolean;
  pluginEnabled?: boolean;
  failure?: string;
  botName?: string | null;
  stats?: { received: number; replied: number; lastReceivedAt?: number };
}

/**
 * 设置页的活通道缝（`bridge.runtime(...)` 的返回；`web` 的 `QqBotRuntime` 同形）。
 *
 * 四个成员都是必需的：这份镜像只描述**真桥**（`bridge.runtime` 恒给出全部四项），
 * `web` 侧的 `connection?` / `stop?` 可选性是为「宿主可能没有这张缝」而设的，
 * 必需成员赋给可选成员是合法的。
 */
export interface QqBotRuntimeLike {
  running(): boolean;
  afterSave(): Promise<string | undefined>;
  connection(): Promise<QqBotLiveReadingLike>;
  stop(): void;
}

/** 语义同包内 `HttpClientResponse` / `FetchLike`。 */
export interface QqBotHttpResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type QqBotFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<QqBotHttpResponseLike>;

/** 语义同包内 `GatewaySocket` / `SocketFactory`。 */
export interface QqBotSocketLike {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (hadError: boolean) => void): void;
}

export type QqBotSocketFactoryLike = (url: string) => Promise<QqBotSocketLike>;

/** 传输层注入点（测试用假 fetch / 假 socket；生产走真实网络）。 */
export interface QqBotTransportLike {
  fetchFn?: QqBotFetchLike;
  socketFactory?: QqBotSocketFactoryLike;
  gatewayUrl?: () => Promise<string>;
}

/** 一台跑在本进程里的 QQ 通道，加设置页需要的事实（形状同 `surface/bridge.ts`）。 */
export interface QqBotBridgeLike {
  /** 装进内核装配的插件（由通道自己提供）。 */
  readonly plugin: Plugin;
  /** 重读凭据后启动网关；已在运行则是 no-op。失败原因是返回值，不是异常。 */
  start(): Promise<string | undefined>;
  /** 本进程里网关**此刻**是否在跑。 */
  running(): boolean;
  /** 连接读数：`running()` 只管启没启动，这里说连没连上、BOT 是谁、收发了多少。 */
  reading(): Promise<QqBotChannelReadingLike & { connecting: boolean; failure?: string }>;
  /** 挂断网关（幂等）。 */
  stop(): void;
  /** 设置页的活通道缝：running / afterSave / connection / stop。 */
  runtime(kernel: () => QqBotEnablePortLike | undefined): QqBotRuntimeLike;
}

/** `loadQqBot()` 的返回面：cli 真正取用的运行时值。 */
export interface QqBotModule {
  createQqBotSurface(deps: QqBotSurfaceDepsLike): QqBotSurfacePartsLike;
  startQqBotBridge(
    credentials: QqBotCredentialPortLike,
    kernel: () => QqBotKernelPortLike | undefined,
    transport?: QqBotTransportLike,
  ): Promise<QqBotBridgeLike>;
  /** 缝的构造器：真桥经 `bridge.runtime(...)` 自己给（测试的假桥直接用它）。 */
  qqBotRuntimeSeam(bridge: QqBotBridgeLike, kernel: () => QqBotEnablePortLike | undefined): QqBotRuntimeLike;
  testQqBotConnection(opts: { appId: string; clientSecret: string }): Promise<string>;
}

/**
 * 动态装载 qqbot 包。
 *
 * cli 对包名的静态依赖为零，动态加载只有这一处（错误文案里的包名只是文案）；
 * 失败时抛一句说明「扩展不可用」的中文错误，让调用方决定降级方式：`nova qqbot`
 * 把它当启动失败报给用户，`nova --web` 捕获它并让整条 QQ 缝安静缺席（设置页
 * 显示原因）。
 * @returns 包的公开面。
 * @throws 当 `@nova-agent/qqbot` 无法加载时。
 */
export async function loadQqBot(): Promise<QqBotModule> {
  try {
    return (await import('@nova-agent/qqbot')) as unknown as QqBotModule;
  } catch (err) {
    throw new Error(`QQ 机器人扩展不可用（无法加载 @nova-agent/qqbot）：${errMessage(err)}`);
  }
}
