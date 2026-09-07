import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createModelMetaStore,
  formatModelMeta,
  parseModelCatalog,
  selectModelMeta,
  type ModelMeta,
} from '../src/model-meta.js';

const meta = (over: Partial<ModelMeta> & Pick<ModelMeta, 'id' | 'contextWindow'>): ModelMeta => ({
  provider: 'openrouter',
  inputModalities: ['text'],
  outputModalities: ['text'],
  ...over,
});

describe('parseModelCatalog', () => {
  it('flattens provider→models into the slim catalog', () => {
    const raw = {
      openrouter: {
        id: 'openrouter',
        models: {
          'qwen/qwen3.7-max': {
            id: 'qwen/qwen3.7-max',
            name: 'Qwen3.7 Max',
            reasoning: true,
            tool_call: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 1_000_000, output: 131_072 },
          },
          junk: { id: 'junk', limit: { context: 0 } }, // no window → dropped
          alsobroken: { id: 'alsobroken' }, // no limit → dropped
        },
      },
      notaprovider: 'string',
    };
    const catalog = parseModelCatalog(raw);
    expect(catalog).toHaveLength(1);
    const qwen = catalog[0]!;
    expect(qwen.id).toBe('qwen/qwen3.7-max');
    expect(qwen.provider).toBe('openrouter');
    expect(qwen.displayName).toBe('Qwen3.7 Max');
    expect(qwen.contextWindow).toBe(1_000_000);
    expect(qwen.maxOutput).toBe(131_072);
    expect(qwen.inputModalities).toEqual(['text', 'image']);
    expect(qwen.outputModalities).toEqual(['text']);
    expect(qwen.reasoning).toBe(true);
    expect(qwen.toolCall).toBe(true);
  });

  it('accepts the {providers:{...}} wrapper shape and garbage input', () => {
    const wrapped = parseModelCatalog({
      providers: {
        anthropic: { models: { 'claude-x': { id: 'claude-x', limit: { context: 200_000 } } } },
      },
    });
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]!.provider).toBe('anthropic');
    expect(wrapped[0]!.inputModalities).toEqual(['text']); // absent modalities default text
    expect(parseModelCatalog(null)).toEqual([]);
    expect(parseModelCatalog('nope')).toEqual([]);
    expect(parseModelCatalog({})).toEqual([]);
  });
});

describe('selectModelMeta', () => {
  const catalog: ModelMeta[] = [
    meta({ id: 'openai/gpt-5.2', provider: 'openrouter', contextWindow: 400_000 }),
    meta({ id: 'gpt-5.2', provider: 'openai', contextWindow: 256_000 }),
    meta({ id: 'azure/gpt-5.2', provider: 'azure', contextWindow: 128_000 }),
    meta({ id: 'qwen3.7-max', provider: 'qiniu', contextWindow: 1_000_000 }),
  ];

  it('prefers an exact id match', () => {
    expect(selectModelMeta(catalog, 'gpt-5.2')?.provider).toBe('openai');
    expect(selectModelMeta(catalog, 'openai/gpt-5.2')?.provider).toBe('openrouter');
  });

  it('falls back to the trailing path segment', () => {
    expect(selectModelMeta(catalog, 'QWEN3.7-MAX')?.contextWindow).toBe(1_000_000);
  });

  it('disambiguates equal names with the baseURL provider hint', () => {
    expect(
      selectModelMeta(catalog, 'x/gpt-5.2', 'https://azure-api.example.com/v1')?.provider,
    ).toBe('azure');
  });

  it('ties without a hint resolve to the largest window', () => {
    // 'gpt-5.2' exact only hits the openai entry; make a genuine 3-way tie:
    const tie = [
      meta({ id: 'a/dupe', contextWindow: 100 }),
      meta({ id: 'b/dupe', contextWindow: 300 }),
      meta({ id: 'c/dupe', contextWindow: 200 }),
    ];
    expect(selectModelMeta(tie, 'dupe')?.contextWindow).toBe(300);
  });

  it('returns undefined for unknown models and blank input', () => {
    expect(selectModelMeta(catalog, 'no-such-model')).toBeUndefined();
    expect(selectModelMeta(catalog, '  ')).toBeUndefined();
    expect(selectModelMeta([], 'gpt-5.2')).toBeUndefined();
  });
});

describe('createModelMetaStore', () => {
  const rawCatalog = {
    testprov: {
      id: 'testprov',
      models: { 'm-one': { id: 'm-one', limit: { context: 64_000 }, modalities: { input: ['text'], output: ['text'] } } },
    },
  };

  async function tempCacheFile(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-meta-'));
    return path.join(dir, 'models-dev.json');
  }

  it('fetches once, persists the slim catalog, and answers from it', async () => {
    const cacheFile = await tempCacheFile();
    let fetches = 0;
    let nowMs = 1_000;
    const store = createModelMetaStore({
      cacheFile,
      fetchRaw: async () => {
        fetches += 1;
        return rawCatalog;
      },
      now: () => nowMs,
    });
    expect((await store.lookup('m-one'))?.contextWindow).toBe(64_000);
    expect(fetches).toBe(1);
    const persisted = JSON.parse(await readFile(cacheFile, 'utf8')) as { fetchedAt: number; models: unknown[] };
    expect(persisted.fetchedAt).toBe(1_000);
    expect(persisted.models).toHaveLength(1);
    // Within the TTL nothing refetches; peek answers synchronously.
    nowMs = 2_000;
    expect((await store.lookup('m-one'))?.id).toBe('m-one');
    expect(fetches).toBe(1);
    expect(store.peek('m-one')?.contextWindow).toBe(64_000);
    expect(store.fetchedAt()).toBe(1_000);
    // Past the TTL the next lookup refetches.
    nowMs = 1_000 + 25 * 60 * 60 * 1000;
    expect((await store.lookup('m-one'))?.id).toBe('m-one');
    expect(fetches).toBe(2);
  });

  it('serves a fresh disk cache without touching the network', async () => {
    const cacheFile = await tempCacheFile();
    const seed = { fetchedAt: 5_000, models: [meta({ id: 'm-one', contextWindow: 32_000 })] };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(cacheFile, JSON.stringify(seed));
    let fetches = 0;
    const store = createModelMetaStore({
      cacheFile,
      fetchRaw: async () => {
        fetches += 1;
        return rawCatalog;
      },
      now: () => 6_000,
    });
    expect((await store.lookup('m-one'))?.contextWindow).toBe(32_000);
    expect(fetches).toBe(0);
  });

  it('keeps serving the stale catalog when the network fails', async () => {
    const cacheFile = await tempCacheFile();
    let mode: 'ok' | 'fail' = 'ok';
    let nowMs = 1_000;
    const store = createModelMetaStore({
      cacheFile,
      fetchRaw: async () => {
        if (mode === 'fail') throw new Error('offline');
        return rawCatalog;
      },
      now: () => nowMs,
    });
    expect((await store.lookup('m-one'))?.id).toBe('m-one');
    mode = 'fail';
    nowMs = 1_000 + 25 * 60 * 60 * 1000; // stale → forces refetch → fails
    expect((await store.lookup('m-one'))?.id).toBe('m-one'); // stale fallback
    expect(store.loaded()).toBe(true);
  });

  it('resolves undefined (not an error) when nothing is available', async () => {
    const store = createModelMetaStore({
      cacheFile: path.join(await tempCacheFile(), 'missing-dir', 'x.json'),
      fetchRaw: async () => {
        throw new Error('offline');
      },
    });
    expect(await store.lookup('whatever')).toBeUndefined();
    expect(store.peek('whatever')).toBeUndefined();
    expect(store.loaded()).toBe(false);
  });
});

describe('formatModelMeta', () => {
  it('renders a compact capability summary', () => {
    expect(
      formatModelMeta(
        meta({ id: 'm', contextWindow: 200_000, maxOutput: 128_000, inputModalities: ['text', 'image'], reasoning: true, toolCall: true }),
      ),
    ).toBe('text+image→text · 推理 · 工具 · 窗口 200k · 输出 128k');
  });
});
