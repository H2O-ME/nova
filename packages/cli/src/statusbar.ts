/**
 * 状态栏的纯计算层：单行三段式降级与上下文结构分解。
 * 零终端 IO、零可变状态——壳层（tui-mode）每帧把闭包状态组装成
 * `StatusView`/`ContextBreakdownView` 快照传进来；仪表三档形态的按 key
 * 缓存留在壳层（重算要全量估计 messages，属渲染策略而非计算）。
 * 配色全部走 Palette 注入：测试传 plainPalette 即得无 ANSI 的确定字符串。
 */

import {
  estimateMessageTokens,
  estimateNextPromptTokens,
  estimateTextTokens,
  type AgentMessage,
  type ToolDefinition,
  type Usage,
} from '@nova-agent/core';
import { styledWidth } from '@nova-agent/tui';
import type { PtcMode } from '@nova-agent/plugins';
import type { ContextSegment, Palette, StatusTier } from './ui.js';
import { approvalChip, clipToWidth, modelTail, padBetween, sparkline } from './ui.js';

/** 执行模式的中文名（状态栏芯片、/mode、/session 共用）。 */
export function codeModeLabel(m: PtcMode): string {
  return m === 'native' ? '普通' : m === 'ptc' ? 'PTC' : '混合';
}

// ---- 上下文结构分解 -------------------------------------------------------

export interface ContextBreakdownView {
  systemPrompt: string;
  /** 只读 name/description/parameters 三字段，结构上接受 ToolDefinition[]。 */
  tools: readonly Pick<ToolDefinition, 'name' | 'description' | 'parameters'>[];
  messages: readonly AgentMessage[];
  usageAnchor: Usage | undefined;
  anchorMsgCount: number;
  /** config.provider.contextWindow（用户兜底），优先于 models.dev 元数据。 */
  contextWindow: number | undefined;
  modelMetaContextWindow: number | undefined;
}

/**
 * 上下文结构分解（仪表与 /session 明细共用）：提示词/工具/注入/技能/消息
 * 五段 token 数 + 总用量 + 窗口容量。有 usage 锚点时总量用真实 prompt
 * tokens（锚点+增量），校准因子把估算段对齐到该总量（段总和 === used）；
 * 无锚点时纯估算。
 */
export function contextBreakdown(view: ContextBreakdownView): {
  segments: ContextSegment[];
  used: number;
  capacity: number | undefined;
} {
  const sys = estimateTextTokens(view.systemPrompt);
  let toolSchemas = 0;
  for (const t of view.tools) {
    toolSchemas += estimateTextTokens(`${t.name} ${t.description ?? ''} ${JSON.stringify(t.parameters ?? {})}`);
  }
  let injected = 0;
  let skillsTok = 0;
  let history = 0;
  const SKILL_OPEN = '<available_skills>';
  const SKILL_CLOSE = '</available_skills>';
  for (const m of view.messages) {
    const tokens = estimateMessageTokens(m);
    if (m.role === 'user' && m.content.trimStart().startsWith('<')) {
      injected += tokens;
      // 技能索引在注入片段里有独立标记，切出来单列一段——用户想知道
      // 技能占了多少，而不是把它混进"提示词"。
      const s = m.content.indexOf(SKILL_OPEN);
      const e = m.content.indexOf(SKILL_CLOSE);
      if (s >= 0 && e > s) skillsTok += estimateTextTokens(m.content.slice(s, e + SKILL_CLOSE.length));
    } else history += tokens;
  }
  const estimate = sys + toolSchemas + injected + history;
  // 有锚点时以真实 prompt tokens 为总量（含框架序列化开销）。
  const used =
    view.usageAnchor !== undefined
      ? estimateNextPromptTokens(view.usageAnchor, view.messages.slice(view.anchorMsgCount))
      : estimate;
  // 段的加总必须恒等于 used（条与旁边的 used/capacity · pct% 不能打架）。
  // 校准因子 f = used/estimate 把内容段估算整体对齐到真实总量——误差按
  // 比例摊到每一段，而不是让"提示词"段吞下全部残差（那会扭曲系统提示
  // 词这一段的占比）。无锚点时 f = 1，段即原始估算。
  const factor = estimate > 0 && used > 0 ? used / estimate : 1;
  const scale = (n: number): number => Math.round(n * factor);
  const segments: ContextSegment[] = [
    { label: '提示词', tokens: scale(sys), color: 'cyan' },
    { label: '工具', tokens: scale(toolSchemas), color: 'green' },
    { label: '注入', tokens: scale(Math.max(0, injected - skillsTok)), color: 'blue' },
    { label: '技能', tokens: scale(skillsTok), color: 'magenta' },
    { label: '消息', tokens: scale(history), color: 'yellow' },
  ];
  // 逐段取整的残差（±几 tok）并入提示词段，保持总和与 used 精确相等。
  if (factor !== 1) {
    const drift = used - segments.reduce((sum, s) => sum + s.tokens, 0);
    segments[0]!.tokens = Math.max(0, segments[0]!.tokens + drift);
  }
  return { segments, used, capacity: view.contextWindow ?? view.modelMetaContextWindow };
}

/**
 * 仪表三档形态的缓存 key（计算留在壳层做记忆化）。字段取自渲染快照，
 * 任何一个变化都意味着条宽/分段/压缩阈值需要重算。
 */
export function gaugeCacheKey(v: {
  messagesLen: number;
  usageAnchor: Usage | undefined;
  model: string;
  codeMode: PtcMode;
  modelMetaVersion: number;
  capacity: number | undefined;
  toolCount: number;
  compactLimit: number | undefined;
  cols: number;
}): string {
  return (
    `${v.messagesLen}|${v.usageAnchor?.promptTokens ?? -1}|${v.model}|` +
    `${v.codeMode}|${v.modelMetaVersion}|${v.capacity ?? 0}|${v.toolCount}|` +
    `${v.compactLimit ?? 0}|${v.cols}`
  );
}

// ---- 状态栏（降级顺序即优先级，整字段降级、绝不词中截断） ------------------

export interface StatusView {
  cols: number;
  model: string;
  approvalMode: string;
  codeMode: PtcMode;
  /** 芯片呈现的"未开始"判据（不含 modeSwitching——见 tui-mode 注释）。 */
  pristine: boolean;
  streaming: boolean;
  interruptAt: number;
  inputEmpty: boolean;
  lastCtrlC: number;
  /** Date.now() 由调用方传入，2 秒退出窗口的判定因此可测。 */
  now: number;
  /** 500ms×10 环形窗口的当前快照（tps 速度表）。 */
  tpsRing: readonly number[];
  /** 会话累计 prompt/cached tokens（cache 命中率的分子分母）。 */
  promptTokens: number;
  cachedTokens: number;
  /** 粘住可见性：本会话一旦见过缓存上报就常驻。 */
  cacheSeen: boolean;
  /** 上下文仪表的三档形态，由壳层缓存（contextBreakdown + contextGaugeForms）。 */
  gaugeForms: readonly [string, string, string];
}

/**
 * 执行模式芯片：当前模式反色；会话未开始时并列三枚示意 Tab 循环。
 * `模式` 标签只在 T0 出现（三枚并列时本身就是图示，芯片里的中文也已自释）。
 */
function modeChips(p: Palette, tier: StatusTier, v: StatusView): string {
  const chip = (m: PtcMode): string =>
    m === v.codeMode ? p.inverse(` ${codeModeLabel(m)} `) : p.dim(` ${codeModeLabel(m)} `);
  const body =
    v.pristine && tier < 2
      ? (['native', 'ptc', 'both'] as PtcMode[]).map((m) => chip(m)).join('')
      : chip(v.codeMode);
  return tier === 0 ? `${p.dim('模式')} ${body}` : body;
}

/**
 * 单行状态栏：三段式 `上下文仪表 │ 模型 · 模式 · 审批 [│ 瞬时提示]`，右缘钉住
 * tps 速度表与 cache 率。层级靠分隔符表达——`│` 分大组（仪表 / 身份 / 提示），
 * `·` 分组内（模型·模式·审批 同属"当前会话配置"一件事）。
 * 空间不足按优先级**整字段降级**，而不是从词中间截断——旧版 `审批 自动编辑`
 * 被切剩 `审批 自`、模型名切剩 `c` 就是纯字符裁剪的结果：
 *   T0 全量 → T1 去 `模式/审批` 标签、模型去供应商前缀 → T2 仪表只留条+百分比、
 *   审批降单字、模型截断 → 极窄时 dropModel 弃模型（banner 与 /model 已可见）。
 * 模型是被优先牺牲的一段：它最占宽，却已出现在欢迎头与 /model；而上下文压力、
 * 执行模式、审批档位是"这一轮正在发生什么"，更该留住。全部降完仍放不下才 `…` 兜底。
 * 右缘仪表组定宽不随 tick 变化（tps 恒 10 格 + 数值 padStart(3) + cache 定宽），
 * 截左保右的不变量不变；百分比亦 padStart，位数跳动不挪分隔符。
 */
export function statusBar(p: Palette, v: StatusView): string {
  // 右缘仪表组（tps 速度表 + cache 命中率）：sparkline 恒 10 格、数值
  // padStart(3)、cache 百分比定宽——组自身宽度不随 tick 变化，右缘永不
  // 横移。旧版把动词/秒数放中段，每 90ms 改行宽，diff 重绘即闪烁。
  // cache 用**会话累计**命中率（非单轮值）：单轮值会因随机分流的后端未报缓存
  // 而 0↔N% 抖动，导致整段闪现。会话累计只增不减，一旦见过上报就稳定常驻。
  const cacheHit = v.promptTokens > 0 ? Math.round((v.cachedTokens / v.promptTokens) * 100) : 0;
  const bits: string[] = [];
  // tps 表常驻且**始终绿色**（不再随空闲/工具等待转灰）：它是会话级连续滚动的
  // 速度表，颜色不承载"是否在生成"这层语义（那由 composer 前缀 spinner 表达），
  // 灰色只会让定格的历史窗口看起来像坏了。sparkline 恒 10 格、数值 padStart(3)、
  // cache 百分比定宽——右缘布局恒定不横移。
  const cur = v.tpsRing[v.tpsRing.length - 1] ?? 0;
  const curStr = String(cur).padStart(3);
  const gauge = `${p.green(sparkline([...v.tpsRing]))} ${p.bold(curStr)}`;
  bits.push(`${p.dim('tps')} ${gauge}`);
  if (v.cacheSeen) bits.push(p.dim(`cache ${String(cacheHit).padStart(2)}%`));
  const right = bits.join(' · ');
  const budget = v.cols - 1;
  if (right.length === 0) return statusLeft(p, 0, false, v);
  const rightW = styledWidth(right);
  const fits = (left: string): boolean => styledWidth(left) + 2 + rightW <= budget;
  // 降级优先级：同一档位内先丢**瞬时提示**（中断/退出），再降档——提示
  // 只是锦上添花，不该把"已用/总量"数字挤出状态栏。上滚提示已整体移除：
  // 常驻视图不该因滚动变样式。
  for (const tier of [0, 1, 2] as StatusTier[]) {
    const full = statusLeft(p, tier, false, v, false);
    if (fits(full)) return padBetween(full, right, budget);
    const bare = statusLeft(p, tier, false, v, true);
    if (fits(bare)) return padBetween(bare, right, budget);
  }
  // 连 T2 带模型都放不下：先丢模型（信息最可推断），仍不够才截断整段。
  const noModelFull = statusLeft(p, 2, true, v, false);
  if (fits(noModelFull)) return padBetween(noModelFull, right, budget);
  const noModel = statusLeft(p, 2, true, v, true);
  if (fits(noModel)) return padBetween(noModel, right, budget);
  return `${clipToWidth(noModel, Math.max(1, budget - rightW - 2))}  ${right}`;
}

/**
 * 左段（截左保右的那一侧）：仪表 │ 身份组 │ 瞬时提示，按档位取形态。
 * `dropModel` 是比 T2 更窄的最后形态——身份组里只留模式与审批。
 * `noHints` 去掉瞬时提示段（中断/退出），供状态栏在"降档之前"先丢提示。
 * 上滚**不**进状态栏：滚动位置从画面本身就能看出来，而状态栏是常驻视图，
 * 一上滑就变样式（多出提示段、甚至整段降档）比不提示更扰人。
 */
function statusLeft(p: Palette, tier: StatusTier, dropModel: boolean, v: StatusView, noHints = false): string {
  const sep = ` ${p.dim('│')} `;
  const identity: string[] = [];
  if (!dropModel) {
    const model = tier === 0 ? v.model : clipToWidth(modelTail(v.model), tier === 1 ? 22 : 12);
    identity.push(p.bold(model));
  }
  identity.push(modeChips(p, tier, v), approvalChip(p, v.approvalMode, tier));
  let line = `${v.gaugeForms[tier]}${sep}${identity.join(` ${p.dim('·')} `)}`;
  if (noHints) return line;
  if (v.streaming && v.interruptAt > 0) line += sep + p.yellow('■ 等待工具退出…');
  if (!v.streaming && v.inputEmpty && v.now - v.lastCtrlC < 2000) {
    line += sep + p.yellow('再按一次 Ctrl+C 退出');
  }
  return line;
}
