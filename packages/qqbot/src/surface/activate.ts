/**
 * 「保存凭据之后，真的跑起来」这一步。
 *
 * 为什么不是散在 `web-mode.ts` 的启动流程里：这是一个**独立的行为**——把刚写进配置文件的
 * 凭据变成一条在跑的通道——它有自己的顺序、自己的失败模式，而且必须能被单独驱动来验证
 * （启动整个 `nova --web` 去测它，等于拿一个 HTTP 服务器当夹具）。
 *
 * 顺序不可颠倒，两步都不可省：
 *  1. **先把插件在 roster 里打开**。`qqbot` 是 `advanced`（默认关），不打开的话这次保存
 *     只是写了一个谁都不会加载的插件的凭据：网关拨号了，工具没注册，入站消息没有处理者。
 *  2. **再重读凭据并拨号**（`bridge.start()` 自己做这件事）。先拨号会让第一条入站消息
 *     撞上一个尚未重 roster 的内核。
 *
 * 插件没打开成功就**不拨号**：启动一条没人接的网关，比报错更难查。
 */
import { errMessage } from '@nova-agent/core';
import type { QqBotBridge } from './bridge.js';

/** 打开插件所需的最小内核面（`Kernel` 满足它）。 */
export interface QqBotEnablePort {
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /** 只读 roster：「这个插件开着吗」是设置页开屏就要回答的问题（缺席 = 说不了）。 */
  roster?(): readonly { name: string; enabled: boolean }[];
}

/**
 * The connection reading the settings page consumes (`web/src/qqbot-frames.ts`
 * declares the same shape on its side).
 *
 * `stats` is NESTED on purpose: the tallies are one读数 among several the seam
 * attests to (连接中 / 未启用 / 失败原因 / BOT 名), not top-level fields of their
 * own. This seam once spread the channel's reading FLAT while the frame type
 * declared it nested — the settings page therefore read `live.stats` as
 * `undefined` and its 收到/回复 line never rendered against a real channel (the
 * fixtures happened to feed the nested shape, so every test stayed green).
 */
export interface QqBotLiveReading {
  /** Started, but not connected yet (the dial is in flight). */
  connecting: boolean;
  /** Whether the plugin is enabled in the roster; absent = this host cannot tell. */
  pluginEnabled?: boolean;
  /** Why it is not connected, in the host's own words; absent = nothing failed. */
  failure?: string;
  /** The gateway's own username for this bot; null = asked and could not get it. */
  botName?: string | null;
  /** This run's tallies (basis: the PROCESS — a restart starts over). */
  stats?: { received: number; replied: number; lastReceivedAt?: number };
}

/** 设置页要的那两个读法。 */
export interface QqBotRuntimeSeam {
  running(): boolean;
  afterSave(): Promise<string | undefined>;
  /** 连接读数：`pluginEnabled` 由内核 roster 补上，其余来自桥（见 `bridge.reading`）。 */
  connection(): Promise<QqBotLiveReading>;
  /** 挂断网关：关掉插件开关的另一半（roster 翻面不关 socket）。 */
  stop(): void;
}

/**
 * Build the settings page's live-channel seam.
 *
 * `kernel` is a getter, not a value: the kernel does not exist yet when the
 * bridge is assembled (its plugin has to be part of the assembly), and the seam
 * outlives the initial `undefined`.
 * @param bridge - the channel this process runs.
 * @param kernel - the assembled kernel, resolved lazily.
 * @returns the seam `QqBotRuntime` describes.
 */
export function qqBotRuntimeSeam(bridge: QqBotBridge, kernel: () => QqBotEnablePort | undefined): QqBotRuntimeSeam {
  return {
    running: () => bridge.running(),
    stop: () => bridge.stop(),
    connection: async () => {
      const row = kernel()?.roster?.()?.find((entry) => entry.name === 'qqbot');
      // The tallies are lifted OUT of the channel reading into `stats` (see
      // `QqBotLiveReading`); the rest (`connecting` / `failure` / `botName`)
      // keeps its place.
      const { received, replied, lastReceivedAt, ...rest } = await bridge.reading();
      return {
        ...rest,
        ...(row !== undefined ? { pluginEnabled: row.enabled } : {}),
        stats: { received, replied, ...(lastReceivedAt !== undefined ? { lastReceivedAt } : {}) },
      };
    },
    afterSave: async () => {
      const port = kernel();
      if (port !== undefined) {
        try {
          await port.setPluginEnabled('qqbot', true);
        } catch (err) {
          return `QQ 机器人插件未能启用：${errMessage(err)}`;
        }
      }
      return bridge.start();
    },
  };
}
