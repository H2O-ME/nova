/**
 * 模型目录的元数据面：选择器与设置页需要「显示名 + 上下文窗口 + 多模态能力」，而端点
 * 自身（`GET /models`）只报 id —— 这一小件就是两者之间的缝。
 *
 * 三个权威，按字段裁决（判据单源在 `core/model-id.ts` 的 `resolveCapabilities`）：
 *  - **配置里 `models[]` 写的就是最终答案**（设置页可编辑；也是端点没公布的那些模型的
 *    唯一来源）；
 *  - **models.dev 提供自动值**（24h 缓存，断网沿用旧缓存）——「大小写兼容」在这里是
 *    现成的：`selectModelMeta` 两侧都小写化后再比；
 *  - **未知也是答案**：查不到就返回 undefined，界面按 id 渲染、仪表不画百分比。
 *
 * 一切都是 best-effort，绝不因查不到而挡住任何一次渲染。
 */
import {
  entryCapabilities,
  resolveCapabilities,
  sameModelId,
  type ConfiguredModel,
  type DiscoveredCapabilities,
  type ModelCapabilities,
  type ModelCatalogPort,
  type ModelOption,
} from '@nova-agent/core';
import type { Config } from './config.js';
import type { ModelMetaStore } from './model-meta.js';
import { resolveProvider } from './provider-store.js';

/** 一处 provider 的显示名：URL 解析不出来时退回原文。 */
export function endpointLabel(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

/** 配置里一条 `models[]` 条目的形状 —— 用 core 的公共形状，因为它同时是线上的形状。 */
export type ConfiguredModelEntry = ConfiguredModel;

/** models.dev 的一条记录 → 能力面（id / provider 不属于能力）。 */
function metaCapabilities(meta: DiscoveredCapabilities): ModelCapabilities {
  return entryCapabilities(meta);
}

/**
 * 建「元数据面」。
 *
 * `peek` 先走已加载的目录（同步、无网），未命中再异步查（可能触发一次后台刷新）——
 * 选择器打开时不该为显示名等一次网络。
 *
 * @param config - the loaded config (its `models[]` is the boot-time override).
 * @param store - the models.dev metadata store.
 * @param model - the model actually in force. NOT `config.provider.model`: the
 *   boot-time reconciliation may have corrected that spelling against the
 *   endpoint's catalog, and comparing against the raw config name would silently
 *   stop applying the override after such a correction.
 * @param readConfigured - the LIVE list reader. The settings page rewrites
 *   `models[]` while this process runs, so the menu must read it per open: a
 *   captured array would keep offering the pre-edit catalog until a restart,
 *   which reads to the operator as a save that did nothing. Defaults to the
 *   boot-time config, which is right for a surface with no live writer.
 * @returns the port `modelControl` consumes.
 */
export function createModelCatalogPort(
  config: Config,
  store: ModelMetaStore,
  model: string,
  readConfigured: () => Promise<readonly ConfiguredModelEntry[]> = async () => config.models ?? [],
): ModelCatalogPort {
  // The label follows the endpoint IN FORCE, not a captured `config.provider`:
  // this port outlives a provider switch (see `web-mode.ts`), and a menu headed
  // by the previous gateway's host would misname every row under it.
  const endpoint = resolveProvider(config);
  const baseURL = endpoint?.baseURL ?? '';
  /** The live entries, read once per lookup so one open sees one list. */
  const entries = async (): Promise<readonly ConfiguredModelEntry[]> =>
    await readConfigured().catch(() => config.models ?? []);
  const entryFor = async (id: string): Promise<ConfiguredModelEntry | undefined> =>
    (await entries()).find((entry) => sameModelId(entry.id, id));

  /** 一个 id 的完整选项：能力按 配置 > models.dev > 未知 逐字段合成。 */
  const option = async (id: string): Promise<ModelOption> => {
    const entry = await entryFor(id);
    const meta = store.peek(id, baseURL) ?? (await store.lookup(id, baseURL).catch(() => undefined));
    // `provider.contextWindow` 是历史字段，仍只在它确实描述**当前在役模型**时生效：
    // 它表达「这个窗口是给谁写的」，不是「所有模型都一样大」。读在役端点自己的覆盖。
    const legacy =
      sameModelId(id, model) && endpoint?.contextWindow !== undefined
        ? { contextWindow: endpoint.contextWindow }
        : undefined;
    const capabilities = resolveCapabilities(
      entry === undefined ? legacy : { ...entryCapabilities(entry), ...legacy },
      meta === undefined ? undefined : metaCapabilities(meta),
    );
    return {
      id,
      name: entry?.name ?? meta?.displayName ?? id,
      ...(capabilities.contextWindow !== undefined ? { contextWindow: capabilities.contextWindow } : {}),
      ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
    };
  };

  return {
    label: endpointLabel(baseURL),
    describe: async (id) => {
      const resolved = await option(id);
      return {
        name: resolved.name,
        ...(resolved.contextWindow !== undefined ? { contextWindow: resolved.contextWindow } : {}),
      };
    },
    capabilities: async (id) => (await option(id)).capabilities,
    /**
     * 自动值（models.dev），**不叠加**配置覆盖：设置页要用它做每字段的占位提示
     * （「自动」），让操作者看得见自己将要偏离的是什么。
     */
    automatic: async (id) => {
      const meta = store.peek(id, baseURL) ?? (await store.lookup(id, baseURL).catch(() => undefined));
      return meta === undefined ? undefined : metaCapabilities(meta);
    },
    // 非空即接管，且每次打开都重读；空列表与缺省同义（都是「问端点」），所以这里是
    // undefined 而不是空数组。这是函数而非数组：设置页会在进程运行中改写这份名单，
    // 捕获一份快照会让菜单一直显示改写前的目录，读起来像「保存没生效」。
    configured: async () => (await entries()).map((entry) => entry.id),
  };
}
