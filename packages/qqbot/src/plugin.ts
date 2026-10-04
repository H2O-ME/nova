/**
 * QQ 机器人：一个自持通道的标准插件。
 *
 * 它曾经是个「宿主按名字构造的工厂」——`qqbotPlugin(options)` 拿宿主递来的发送函数，
 * 而入站通道由 surface 侧的桥另建、由 `web-mode.ts` 在启动时拨号。后果就是这个重构
 * 要修的那个 bug：**行关着，通道照跑**（宿主从它留着的候选对象上拨号），以及「保存
 * 了凭据什么都没发生」（启动路径绑在启动时的配置快照上）。
 *
 * 现在按插件协议只有一条路：行开 → `apply` 跑 → 通道在这里建、在这里拨、随 fiber 收
 * （`ctx.effect`）；行关 → 没有 fiber，没有 socket，也没有定时器。凭据来自**它自己
 * 的 config**（行 `plugins.entries[].config`，由上面的 `Config` 校验），从不来自宿主
 * 递进来的对象。
 *
 * 没有凭据**不是**失败：那时它照样注册设置页的 RPC 命名空间——操作者要能把凭据填进去，
 * 而页面正是他填的地方。拨号失败同理：失败是页面上的读数（`LiveQqBot.failure`），不是
 * 一个抛出去的异常——一个激活失败的插件没有 RPC 命名空间，能修它的那个页面会先死掉。
 *
 * 模块**无导入副作用**：行关着时插件树也要 import 它来读 manifest（见 `plugin-tree.ts`）。
 */
import path from 'node:path';

import {
  errMessage,
  executionEnvironment as executionEnvironmentKey,
  llm as llmKey,
  objectConfig,
  pluginConfig as pluginConfigKey,
  pluginRpc as pluginRpcKey,
  sessions as sessionsKey,
  sessionsRoot,
  tools as toolsKey,
  type Context,
  type Plugin,
  type PluginPageDescriptor,
} from '@nova-agent/core';
import { registerTool } from '@nova-agent/plugins';
import { PeerTurns } from './peers.js';
import { probeQqBotConnection } from './probe.js';
import { createQqBotChannel, type QqBotChannel } from './runtime.js';
import { parseRemoteCommand } from './remote-parse.js';
import {
  isQqBotSettingKey,
  qqBotCredentialProblem,
  qqBotPage,
  type QqBotPageState,
  type QqBotSettingKey,
  type QqBotSettings,
} from './settings.js';
import { qqbotSendTool } from './tool.js';

/** 行 id，也是 RPC 命名空间与每一条错误/日志里的名字（一个身份，一处定义）。 */
export const QQ_BOT_PLUGIN_NAME = '@nova-agent/qqbot';

/** 这一行的设置，也就是 `Config` 校验的形状。 */
export interface QqBotPluginConfig {
  /** 开放平台机器人的 AppID。 */
  appId?: string;
  /** AppSecret；可以是 `{env:NAME}` 引用。 */
  clientSecret?: string;
}

/**
 * Both fields are optional and that is load-bearing: a row with no credentials
 * still activates (it has a settings page to fill in). What CANNOT be refused
 * here is an unknown key — a typo would look saved and do nothing.
 */
export const Config = objectConfig<QqBotPluginConfig>({
  appId: { type: 'string' },
  clientSecret: { type: 'string' },
});

/** 一次 `action` 的答复面（设置页的「测试连接」按钮读它）。 */
export interface QqBotActionResult {
  ok: boolean;
  message?: string;
  descriptor?: PluginPageDescriptor;
}

/** 本进程这一档激活里跑着的通道。 */
interface LiveQqBot {
  readonly channel: QqBotChannel;
  /** 拨号在飞（设置页据此说「正在连接」而不是「失败」）。 */
  connecting: boolean;
  /** 最近一次拨号失败的原因；成功即消失。 */
  failure?: string;
}

/**
 * 本进程正在跑的通道，供 surface 读。
 *
 * `nova qqbot` 这个 surface 只剩「认领 argv 并常驻」，但它必须能如实回答「通道到底
 * 起来了没有」：凭据没填、行没开时它应当启动失败并说明，而不是安静地挂着。所以激活时
 * 在这里登记、fiber 卸载时撤掉——这是**读**，不是启动路径：谁拨号永远只有 fiber 一个答案。
 */
let activeChannel: QqBotChannel | undefined;

/** 本进程此刻在跑的通道；关闭的行或没凭据的行都是 undefined。 */
export function runningQqBotChannel(): QqBotChannel | undefined {
  return activeChannel;
}

export const plugin: Plugin<QqBotPluginConfig> = {
  name: QQ_BOT_PLUGIN_NAME,
  manifest: {
    title: 'QQ 机器人',
    description: '腾讯 QQ 机器人开放平台通道：对端消息各跑一轮独立会话，回答按被动回复窗口发回。',
    tier: 'advanced',
    // The row answers a settings `page` (see the namespace below), so it declares
    // one: the settings navigation is drawn from the LIVE roster, and a plugin
    // that stays silent here simply never gets a section — which is what made
    // this channel's credentials unreachable in the real product.
    page: true,
  },
  Config,
  // Everything read with `must` is declared: an absent capability then fails with
  // the service's own name instead of a TypeError deep in a turn. The optional
  // reads (`execution-environment`, `llm`) are deliberately NOT declared — they
  // only enrich `/status`, and requiring them would refuse a headless assembly
  // that is otherwise perfectly able to run this channel.
  inject: [pluginRpcKey, pluginConfigKey, sessionsKey, toolsKey],
  apply: (ctx: Context, config: QqBotPluginConfig): void => {
    const settings: QqBotSettings = {
      ...(config.appId !== undefined ? { appId: config.appId } : {}),
      ...(config.clientSecret !== undefined ? { clientSecret: config.clientSecret } : {}),
    };
    /** 对端会话与启动期的初始会话同归档在 qqbot 子目录（与交互会话隔离）。 */
    const sessionDir = path.join(sessionsRoot(), 'qqbot');
    let live: LiveQqBot | undefined;

    const turns = new PeerTurns({
      sessions: ctx.must(sessionsKey),
      sessionDir,
      rootDir: () => ctx.get(executionEnvironmentKey)?.rootDir(),
      model: () => ctx.get(llmKey)?.model,
      // 审批问题必须在轮还没结束时**立刻**推出去：它等的那条消息正是这一轮攥着的。
      // 通道迟绑定，因为它建在跑轮子的东西之后（两者互为对方的输入）。
      notify: (peer, text) => {
        const sending = live?.channel;
        if (sending === undefined) return;
        // 平台只允许「回复最近一条入站消息」这种外发，所以窗口没开就不发；开着就把
        // 那条 msg_id 带上。**这里曾经只查窗口却把 msg_id 丢下**——那等于发一条主动
        // 消息，会被平台限流拒绝，审批问题永远送不到对端（`send` 的注释说「缺省用
        // 窗口」而实现并没有回退，两者当时是相反的）。
        const msgId = sending.lastMsgIdOf(peer.peerId);
        if (msgId === undefined) return;
        void sending.send(peer.peerId, text, msgId).catch(() => undefined);
      },
    });
    ctx.effect(() => () => turns.dispose(), 'qqbot peer turns');

    /** 描述符：活读数只在通道真的在跑时去问（见 `QqBotChannel.reading`）。 */
    const describe = async (shown: QqBotSettings, saved = false): Promise<PluginPageDescriptor> => {
      const reading =
        live === undefined || live.failure !== undefined
          ? undefined
          : await live.channel.reading().catch(() => undefined);
      const state: QqBotPageState = {
        settings: shown,
        phase: live === undefined ? 'off' : live.failure !== undefined ? 'failed' : live.connecting ? 'connecting' : 'live',
        ...(live?.failure !== undefined ? { failure: live.failure } : {}),
        ...(reading?.botName !== undefined ? { botName: reading.botName } : {}),
        ...(reading !== undefined
          ? {
              stats: {
                received: reading.received,
                replied: reading.replied,
                ...(reading.lastReceivedAt !== undefined ? { lastReceivedAt: reading.lastReceivedAt } : {}),
              },
            }
          : {}),
        ...(saved ? { saved: true } : {}),
      };
      return qqBotPage(state);
    };

    const runAction = async (payload: unknown): Promise<QqBotActionResult> => {
      const id = textMember(payload, 'id');
      if (id === undefined || id.length === 0) throw new Error('qqbot: "action" needs an "id"');
      if (id !== 'test') throw new Error(`qqbot: unknown action "${id}"`);
      // The probe runs on what the operator JUST typed when the page sent fields
      // along (testing before saving is the whole point of the button), and on the
      // stored settings otherwise.
      const candidate = mergeSettings(settings, settingFields(member(payload, 'fields')));
      const problem = qqBotCredentialProblem(candidate);
      if (problem !== undefined) return { ok: false, message: problem, descriptor: await describe(settings) };
      try {
        const gateway = await probeQqBotConnection({
          appId: candidate.appId ?? '',
          clientSecret: candidate.clientSecret ?? '',
        });
        return { ok: true, message: `凭据有效：网关 ${gateway}`, descriptor: await describe(settings) };
      } catch (err) {
        return { ok: false, message: `连接失败：${errMessage(err)}`, descriptor: await describe(settings) };
      }
    };

    // The settings namespace is registered FIRST and unconditionally: this is the
    // door the credentials come in through, so it must exist while they are still
    // missing. It dies with the fiber like everything else — a switched-off row
    // cannot answer, which is exactly what the browser reports.
    ctx.effect(
      () =>
        ctx.must(pluginRpcKey).register(QQ_BOT_PLUGIN_NAME, async (op, payload) => {
          switch (op) {
            case 'page':
              return describe(settings);
            case 'save': {
              const fields = settingFields(requireFields(payload));
              const merged = mergeSettings(settings, fields);
              // Persist through the port, and turn the row ON: saving a settings
              // page the operator just filled in is asking for it to run.
              await ctx.must(pluginConfigKey).setEntry(QQ_BOT_PLUGIN_NAME, {
                enabled: true,
                config: merged,
              });
              return describe(merged, true);
            }
            case 'action':
              return runAction(payload);
            default:
              throw new Error(`qqbot: unknown operation "${op}"`);
          }
        }),
      `rpc(${QQ_BOT_PLUGIN_NAME})`,
    );

    if (qqBotCredentialProblem(settings) !== undefined) return;

    const channel = createQqBotChannel({
      appId: settings.appId ?? '',
      clientSecret: settings.clientSecret ?? '',
      brain: (text, peer) => turns.run(text, peer),
      // 遥控指令走串行队列**之外**的旁路：一轮可能停在审批上等人回答，而答复要排队的话
      // 就会永远排在自己所等的那一轮后面（死锁）。`claim` 用同一个纯解析器判定。
      remote: {
        claim: (text) => parseRemoteCommand(text).command !== undefined,
        handle: (text, peer) => turns.run(text, peer),
      },
      // A plugin has no console owner: `ctx.log` writes only when NOVA_LOG asks.
      log: (line) => ctx.log('info', `qqbot: ${line}`),
    });
    const started: LiveQqBot = { channel, connecting: true };
    live = started;
    ctx.effect(() => {
      activeChannel = channel;
      // The dial is async and its failure is a READING, never a throw: see the
      // module header. Re-saving the credentials is the retry path, which is why
      // the reason has to survive as page state rather than as a failed row.
      void channel.start().then(
        () => {
          started.connecting = false;
        },
        (err: unknown) => {
          const message = errMessage(err);
          started.connecting = false;
          started.failure = message;
          // The message already names the channel (`qqbot: …`), so this adds no prefix.
          ctx.log('warn', message);
        },
      );
      return () => {
        if (activeChannel === channel) activeChannel = undefined;
        channel.stop();
      };
    }, 'qqbot channel');
    // The tool ships with the CHANNEL, not with the connect result: the socket
    // reconnects on its own after a transient failure, and a tool that came and
    // went with it would make the model's reach depend on network timing. What it
    // does NOT do is exist for a row that has no channel at all — a row with no
    // credentials offers the model nothing to call.
    registerTool(
      ctx,
      qqbotSendTool({
        send: (peer, content, msgId) => channel.send(peer, content, msgId),
        lastMsgIdOf: (peer) => channel.lastMsgIdOf(peer),
      }),
      // 对外发送消息 = 对外网络副作用，与 bash 同级审批。
      'execute',
    );
  },
};

export default plugin;

/**
 * 提交的字段并到当前设置上。
 *
 * 空串是「不改」而不是「清空」：密钥字段从不回显，留空是操作者说「密钥照旧」的唯一
 * 办法。未提交的字段**必须跟着走**，因为 `plugin-config` 的 `config` 是整份替换——
 * 少带一个键就等于把它从文件里删掉。代价是：如果配置层已经把 `{env:NAME}` 兑现成了
 * 明文交给我们，这次保存会把那份明文写回文档；只有宿主能保住引用（见交付说明）。
 * @param current - the settings this activation was given.
 * @param patch - the submitted fields.
 * @returns the settings to store.
 */
function mergeSettings(
  current: QqBotSettings,
  patch: Partial<Record<QqBotSettingKey, string>>,
): QqBotSettings {
  const appId = patch.appId?.trim() ?? '';
  const secret = patch.clientSecret?.trim() ?? '';
  return {
    ...(appId.length > 0 ? { appId } : current.appId !== undefined ? { appId: current.appId } : {}),
    ...(secret.length > 0
      ? { clientSecret: secret }
      : current.clientSecret !== undefined
        ? { clientSecret: current.clientSecret }
        : {}),
  };
}

/** `save` 的 payload → 提交的字段；缺 `fields` 是契约违背，点名拒绝。 */
function requireFields(payload: unknown): Record<string, unknown> | undefined {
  const fields = member(payload, 'fields');
  if (fields === undefined) throw new Error('qqbot: "save" needs a "fields" object of strings');
  return fields;
}

/** 提交的字段表 → 已校验的设置；未知键与非法类型都在这里点名。 */
function settingFields(raw: Record<string, unknown> | undefined): Partial<Record<QqBotSettingKey, string>> {
  const out: Partial<Record<QqBotSettingKey, string>> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isQqBotSettingKey(key)) throw new Error(`qqbot: unknown setting "${key}"`);
    if (typeof value !== 'string') throw new Error(`qqbot: setting "${key}" must be a string`);
    out[key] = value;
  }
  return out;
}

/** One object member of a payload, when it is present and really an object. */
function member(value: unknown, key: string): Record<string, unknown> | undefined {
  const found = plainMember(value, key);
  if (found === undefined || Array.isArray(found)) return undefined;
  return found as Record<string, unknown>;
}

/** One string member of a payload, when it is present and really a string. */
function textMember(value: unknown, key: string): string | undefined {
  const found = plainMember(value, key);
  return typeof found === 'string' ? found : undefined;
}

/**
 * One member of an object-shaped value, without trusting its shape.
 *
 * The payload crosses the plugin boundary as `unknown` on purpose (only this
 * plugin knows what its operations mean), so every read has to survive a hostile
 * or merely wrong shape — an array, a primitive, a missing key.
 */
function plainMember(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}
