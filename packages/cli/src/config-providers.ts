/**
 * 供应商清单的**持久化**（设置页「模型」页的上半部分）。
 *
 * 与 `config-models.ts` 同一条纪律，写的是另一个 section：整份替换、raw-document
 * 读写（绝不写回 `expandConfig` 展开后的对象，否则 `{env:NAME}` 会变明文）、
 * 空清单删键、字段逐个显式复制（手改过的文件不能塞进页面渲染不了的东西）。
 *
 * 与它分开成文件的原因：`config-models.ts` 管「一个供应商之下的模型名单」，这里管
 * 「有哪几个供应商」——两个不同的 section、两个不同的替换单位、两个不同的失败含义
 * （一个是「这个端点没有这个名字」，一个是「你把整个端点删了」）。
 */
import { docFile, patchConfig, plainMember, readDoc } from './config-doc.js';
import {
  positiveInt,
  providerDoc,
  providerEntry,
  text,
  type ProviderEntryInput,
  type ProvidersSnapshot,
  type StoredProvider,
} from './provider-doc.js';

/**
 * The record SHAPES and their coercion live in `provider-doc.ts` (shape vs
 * operation). Re-exported so a caller of this module — and the settings page's
 * frame handler — needs one import for the whole provider surface.
 */
export type { ProviderEntryInput, ProviderModel, ProvidersSnapshot, StoredProvider } from './provider-doc.js';

/**
 * The stored API key for one provider id, read from the RAW document.
 *
 * Raw, not from the loaded `Config`: `loadConfig` expands `{env:NAME}`, so the
 * loaded object holds either the secret (useful) or nothing (when the variable is
 * unset). Reading the raw text lets the caller apply the reference rule itself and
 * report "the variable is not set" instead of addressing the endpoint with the
 * literal `{env:MY_KEY}`.
 *
 * Returns `undefined` when nothing is stored. This is the ONLY reader of a stored
 * key, and its callers are the two server-side operations that need to make a
 * request (switching to a provider, re-probing a saved one) — the browser never
 * receives the value.
 * @param id - the provider's binding id.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the stored key text, or undefined.
 */
export async function storedApiKey(id: string, homedir?: string): Promise<string | undefined> {
  let doc: unknown;
  try {
    doc = await readDoc(docFile(homedir));
  } catch {
    return undefined;
  }
  const root = (typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? doc : {}) as Record<string, unknown>;
  const listed = root['providers'];
  if (Array.isArray(listed)) {
    for (const item of listed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      if (text(entry['id']) !== id) continue;
      return text(entry['apiKey']);
    }
  }
  // The legacy single-endpoint block is the `default` row (see `readProviders`).
  if (id === 'default') {
    const legacy = plainMember(root, 'provider');
    return legacy === undefined ? undefined : text(legacy['apiKey']);
  }
  return undefined;
}

/**
 * 读供应商清单（设置页打开时）。缺文件/缺 section 都是空清单——「还没配」与「配了空的」
 * 对页面是同一件事。
 *
 * **兼容老配置**：只有 `provider` 没有 `providers` 时，把老端点呈现为一条 id 为
 * `default` 的行，于是设置页第一次打开就能编辑它，而不是显示「还没有供应商」而把用户
 * 写好的端点藏起来。
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the snapshot the settings page renders.
 */
export async function readProviders(homedir?: string): Promise<ProvidersSnapshot> {
  let doc: unknown;
  try {
    doc = await readDoc(docFile(homedir));
  } catch {
    return { providers: [] };
  }
  const root = (typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? doc : {}) as Record<string, unknown>;
  const listed = root['providers'];
  const providers = Array.isArray(listed)
    ? listed.map(providerEntry).filter((item): item is StoredProvider => item !== undefined)
    : [];
  const activeId = text(root['activeProvider']);
  if (providers.length > 0) {
    return { providers, ...(activeId !== undefined ? { activeId } : {}) };
  }
  const legacy = plainMember(root, 'provider');
  const baseURL = legacy === undefined ? undefined : text(legacy['baseURL']);
  if (legacy === undefined || baseURL === undefined) return { providers: [] };
  const temperature = typeof legacy['temperature'] === 'number' ? legacy['temperature'] : undefined;
  const maxTokens = positiveInt(legacy['maxTokens']);
  const contextWindow = positiveInt(legacy['contextWindow']);
  return {
    providers: [
      {
        id: 'default',
        baseURL,
        hasApiKey: text(legacy['apiKey']) !== undefined,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        models: [],
      },
    ],
  };
}

/**
 * 整份替换供应商清单。同时维护三处派生，让文件里**没有互相矛盾的字段**：
 *
 *  1. `activeProvider` 必须指向一个存在的 id（否则删掉当前项会留下悬空指针）；
 *  2. 在役项的 `baseURL`/`apiKey` 镜像进老字段 `provider`——`provider.model` 仍是
 *     「当前模型」的唯一存储地，而所有仍读 `config.provider.baseURL` 的旧路径因此
 *     继续正确；
 *  3. 两项都空时删掉 `providers`/`activeProvider`，让文件回到空壳而不是留一个 `[]`。
 *
 * 镜像而非迁移：老配置**逐字节继续可用**，新配置也不会因为多写一个字段而失去
 * 「谁是当前端点」这个答案。
 * @param entries - the full list, in the order the page shows it.
 * @param activeId - the provider that should be in force, if any.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function saveProviders(
  entries: readonly ProviderEntryInput[],
  activeId: string | undefined,
  homedir?: string,
): Promise<void> {
  await patchConfig((doc) => {
    const usable = entries.filter((entry) => entry.id.trim() !== '' && entry.baseURL.trim() !== '');
    const previous = new Map<string, string>();
    const listed = doc['providers'];
    if (Array.isArray(listed)) {
      for (const item of listed) {
        const parsed = providerEntry(item);
        const raw = item as Record<string, unknown>;
        if (parsed !== undefined && text(raw['apiKey']) !== undefined) {
          previous.set(parsed.id, text(raw['apiKey']) as string);
        }
      }
    }
    // The legacy block is a source of the stored secret too: a page that edits a
    // migrated `default` row must not erase the key it is not allowed to see.
    const legacy = plainMember(doc, 'provider');
    const legacyKey = legacy === undefined ? undefined : text(legacy['apiKey']);
    if (usable.length === 0) {
      delete doc['providers'];
      delete doc['activeProvider'];
      return;
    }
    doc['providers'] = usable.map((entry) =>
      providerDoc(entry, previous.get(entry.id) ?? (entry.id === 'default' ? legacyKey : undefined)),
    );
    const active = usable.find((entry) => entry.id === activeId) ?? usable[0];
    if (active !== undefined) {
      doc['activeProvider'] = active.id;
      // Mirror into the legacy block so every path that still reads
      // `config.provider.baseURL` addresses the endpoint the operator chose.
      const stored = providerDoc(active, previous.get(active.id) ?? legacyKey);
      const mirror = plainMember(doc, 'provider') ?? {};
      mirror['baseURL'] = stored['baseURL'];
      if (stored['apiKey'] !== undefined) mirror['apiKey'] = stored['apiKey'];
      if (stored['temperature'] !== undefined) mirror['temperature'] = stored['temperature'];
      if (stored['maxTokens'] !== undefined) mirror['maxTokens'] = stored['maxTokens'];
      if (stored['contextWindow'] !== undefined) mirror['contextWindow'] = stored['contextWindow'];
      doc['provider'] = mirror;
    }
  }, homedir);
}