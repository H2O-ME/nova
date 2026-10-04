/**
 * 这个行的设置页：描述符怎么拼，以及关于密钥的两条规则。
 *
 * 页面归插件（宿主只做通用渲染，见 core 的 `PluginPageDescriptor`），所以「有哪些
 * 字段、什么提示、连接读数长什么样」都在这里。密钥的两条规则是这个文件存在的理由：
 *
 *  1. **不回显**：字面密钥永不进描述符（描述符要下线到浏览器）。已设置就只说已设置；
 *     操作者自己写的 `{env:NAME}` 引用是**惰性文本**，可以照原样显示与再编辑。
 *  2. **不可用的凭据不拿去拨号**：配置层对**没能兑现**的 `{env:NAME}` 会原样留下，
 *     把它当密钥送去换 token 只会换来一句看不懂的 401。所以「这份设置能不能用」只有
 *     这一处判定——插件拿它决定拨不拨号，页面拿它说明为什么没拨。
 */
import type { PluginPageDescriptor, PluginSettingField, PluginSettingStatus } from '@nova-agent/core';

/** `{env:NAME}` 引用的形状。刻意无 `g`：这个正则被反复 test，带状态会漏判。 */
const ENV_REF = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/;

/** 一次激活看得到的设置（行 `config` 的已校验值）。 */
export interface QqBotSettings {
  readonly appId?: string;
  readonly clientSecret?: string;
}

/** 通道此刻走到哪一步。 */
export type QqBotChannelPhase = 'off' | 'connecting' | 'live' | 'failed';

/** 页面要描述的全部事实（活状态由插件填，本文件只负责怎么呈现）。 */
export interface QqBotPageState {
  readonly settings: QqBotSettings;
  readonly phase: QqBotChannelPhase;
  /** 网关报出的 BOT 名；null = 问过但取不到。 */
  readonly botName?: string | null;
  /** 最近一次拨号为什么没成（本进程的说法）。 */
  readonly failure?: string;
  /** 本次运行的收发计数（口径见 `types.ts`：重启归零）。 */
  readonly stats?: { readonly received: number; readonly replied: number; readonly lastReceivedAt?: number };
  /** 刚保存过：下一次 roster 会按新凭据重挂这一行。 */
  readonly saved?: boolean;
}

/** 页面可编辑的字段键——`save` 校验用的也是这一份清单。 */
export const QQ_BOT_SETTING_KEYS = ['appId', 'clientSecret'] as const;
export type QqBotSettingKey = (typeof QQ_BOT_SETTING_KEYS)[number];

/** 这个键是不是本行的设置（未知键必须点名拒绝，不能静默丢掉）。 */
export function isQqBotSettingKey(key: string): key is QqBotSettingKey {
  return (QQ_BOT_SETTING_KEYS as readonly string[]).includes(key);
}

/** 值里没兑现的 `{env:NAME}` 引用名；undefined = 不是引用。 */
export function unresolvedEnvRef(value: string | undefined): string | undefined {
  const match = value === undefined ? null : ENV_REF.exec(value);
  return match?.[1];
}

/**
 * 「这份凭据能不能用」的**唯一定义**：undefined = 可以拿去拨号。
 *
 * 三种不可用各有各的说法，因为它们要人做的事不同：变量没设（去设环境变量）、
 * AppID 没填（去开放平台抄）、密钥没填（同左）。
 * @param settings - the row's settings.
 * @returns the reason it cannot be dialed with, or undefined when it can.
 */
export function qqBotCredentialProblem(settings: QqBotSettings): string | undefined {
  const appIdRef = unresolvedEnvRef(settings.appId);
  if (appIdRef !== undefined) return `AppID 引用了未设置的环境变量 {env:${appIdRef}}。`;
  const secretRef = unresolvedEnvRef(settings.clientSecret);
  if (secretRef !== undefined) return `密钥引用了未设置的环境变量 {env:${secretRef}}。`;
  if ((settings.appId ?? '').trim().length === 0) return '还没有填写 AppID。';
  if ((settings.clientSecret ?? '').trim().length === 0) return '还没有填写密钥。';
  return undefined;
}

/** 这一行自己的页面。 */
export function qqBotPage(state: QqBotPageState): PluginPageDescriptor {
  const status: PluginSettingStatus[] = [channelStatus(state), credentialStatus(state.settings)];
  if (state.stats !== undefined) {
    status.push({
      label: '本次运行',
      value: `收到 ${state.stats.received} 条 · 回复 ${state.stats.replied} 条`,
    });
  }
  if (state.saved === true) {
    status.push({ label: '保存', value: '已写入配置，这一行会按新凭据重挂通道。', tone: 'ok' });
  }
  return {
    title: 'QQ 机器人',
    intro:
      '接腾讯 QQ 机器人开放平台的 WebSocket 通道：对端每发一条消息，就为这个对端跑一轮内核'
      + '（独立会话、无人值守审批），回答按被动回复窗口发回。',
    guide: [
      '在 QQ 开放平台创建机器人，拿到 AppID 与 AppSecret。',
      '把两者填在下面并保存：保存会把这一行打开，并按新凭据重挂通道。',
      '群里需要 @机器人 才会收到消息——平台只推送被 @ 的那条。',
      '密钥可以写成 {env:NAME} 引用环境变量；页面永远不会回显它的值。',
      '对端也能用 /help 看到那套遥控指令（权限档、审批、换会话）。',
    ],
    status,
    fields: [
      {
        key: 'appId',
        label: 'AppID',
        kind: 'text',
        value: state.settings.appId ?? '',
        placeholder: '开放平台里的机器人 AppID',
      },
      secretField(state.settings.clientSecret),
    ],
    actions: [{ id: 'test', label: '测试连接', kind: 'primary' }],
    note: '通道随这一行一起启停：关掉这一行，socket、对端会话与审批定时器一起收走。',
  };
}

/** 通道那一行状态：没起来时说的是**为什么**，而不是一个「未启动」。 */
function channelStatus(state: QqBotPageState): PluginSettingStatus {
  const problem = qqBotCredentialProblem(state.settings);
  if (problem !== undefined) return { label: '通道', value: `未启动：${problem}`, tone: 'warn' };
  switch (state.phase) {
    case 'live':
      return {
        label: '通道',
        value: state.botName === null ? '运行中（BOT 名称取不到）' : `运行中${state.botName === undefined ? '' : `（${state.botName}）`}`,
        tone: 'ok',
      };
    case 'connecting':
      return { label: '通道', value: '正在连接网关…', tone: 'warn' };
    case 'failed':
      return { label: '通道', value: `连接失败：${state.failure ?? '原因未知'}`, tone: 'bad' };
    case 'off':
      return { label: '通道', value: '未启动', tone: 'warn' };
  }
}

/** 凭据那一行：只说「有没有」，不说「是什么」。 */
function credentialStatus(settings: QqBotSettings): PluginSettingStatus {
  const appId = settings.appId ?? '';
  const secret = settings.clientSecret ?? '';
  const reference = unresolvedEnvRef(secret);
  const secretText =
    secret.trim().length === 0
      ? '密钥未填写'
      : reference === undefined
        ? '密钥已设置（不回显）'
        : `密钥引用 {env:${reference}}`;
  return {
    label: '凭据',
    value: `${appId.trim().length === 0 ? 'AppID 未填写' : 'AppID 已填写'} · ${secretText}`,
    tone: appId.trim().length === 0 || secret.trim().length === 0 ? 'warn' : 'ok',
  };
}

/**
 * 密钥字段。
 *
 * 字面密钥**连占位符都不给**：占位符是浏览器里可见的文本，而它的内容只能是密钥本身
 * 或一句关于密钥的话——后者已经由 `hint` 说了。引用相反：那是操作者自己写的惰性文本，
 * 照原样显示出来他才能改它。
 */
function secretField(stored: string | undefined): PluginSettingField {
  const reference = unresolvedEnvRef(stored) === undefined ? undefined : stored;
  const isSet = (stored ?? '').trim().length > 0;
  return {
    key: 'clientSecret',
    label: '密钥',
    kind: 'secret',
    ...(reference !== undefined ? { value: reference } : {}),
    placeholder: isSet ? '留空表示不改' : 'AppSecret',
    hint: isSet ? '留空保存会保留已设置的密钥。' : '在开放平台的「开发设置」里可以看到或重置。',
  };
}
