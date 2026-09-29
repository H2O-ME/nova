/**
 * 供应商在配置文件里的**形状**：类型、逐字段强制转换、以及写回时的字段顺序。
 *
 * 与 `config-providers.ts` 的分工是「形状 vs 操作」：这里只回答「一条供应商记录长
 * 什么样、怎么从不可信的 JSON 读出来、怎么写回去」，那里回答「清单怎么读、怎么整份
 * 替换、三个派生不变量怎么维护」。两个问题各自会随需求增长，所以它们是两个文件。
 *
 * 读写都走 **raw 文档**（`config-doc.ts`）：`loadConfig` 会把 `{env:NAME}` 展开成
 * 明文，把解析后的对象写回去就等于用密钥替换引用。
 */

/** 设置页写回的一项。`apiKey` 缺省 = 「保持已存密钥不变」。 */
export interface ProviderEntryInput {
  id: string;
  name?: string;
  baseURL: string;
  /**
   * 密钥。**缺省表示不修改**：浏览器从不持有已存密钥（只在保存那一刻见过明文），
   * 所以它无法回填；页面留空即保持原值。
   */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  models?: readonly ProviderModel[];
}

/** 一个供应商下的模型条目（与 `models[]` 顶层条目同一批字段）。 */
export interface ProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
}

/** 页面上的一行：凭据以「是否已设置」的形式过线，**永不回显明文**。 */
export interface StoredProvider {
  id: string;
  name?: string;
  baseURL: string;
  hasApiKey: boolean;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  models: readonly ProviderModel[];
}

/** 页面需要的一次性快照：清单 + 当前在役项。 */
export interface ProvidersSnapshot {
  providers: readonly StoredProvider[];
  activeId?: string;
}

/** 有限正整数，或 undefined。 */
export function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 字符串，或 undefined。 */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** 非空字符串列表，或 undefined。 */
export function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  return out.length === 0 ? undefined : out;
}

/** 布尔，或 undefined。 */
export function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** 一条 `models[]` 条目，逐字段显式复制。 */
export function modelEntry(raw: unknown): ProviderModel | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  const id = text(entry['id']);
  if (id === undefined) return undefined;
  const name = text(entry['name']);
  const contextWindow = positiveInt(entry['contextWindow']);
  const maxOutput = positiveInt(entry['maxOutput']);
  const inputModalities = stringList(entry['inputModalities']);
  const outputModalities = stringList(entry['outputModalities']);
  const attachment = boolValue(entry['attachment']);
  const reasoning = boolValue(entry['reasoning']);
  const toolCall = boolValue(entry['toolCall']);
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutput !== undefined ? { maxOutput } : {}),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
    ...(outputModalities !== undefined ? { outputModalities } : {}),
    ...(attachment !== undefined ? { attachment } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(toolCall !== undefined ? { toolCall } : {}),
  };
}

/** 一行供应商，逐字段显式复制；密钥只以 `hasApiKey` 过线。 */
export function providerEntry(raw: unknown): StoredProvider | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  const id = text(entry['id']);
  const baseURL = text(entry['baseURL']);
  if (id === undefined || baseURL === undefined) return undefined;
  const name = text(entry['name']);
  const temperature = typeof entry['temperature'] === 'number' ? entry['temperature'] : undefined;
  const maxTokens = positiveInt(entry['maxTokens']);
  const contextWindow = positiveInt(entry['contextWindow']);
  const models = Array.isArray(entry['models'])
    ? entry['models'].map(modelEntry).filter((item): item is ProviderModel => item !== undefined)
    : [];
  return {
    id,
    ...(name !== undefined ? { name } : {}),
    baseURL,
    hasApiKey: text(entry['apiKey']) !== undefined,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    models,
  };
}

/** 供应商清单的写入形状：字段顺序固定，文件保持可读。 */
export function providerDoc(entry: ProviderEntryInput, keepApiKey: string | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { id: entry.id, baseURL: entry.baseURL };
  if (entry.name !== undefined && entry.name.trim() !== '') out['name'] = entry.name.trim();
  // An omitted key means "keep whatever is stored": the browser never holds the
  // stored secret, so it cannot send it back, and writing `''` would erase it.
  const apiKey = entry.apiKey !== undefined && entry.apiKey !== '' ? entry.apiKey : keepApiKey;
  if (apiKey !== undefined) out['apiKey'] = apiKey;
  if (entry.temperature !== undefined) out['temperature'] = entry.temperature;
  if (entry.maxTokens !== undefined) out['maxTokens'] = entry.maxTokens;
  if (entry.contextWindow !== undefined) out['contextWindow'] = entry.contextWindow;
  const models = entry.models;
  if (models !== undefined && models.length > 0) out['models'] = models.map(modelDoc);
  return out;
}

/** 一条 `models[]` 条目 → 存储形状（空列表不是覆盖，见 `config-models.ts`）。 */
export function modelDoc(entry: ProviderModel): Record<string, unknown> {
  const out: Record<string, unknown> = { id: entry.id };
  if (entry.name !== undefined && entry.name.trim() !== '') out['name'] = entry.name.trim();
  for (const key of ['contextWindow', 'maxOutput'] as const) {
    const value = entry[key];
    if (value !== undefined) out[key] = value;
  }
  for (const key of ['inputModalities', 'outputModalities'] as const) {
    const value = entry[key];
    if (value !== undefined && value.length > 0) out[key] = [...value];
  }
  for (const key of ['attachment', 'reasoning', 'toolCall'] as const) {
    const value = entry[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
