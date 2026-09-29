/**
 * 供应商解析：**「当前用哪个端点」这个问题的唯一答案**。
 *
 * 这一个文件回答三件事，别处不得再各答一遍：
 *  - 老配置的 `provider` 对象；
 *  - 新的 `providers[]` 清单 + `activeProvider` 指向的那一项；
 *  - 两者同时存在时谁说话（清单赢，见下）。
 *
 * 之所以单独成文件而不是塞进 `config.ts`：`config.ts` 是**校验**（zod schema 说
 * 什么形状是合法的），这里是**选择**（哪一项在役、缺字段时回落到什么）。两者失败
 * 模式不同——校验失败是「你写错了」，选择结果是「你还没配」——所以按职责分开。
 */
import type { Config } from './config.js';

// Re-exported so cli call sites need one import for "which endpoint, and what if
// there is none". The definitions live in core: `web` assembles its own kernel
// and must not import cli (dependency-direction gate), and two copies of "what
// we say when nothing is configured" would drift.
export { NO_PROVIDER_MESSAGE, unconfiguredProvider } from '@nova-agent/core';

/** 一个在役端点：Base URL、密钥、采样参数与窗口覆盖。 */
export interface ResolvedProvider {
  /** 稳定标识。清单里是它自己的 `id`；老配置的单端点是 `'default'`。 */
  id: string;
  /** 显示名（设置页用）。缺省取 host。 */
  name: string;
  baseURL: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}

/**
 * 老配置单端点的保留 id。
 *
 * 它必须是个**不会与操作者起的 id 冲突**的值：设置页把它显示为「默认」，而操作者
 * 新增的供应商各有自己的 id，所以这里用一个在 UI 上不出现的哨兵。
 */
export const DEFAULT_PROVIDER_ID = 'default';

/** URL 解析不出 host 时退回原文（与 `model-catalog.ts` 的 `endpointLabel` 同规则）。 */
function hostLabel(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

/**
 * 清单形态的每一项 → 在役端点形状。
 * @param entry - `providers[]` 里的一项（已通过 zod 校验）。
 * @returns the endpoint, with `name` defaulted to the URL's host.
 */
function fromEntry(entry: {
  id: string;
  name?: string;
  baseURL: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}): ResolvedProvider {
  return {
    id: entry.id,
    name: entry.name ?? hostLabel(entry.baseURL),
    baseURL: entry.baseURL,
    apiKey: entry.apiKey,
    ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
  };
}

/** 老配置的单端点 → 在役端点形状（`provider` 缺失时给出空壳）。 */
function fromLegacy(config: Config): ResolvedProvider | undefined {
  const legacy = config.provider;
  if (legacy === undefined) return undefined;
  return {
    id: DEFAULT_PROVIDER_ID,
    name: hostLabel(legacy.baseURL),
    baseURL: legacy.baseURL,
    apiKey: legacy.apiKey,
    ...(legacy.temperature !== undefined ? { temperature: legacy.temperature } : {}),
    ...(legacy.maxTokens !== undefined ? { maxTokens: legacy.maxTokens } : {}),
    ...(legacy.contextWindow !== undefined ? { contextWindow: legacy.contextWindow } : {}),
  };
}

/**
 * 全部已配置的端点，按文件里的顺序。**不合并**同名项：`id` 是标识，重复的 id 由
 * 设置页负责去重，这里如实报告（悄悄合并会让操作者改了一项却发现另一项也变了）。
 *
 * `providers` 非空时**只**返回它——`provider` 此时是派生的镜像，把它再列一遍会让
 * 设置页出现一个操作者没写过、删不掉的幽灵行。
 * @param config - the loaded config.
 * @returns the configured endpoints, possibly empty (the first-run shell).
 */
export function listProviders(config: Config): ResolvedProvider[] {
  const listed = config.providers;
  if (listed !== undefined && listed.length > 0) return listed.map(fromEntry);
  const legacy = fromLegacy(config);
  return legacy === undefined ? [] : [legacy];
}

/**
 * 当前在役的那一项，或 `undefined`（初次使用的空壳）。
 *
 * `providers` 非空时以它为准，理由是**新旧共存时的权威**：操作者在设置页点过
 * 「设为当前」才写得出 `activeProvider`，而 `provider` 可能是安装时手抄的。让新的
 * 赢，改端点才是即时的；让老的赢，设置页上会显示「已切换」而请求仍发去旧地址。
 *
 * `activeProvider` 指向不存在的 id 时回落列表第一项而非报错：删掉当前供应商是
 * 设置页允许的动作，删除后的**确定答案**是「用剩下的第一个」，不是一个死配置。
 * @param config - the loaded config.
 * @returns the endpoint in force, or undefined when nothing is configured.
 */
export function resolveProvider(config: Config): ResolvedProvider | undefined {
  const all = listProviders(config);
  const first = all[0];
  if (first === undefined) return undefined;
  const wanted = config.activeProvider;
  if (wanted === undefined) return first;
  return all.find((entry) => entry.id === wanted) ?? first;
}
