import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { novaHome } from './config.js';
import { humanTokens } from "./lines.js";

/**
 * 模型元数据（上下文窗口、输入/输出模态、推理与工具调用能力），数据源
 * https://models.dev/api.json —— 213 个 provider 的开放目录。整包 JSON 有
 * ~4.5 MB，所以解析成只保留所需字段的精简目录后落盘缓存
 * （~/.nova/cache/models-dev.json，默认 24h TTL），启动时先读缓存、
 * 后台刷新；断网则继续用旧缓存，查不到就返回 undefined 由 UI 兜底。
 */

export const MODELS_DEV_URL = 'https://models.dev/api.json';

export interface ModelMeta {
  /** models.dev 中的模型 id（可能自带 provider 前缀，如 "qwen/qwen3.7-max"）。 */
  id: string;
  /** 收录该模型的 provider id（如 "openrouter"、"anthropic"）。 */
  provider: string;
  displayName?: string;
  /** 上下文窗口（prompt tokens）。 */
  contextWindow: number;
  /** 单次输出上限（completion tokens）。 */
  maxOutput?: number;
  inputModalities: string[];
  outputModalities: string[];
  reasoning?: boolean;
  toolCall?: boolean;
  /** 是否接受文件/图片附件。 */
  attachment?: boolean;
}

interface CachedCatalog {
  fetchedAt: number;
  models: ModelMeta[];
}

function strArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : undefined;
}

/**
 * 把 models.dev 原始 JSON 拍平成精简目录。兼容两种顶层形态：直接的
 * provider 映射表，或 `{ providers: {...} }` 包裹（官方 schema 演进过）。
 * 没有正数 context 上限的条目直接丢弃——它们喂不了进度条。
 */
export function parseModelCatalog(raw: unknown): ModelMeta[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const root = raw as Record<string, unknown>;
  const providers = (
    typeof root['providers'] === 'object' && root['providers'] !== null
      ? root['providers']
      : root
  ) as Record<string, unknown>;
  const out: ModelMeta[] = [];
  for (const [providerKey, value] of Object.entries(providers)) {
    if (typeof value !== 'object' || value === null) continue;
    const provider = value as Record<string, unknown>;
    const models = provider['models'];
    if (typeof models !== 'object' || models === null) continue;
    const providerId = typeof provider['id'] === 'string' ? provider['id'] : providerKey;
    for (const [modelKey, modelValue] of Object.entries(models as Record<string, unknown>)) {
      if (typeof modelValue !== 'object' || modelValue === null) continue;
      const model = modelValue as Record<string, unknown>;
      const limit = (typeof model['limit'] === 'object' && model['limit'] !== null
        ? model['limit']
        : {}) as Record<string, unknown>;
      const context = limit['context'];
      if (typeof context !== 'number' || !Number.isFinite(context) || context <= 0) continue;
      const modalities = (typeof model['modalities'] === 'object' && model['modalities'] !== null
        ? model['modalities']
        : {}) as Record<string, unknown>;
      const output = limit['output'];
      out.push({
        id: typeof model['id'] === 'string' ? model['id'] : modelKey,
        provider: providerId,
        ...(typeof model['name'] === 'string' ? { displayName: model['name'] } : {}),
        contextWindow: context,
        ...(typeof output === 'number' && Number.isFinite(output) && output > 0 ? { maxOutput: output } : {}),
        inputModalities: strArray(modalities['input']) ?? ['text'],
        outputModalities: strArray(modalities['output']) ?? ['text'],
        ...(typeof model['reasoning'] === 'boolean' ? { reasoning: model['reasoning'] } : {}),
        ...(typeof model['tool_call'] === 'boolean' ? { toolCall: model['tool_call'] } : {}),
        ...(typeof model['attachment'] === 'boolean' ? { attachment: model['attachment'] } : {}),
      });
    }
  }
  return out;
}

/** 归一化模型名（去首尾空白、小写、去引号别名后缀）。 */
function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

/**
 * 从目录中挑出最匹配的一条。策略：全 id 精确 → 尾段精确（"openai/gpt-5"
 * 匹配 "gpt-5"）→ 包含式前缀候选；同名多 provider 冲突时用 baseURL 里的
 * provider 线索消歧，仍平手取上下文窗口最大的一条。
 */
export function selectModelMeta(catalog: ModelMeta[], model: string, baseURL?: string): ModelMeta | undefined {
  const target = normalizeModel(model);
  if (target.length === 0) return undefined;
  const tail = (id: string): string => id.toLowerCase().split(/[/:]/).pop() ?? '';
  let matches = catalog.filter((m) => normalizeModel(m.id) === target);
  if (matches.length === 0) {
    // 尾段匹配双向：目录 id "openai/gpt-5" 匹配配置 "gpt-5"，
    // 反过来配置 "deploy/gpt-5" 也匹配目录 "gpt-5"。
    const targetTail = tail(target);
    matches = catalog.filter((m) => tail(m.id) === targetTail);
  }
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  if (baseURL !== undefined) {
    const url = baseURL.toLowerCase();
    const hinted = matches.find((m) => url.includes(m.provider.toLowerCase()));
    if (hinted !== undefined) return hinted;
  }
  return matches.reduce((best, m) => (m.contextWindow > best.contextWindow ? m : best));
}

export interface ModelMetaStore {
  /** 查当前模型的元数据；触发（可能后台化的）加载。永不 reject。 */
  lookup(model: string, baseURL?: string): Promise<ModelMeta | undefined>;
  /** 同步查已加载的目录（渲染循环用；目录没加载完就返回 undefined）。 */
  peek(model: string, baseURL?: string): ModelMeta | undefined;
  /** 目录最近一次成功拉取的时间戳（内存或磁盘），用于渲染缓存 key。 */
  fetchedAt(): number | undefined;
  loaded(): boolean;
}

export interface ModelMetaStoreOptions {
  url?: string;
  ttlMs?: number;
  cacheFile?: string;
  /** 注入点：测试与受限环境下替换网络与磁盘实现。 */
  fetchRaw?: (url: string) => Promise<unknown>;
  now?: () => number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function modelMetaCacheFile(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'cache', 'models-dev.json');
}

async function defaultFetchRaw(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'nova-agent' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

export function createModelMetaStore(options: ModelMetaStoreOptions = {}): ModelMetaStore {
  const url = options.url ?? MODELS_DEV_URL;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cacheFile = options.cacheFile ?? modelMetaCacheFile();
  const now = options.now ?? (() => Date.now());
  const fetchRaw = options.fetchRaw ?? defaultFetchRaw;

  let catalog: ModelMeta[] | undefined;
  let fetchedAt: number | undefined;
  let loading: Promise<void> | undefined;

  async function loadFromDisk(): Promise<boolean> {
    try {
      const raw = await readFile(cacheFile, 'utf8');
      const cached = JSON.parse(raw) as Partial<CachedCatalog>;
      if (!Array.isArray(cached.models)) return false;
      catalog = cached.models.filter(
        (m): m is ModelMeta =>
          typeof m === 'object' && m !== null && typeof m.id === 'string' && typeof m.contextWindow === 'number',
      );
      fetchedAt = typeof cached.fetchedAt === 'number' ? cached.fetchedAt : 0;
      return true;
    } catch {
      return false;
    }
  }

  async function fetchAndStore(): Promise<void> {
    const raw = await fetchRaw(url);
    const parsed = parseModelCatalog(raw);
    if (parsed.length === 0) throw new Error('models.dev 目录为空或格式不识别');
    catalog = parsed;
    fetchedAt = now();
    // 落盘失败只影响下次冷启动速度，不影响本次使用。
    try {
      await mkdir(path.dirname(cacheFile), { recursive: true });
      const payload: CachedCatalog = { fetchedAt, models: parsed };
      await writeFile(cacheFile, JSON.stringify(payload));
    } catch {
      /* best-effort cache */
    }
  }

  async function ensureFresh(): Promise<void> {
    if (catalog === undefined) await loadFromDisk();
    if (catalog !== undefined && fetchedAt !== undefined && now() - fetchedAt < ttlMs) return;
    await fetchAndStore();
  }

  function startLoad(): Promise<void> {
    loading ??= ensureFresh()
      .catch(() => {
        /* 断网/解析失败：保留旧目录（若有），下次再试 */
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  return {
    async lookup(model, baseURL) {
      await startLoad();
      return catalog === undefined ? undefined : selectModelMeta(catalog, model, baseURL);
    },
    peek(model, baseURL) {
      return catalog === undefined ? undefined : selectModelMeta(catalog, model, baseURL);
    },
    fetchedAt() {
      return fetchedAt;
    },
    loaded() {
      return catalog !== undefined;
    },
  };
}

/** 一行人类可读的能力摘要（/session 详情用）：`text+image→text · 推理 · 工具 · 窗口 200k · 输出 128k`。 */
export function formatModelMeta(meta: ModelMeta): string {
  const parts = [`${meta.inputModalities.join('+')}→${meta.outputModalities.join('+')}`];
  if (meta.reasoning === true) parts.push('推理');
  if (meta.toolCall === true) parts.push('工具');
  if (meta.attachment === true) parts.push('附件');
  parts.push(`窗口 ${humanTokens(meta.contextWindow)}`);
  if (meta.maxOutput !== undefined) parts.push(`输出 ${humanTokens(meta.maxOutput)}`);
  return parts.join(' · ');
}
