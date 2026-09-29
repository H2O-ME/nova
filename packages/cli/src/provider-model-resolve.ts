/**
 * 把配置里的模型名对齐到**端点自己公布的拼写**。
 *
 * 从 `kernel-config.ts` 拆出：那个文件回答「配置怎么降维成内核要的形状」，这里回答
 * 「请求该报哪个名字」。两件事的失败模式不同——降维漏字段是静默少传，对账失败只是
 * 沿用原样——而且对账要走网络，是这台机器上启动期的第一次外部调用。
 *
 * 判据**不在这里**：`core/model-id.ts` 的 `resolveModelId` 是唯一定义处。这里只负责
 * 拿列表、调判据、就地改写。
 */
import { resolveModelId } from '@nova-agent/core';
import type { OpenAICompatClient } from '@nova-agent/ai';

/** 一次 id 对账的结果（`model` 是**实际会发出去**的拼写）。 */
export interface ResolvedModel {
  /** The spelling a request will carry — reconciled when the endpoint knew it. */
  model: string;
  /** True when the endpoint publishes a different spelling than the config's. */
  corrected: boolean;
}

/**
 * 对账 id 的墙钟预算。`GET /models` 是一次启动期网络调用，而它跑在任何 surface 存在
 * 之前：端点是死的（或黑洞路由）时绝不能按请求超时（120s）把启动按住。对账失败只是
 * 「沿用配置原样」，所以这个预算给得紧——宁可放弃对账，不可拖住启动。
 */
export const MODEL_RESOLVE_TIMEOUT_MS = 5_000;

/**
 * 把配置里的模型名对齐到端点公布的拼写（`core/model-id.ts` 是判据的唯一定义处）。
 *
 * 端点 id 是它自己的私有词汇表，多数网关逐字比较：只差大小写的名字不是「差不多」，
 * 而是「没有这个模型」，报回来的 5xx/404 与 provider 挂掉在读感上无法区分。所以
 * 请求名以 `GET /models` 为准，配置里写错大小写不再是故障。
 *
 * **best-effort，绝不抛**：列模型要走网络，断网/超时/鉴权失败都不该挡住启动——
 * 拿不到列表就沿用配置原样，让端点自己的报错去点名那个模型。`corrected` 只用于
 * 告诉读者发生了什么，不驱动任何分支。
 * @param client - the client whose `model` is reconciled IN PLACE (`setModel`).
 * @returns the reconciled id plus whether it differs from the configured one.
 */
export async function resolveProviderModel(client: OpenAICompatClient): Promise<ResolvedModel> {
  const configured = client.model;
  const available = await client.listModels(MODEL_RESOLVE_TIMEOUT_MS).catch(() => [] as string[]);
  const model = resolveModelId(configured, available);
  if (model !== configured) client.setModel(model);
  return { model, corrected: model !== configured };
}
