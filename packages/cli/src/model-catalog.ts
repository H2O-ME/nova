/**
 * 模型目录的元数据面（M11 批10）：WebUI 的模型选择器需要「显示名 + 上下文窗口」，
 * 而端点自身（`GET /models`）只报 id —— 这一小件就是两者之间的缝。
 *
 * 分工：
 *  - **id 归端点**（内核经 `ChatProvider.listModels` 现取），所以网关加模型不必
 *    等本产品发版；
 *  - **元数据归这里**（models.dev 目录，24h 缓存，断网沿用旧缓存）；
 *  - **阈值归模型**：换模型后上下文窗口跟着换，好让上下文仪表的分母不是上一个
 *    模型的数字。
 *
 * 一切都是 best-effort：查不到就返回 undefined，界面按 id 渲染、仪表不画百分比，
 * 而不是猜一个窗口。
 */
import type { ModelCatalogPort } from '@nova-agent/core';
import type { Config } from './config.js';
import type { ModelMetaStore } from './model-meta.js';

/** 一处 provider 的显示名：models.dev 的目录里查不到时退回站点主机名。 */
export function endpointLabel(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

/**
 * 建「元数据面」。`peek` 先走已加载的目录（同步、无网），未命中再异步查
 * （可能触发一次后台刷新）——选择器打开时不该为显示名等一次网络。
 */
export function createModelCatalogPort(config: Config, store: ModelMetaStore): ModelCatalogPort {
  const baseURL = config.provider.baseURL;
  return {
    label: endpointLabel(baseURL),
    describe: async (model) => {
      // 配置里为「当前模型」写的窗口是权威覆盖；换到别的模型时它不适用。
      if (model === config.provider.model && config.provider.contextWindow !== undefined) {
        return { contextWindow: config.provider.contextWindow };
      }
      const meta = store.peek(model, baseURL) ?? (await store.lookup(model, baseURL));
      if (meta === undefined) return undefined;
      return {
        ...(meta.displayName !== undefined ? { name: meta.displayName } : {}),
        contextWindow: meta.contextWindow,
      };
    },
  };
}