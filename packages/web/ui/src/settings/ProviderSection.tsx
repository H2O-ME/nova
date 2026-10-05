/**
 * 供应商（BYOK）编辑区：设置页「模型」页——**哪个端点在役**。
 *
 * 版式对齐 deepseek-harness `ui-settings-models`（`src/client/ModelsSection.tsx` +
 * `ModelsSection.module.css` + `EditorFooter.tsx`，MIT，(c) 2026 DeepSeek）：每个
 * 供应商是一张卡，卡头左边是身份（名称 + 标记 + 密钥点），右边是行内动作（编辑 /
 * 设为当前 / 删除）；一次只展开一张卡；「添加模型提供商」是列表末尾的虚线整行按钮，
 * 展开成同一形态的添加卡。
 *
 * **每张卡自己保存**（参考实现的 `EditorFooter` 模式：取消居左、提交居右）。写盘单位
 * 仍是整份 `providers[]` 清单（`save_providers` 协议如此），但保存动作出现在被编辑的
 * 那张卡里——「保存」保存的是这张卡，其余卡的未存改动原样保留。页尾不再有孤立的
 * 保存按钮与散落的说明：谁属于哪张卡就写在哪张卡里。
 *
 * 本仓与参考实现的差异，都有理由：
 *  - **请求参数（temperature / maxTokens / contextWindow）在卡内**：schema
 *    （`cli/src/config-schema-models.ts`）把这三个字段放在 provider 条目上，而
 *    `models[]` 条目是 `.strict()` 的——写进去会让整份配置加载失败。
 *  - **「设为当前」发的是 `set_provider`，不是带 `activeId` 的 `save_providers`**：
 *    只有前者会 `ChatProvider.setEndpoint` 就地改写在役客户端；带指针的保存会把
 *    「当前使用」写进文件却把请求留在旧端点上。前置条件（已存进文件、已有密钥）
 *    不满足时按钮禁用并写明原因。
 *  - **删除立刻生效**：整份替换的协议下，一次删除就是一次保存——「删了还要再按
 *    保存」曾让读者以为删除没点上。写盘是可再添加的（重新填一张卡即可），所以
 *    不设确认弹窗。
 *  - **端点一换就补问模型目录的数据**：切换后目录还属于旧端点（`state.catalog`
 *    只由帧驱动），而壳把两段拼成兄弟节点，所以由发起切换的这一段补问。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsSection } from './Section.js';
import { parseCapacityField } from './ModelConfigEditor.js';
import { ProviderModelsPicker } from './ProviderModelsDialog.js';
import { cls } from '../sidebar/view.js';
import type { ClientFrame } from '../types.js';
import type { WireProviderModel, WireProviderRow } from '../types.js';
import type { ProvidersSnapshot, ProviderProbe } from '../state.js';
import css from './ProviderSection.module.css';

/**
 * The config schema's bounds for the three request parameters
 * (`cli/src/config-schema-models.ts`). Checked HERE as well as there because the
 * config file is loaded through a `.strict()` zod schema: a temperature of `3`
 * written to disk does not degrade — it makes the whole file fail to load, so
 * every surface then starts with no configuration at all. The field is refused
 * before the write instead of stored-and-broken.
 */
const MAX_TEMPERATURE = 2;
const MAX_MAX_TOKENS = 1_000_000;
const MAX_PROVIDER_CONTEXT_WINDOW = 200_000_000;

/** One numeric field's outcome: a value, "clear" (blank = no override), or a reason. */
type Fielded = { ok: true; value: number | undefined } | { ok: false; key: keyof typeof SETTINGS_COPY };

/** 编辑中的一行：数字字段保持文本态（逐击键写回数字会把 `256K` 改写成 `256000`）。 */
interface ProviderDraft {
  /** Stable binding id; only a new row mints one, a stored row keeps its own. */
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
  contextWindow: string;
  /**
   * FULL model entries, not bare ids: `providers[].models` rows carry per-model
   * overrides (name / window / modality caps), and collapsing them to ids on the
   * way into the draft silently ERASED every override the moment a card was
   * saved. A hand-typed addition is an id-only entry; a stored one round-trips
   * field for field.
   */
  models: readonly WireProviderModel[];
}

export interface ProviderSectionProps {
  /** The host's snapshot; null until the section's first answer lands. */
  providers: ProvidersSnapshot | null;
  /** The last probe answer (or its in-flight marker). */
  probe: ProviderProbe | null;
  send: (frame: ClientFrame) => void;
}

/** 造一个本地 id：稳定、可读、不含大写（线上校验器只收小写标识）。 */
function newProviderId(existing: readonly string[]): string {
  let index = existing.length + 1;
  while (existing.includes(`p${String(index)}`)) index += 1;
  return `p${String(index)}`;
}

/**
 * The endpoint's display name when the operator typed none: the URL's host.
 *
 * The same rule the host applies when it resolves the endpoint
 * (`cli/src/provider-store.ts` `hostLabel`), so the row names the endpoint the
 * way a request addresses it rather than echoing the whole URL.
 */
function hostLabel(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

/** 采样温度：0..2，可小数；空即「无覆盖」。 */
function parseTemperatureField(text: string): Fielded {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: undefined };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, key: 'models.configInvalidTemperature' };
  if (value < 0 || value > MAX_TEMPERATURE) return { ok: false, key: 'models.configRangeExceeded' };
  return { ok: true, value };
}

/** A row's text for a numeric field: the stored number, or empty for "no override". */
function fieldText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * A stored row → a draft.
 *
 * The API key is ALWAYS empty, stored or not: the browser never receives the
 * value (the wire carries `hasApiKey`), so a pre-filled field would be a lie the
 * save could then persist. An empty field means "keep whatever is stored".
 */
function toProviderDraft(entry: WireProviderRow): ProviderDraft {
  return {
    id: entry.id,
    name: entry.name ?? '',
    baseURL: entry.baseURL,
    apiKey: '',
    temperature: fieldText(entry.temperature),
    maxTokens: fieldText(entry.maxTokens),
    contextWindow: fieldText(entry.contextWindow),
    models: entry.models.map((model) => ({ ...model })),
  };
}

/** One row of a `save_providers` frame (the frame union is the single owner of the shape). */
type WireProviderRowInput = Extract<ClientFrame, { type: 'save_providers' }>['providers'][number];

/** 草稿行 → 线上条目；任何一个字段读不出来就整行拒绝（不静默丢字段）。 */
function toInputRow(row: ProviderDraft): { ok: true; entry: WireProviderRowInput } | { ok: false; key: keyof typeof SETTINGS_COPY } {
  const temperature = parseTemperatureField(row.temperature);
  if (!temperature.ok) return temperature;
  const maxTokens = parseCapacityField(row.maxTokens, MAX_MAX_TOKENS);
  if (!maxTokens.ok) return maxTokens;
  const contextWindow = parseCapacityField(row.contextWindow, MAX_PROVIDER_CONTEXT_WINDOW);
  if (!contextWindow.ok) return contextWindow;
  return {
    ok: true,
    entry: {
      id: row.id,
      baseURL: row.baseURL.trim(),
      ...(row.name.trim() !== '' ? { name: row.name.trim() } : {}),
      // Omitted, not empty: an untouched field must not erase the stored key the
      // browser was never allowed to read.
      ...(row.apiKey !== '' ? { apiKey: row.apiKey } : {}),
      // Written as `undefined` on purpose: an emptied field must REMOVE the stored
      // override (the JSON frame drops the key and the host's own writer copies
      // only defined fields), so "blank" and "0" stay different facts.
      temperature: temperature.value,
      maxTokens: maxTokens.value,
      contextWindow: contextWindow.value,
      ...(row.models.length > 0 ? { models: row.models.map((model) => ({ ...model })) } : {}),
    },
  };
}

/** 一张卡的逐字段体检：空 = 这张卡可以写盘。导出给测试车道（校验是纯逻辑）。 */
export function draftProblem(row: ProviderDraft): string | null {
  const fields = [
    parseTemperatureField(row.temperature),
    parseCapacityField(row.maxTokens, MAX_MAX_TOKENS),
    parseCapacityField(row.contextWindow, MAX_PROVIDER_CONTEXT_WINDOW),
  ] as const;
  for (const result of fields) {
    if (!result.ok) return SETTINGS_COPY[result.key];
  }
  if (row.baseURL.trim() === '') return SETTINGS_COPY['models.providerNoUrl'];
  return null;
}

/**
 * Render the 供应商 section.
 * @param props - see ProviderSectionProps.
 * @returns the section element tree.
 */
export function ProviderSection({ providers, probe, send }: ProviderSectionProps): JSX.Element {
  // On demand, every open: the file is the authority and the operator may have
  // hand-edited it (or another window may have saved), so a cached list could lie.
  useEffect(() => {
    send({ type: 'list_providers' });
  }, [send]);

  const stored = providers?.providers ?? [];
  const activeId = providers?.activeId;
  /** 只记**被改过**的那几行：其余卡与已存内容逐字相同，不必进草稿。 */
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  /** 展开中的卡；null = 全部收起。 */
  const [openId, setOpenId] = useState<string | null>(null);
  /** 末尾的添加卡（未保存过，所以永远不在 `stored` 里）。 */
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<ProviderDraft | null>(null);
  const [manualModel, setManualModel] = useState('');
  const [probeTarget, setProbeTarget] = useState<string | null>(null);

  // The endpoint in force changed under us (a switch, or another window's save):
  // the catalog belongs to the NEW endpoint, and no other section can see that it
  // went stale. Re-asked only on a CHANGE, so the first answer never costs a
  // second round trip.
  const seenActive = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeId === undefined) return;
    if (seenActive.current === activeId) return;
    const first = seenActive.current === undefined;
    seenActive.current = activeId;
    if (first) return;
    send({ type: 'list_models' });
    send({ type: 'list_model_config' });
  }, [activeId, send]);

  /** A row's editable draft: the local edit when there is one, the stored row otherwise. */
  const draftOf = (entry: WireProviderRow): ProviderDraft => drafts[entry.id] ?? toProviderDraft(entry);
  const update = (row: ProviderDraft, patch: Partial<ProviderDraft>): void => {
    const next = { ...row, ...patch };
    setDrafts((current) => ({ ...current, [row.id]: next }));
    if (adding && newDraft !== null && row.id === newDraft.id) setNewDraft(next);
  };
  const patchNew = (patch: Partial<ProviderDraft>): void => {
    if (newDraft === null) return;
    setNewDraft({ ...newDraft, ...patch });
  };

  /**
   * 整份清单的构造：协议是整份替换，所以每次写盘都带全量。
   *
   * `only` 是**这次保存的那张卡**：只有它的草稿参与，其余行一律用**已存内容**。
   * 否则保存 B 卡会把 A 卡还没保存的编辑一起写进去——一次点击写了两张卡的内容，
   * 而读者只按了一次「保存」。
   */
  const buildList = (only: string): WireProviderRowInput[] | undefined => {
    const built: WireProviderRowInput[] = [];
    for (const entry of stored) {
      const parsed = toInputRow(entry.id === only ? draftOf(entry) : toProviderDraft(entry));
      if (!parsed.ok) return undefined;
      built.push(parsed.entry);
    }
    if (adding && newDraft !== null && newDraft.id === only) {
      const parsed = toInputRow(newDraft);
      if (!parsed.ok) return undefined;
      built.push(parsed.entry);
    }
    return built;
  };

  /** 保存一张卡：只写它的草稿，其余照已存内容。**宿主的 `providers` 帧到达后才**
      回到「已存」态（见 `pendingSave`）——写盘被拒绝时草稿还在，读者改一字再存即可。 */
  const saveCard = (id: string): void => {
    const input = buildList(id);
    if (input === undefined) return;
    setPendingSave(id);
    send({ type: 'save_providers', providers: input, ...(activeId !== undefined ? { activeId } : {}) });
  };
  // The save's ACK is the `providers` frame (the file is the truth, the frame is
  // its echo). Only then does the saved card drop its draft: clearing on SEND
  // meant a refused write (no writer, schema bound, dup id) silently threw away
  // exactly the text the reader was still looking at.
  const [pendingSave, setPendingSave] = useState<string | null>(null);
  useEffect(() => {
    if (providers === null || pendingSave === null) return;
    const id = pendingSave;
    setPendingSave(null);
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (newDraft !== null && newDraft.id === id) {
      setAdding(false);
      setNewDraft(null);
    }
  }, [providers, pendingSave, newDraft]);
  /** 取消一张卡：丢掉它的草稿（添加卡则整个收起），已存内容原样。 */
  const cancelCard = (id: string): void => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (newDraft !== null && newDraft.id === id) {
      setAdding(false);
      setNewDraft(null);
    }
    setOpenId(null);
  };
  /** 删除即保存：整份替换的协议下，清单里去掉这一行就是一次写盘。删的是**当前**
      供应商时，指针显式重指到剩下的第一行——把「删掉当前项之后用哪一行」写成帧里
      的事实，而不是让宿主的回落规则替读者猜（两边的答案今天相同，但显式重指让
      「保存了什么」与「页面显示什么」永远一致）。 */
  const removeRow = (id: string): void => {
    const built: WireProviderRowInput[] = [];
    for (const entry of stored) {
      if (entry.id === id) continue;
      const parsed = toInputRow(toProviderDraft(entry));
      if (!parsed.ok) return;
      built.push(parsed.entry);
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (openId === id) setOpenId(null);
    const rePointed = id === activeId ? built[0]?.id : activeId;
    send({
      type: 'save_providers',
      providers: built,
      ...(rePointed !== undefined ? { activeId: rePointed } : {}),
    });
  };
  const startAdd = (): void => {
    const id = newProviderId(stored.map((entry) => entry.id));
    setAdding(true);
    setNewDraft({ id, name: '', baseURL: '', apiKey: '', temperature: '', maxTokens: '', contextWindow: '', models: [] });
    setOpenId(id);
  };
  const addModelTo = (row: ProviderDraft, id: string): void => {
    const trimmed = id.trim();
    if (trimmed === '' || row.models.some((model) => model.id === trimmed)) return;
    update(row, { models: [...row.models, { id: trimmed }] });
    setManualModel('');
  };

  /**
   * The probe's state. `pending` comes from the reducer (set when the frame goes
   * OUT, cleared when the host's answer lands) and `probeTarget` is this control's
   * own memory of which address it asked about — the answer is rendered only when
   * the two agree, so a late reply for edited text is dropped.
   */
  const probePending = probe?.pending === true;
  const answer = probe !== null && !probe.pending ? probe : null;
  const pool = answer !== null && answer.ok ? answer.models : [];
  /**
   * 探针问的是**哪一张卡**：答案按地址归属，地址不等于 `probeTarget` 的答案不是
   * 这一张的。`poolOpen` 只在答案**成功**时为真——失败没有可挑的东西，那一行留在
   * 卡片里（见 `renderEditor` 的 `poolFail`）。
   */
  const probeRow = probeTarget === null
    ? undefined
    : stored.find((entry) => entry.baseURL.trim() === probeTarget);
  const poolOpen = probeRow !== undefined && answer !== null && answer.ok;
  const loading = providers === null;
  const storedIds = new Set(stored.map((entry) => entry.id));
  const storedKey = new Map(stored.map((entry) => [entry.id, entry.hasApiKey]));

  /** 一张卡（已存或添加中）的编辑器体：字段 + 卡脚。 */
  const renderEditor = (row: ProviderDraft, isNew: boolean): JSX.Element => {
    const hasKey = storedKey.get(row.id) === true;
    const problem = draftProblem(row);
    const canSave = problem === null && (isNew || drafts[row.id] !== undefined);
    const write = (patch: Partial<ProviderDraft>): void => {
      if (isNew) patchNew(patch);
      else update(row, patch);
    };
    return (
      <div className={css.editor}>
        <div className={css.fields}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerName']}</span>
            <input
              className={css.input}
              value={row.name}
              placeholder={SETTINGS_COPY['models.providerNamePlaceholder']}
              aria-label={`${SETTINGS_COPY['models.providerName']} ${row.id}`}
              onChange={(event) => { write({ name: event.currentTarget.value }); }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerBaseUrl']}</span>
            <input
              className={css.input}
              value={row.baseURL}
              placeholder={SETTINGS_COPY['models.providerBaseUrlPlaceholder']}
              aria-label={`${SETTINGS_COPY['models.providerBaseUrl']} ${row.id}`}
              spellCheck={false}
              onChange={(event) => { write({ baseURL: event.currentTarget.value }); }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerApiKey']}</span>
            <input
              className={css.input}
              type="password"
              value={row.apiKey}
              placeholder={hasKey
                ? SETTINGS_COPY['models.providerApiKeySet']
                : SETTINGS_COPY['models.providerApiKeyPlaceholder']}
              aria-label={`${SETTINGS_COPY['models.providerApiKey']} ${row.id}`}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => { write({ apiKey: event.currentTarget.value }); }}
            />
            {/* The one fact this field needs, said where the field is: the empty
                box is "keep it", not "erase it". */}
            <p className={css.fieldHint}>{SETTINGS_COPY['models.providerApiKeyHint']}</p>
          </label>
        </div>

        {/* 请求参数：端点的采样参数，随端点保存（模型能力在「高级」里）。 */}
        <fieldset className={css.params}>
          <legend className={css.paramsLegend}>{SETTINGS_COPY['models.providerParams']}</legend>
          <div className={css.fields}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{SETTINGS_COPY['models.temperature']}</span>
              <input
                className={css.input}
                inputMode="decimal"
                value={row.temperature}
                placeholder={SETTINGS_COPY['models.temperatureHint']}
                aria-label={`${SETTINGS_COPY['models.temperature']} ${row.id}`}
                onChange={(event) => { write({ temperature: event.currentTarget.value }); }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{SETTINGS_COPY['models.maxTokens']}</span>
              <input
                className={css.input}
                inputMode="numeric"
                value={row.maxTokens}
                placeholder={SETTINGS_COPY['models.providerCapacityPlaceholder']}
                aria-label={`${SETTINGS_COPY['models.maxTokens']} ${row.id}`}
                onChange={(event) => { write({ maxTokens: event.currentTarget.value }); }}
              />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{SETTINGS_COPY['models.contextWindow']}</span>
              <input
                className={css.input}
                inputMode="numeric"
                value={row.contextWindow}
                placeholder={SETTINGS_COPY['models.providerCapacityPlaceholder']}
                aria-label={`${SETTINGS_COPY['models.contextWindow']} ${row.id}`}
                onChange={(event) => { write({ contextWindow: event.currentTarget.value }); }}
              />
            </label>
          </div>
          <p className={css.fieldHint}>{SETTINGS_COPY['models.providerParamsHint']}</p>
        </fieldset>

        {/* 该供应商名下的模型清单（`providers[].models`）。 */}
        <div className={css.models}>
          <div className={css.modelsHead}>
            <span className={css.blockTitle}>{SETTINGS_COPY['models.providerModels']}</span>
            <button
              type="button"
              className={css.linkButton}
              data-provider-probe={row.id}
              disabled={probePending || row.baseURL.trim() === ''}
              title={row.baseURL.trim() === '' ? SETTINGS_COPY['models.providerProbeNeedsUrl'] : undefined}
              onClick={() => {
                setProbeTarget(row.baseURL.trim());
                send({
                  type: 'probe_provider',
                  baseURL: row.baseURL.trim(),
                  // Only a freshly-typed key travels; an empty field means the
                  // host should reuse the stored one (it never left the server).
                  ...(row.apiKey !== '' ? { apiKey: row.apiKey } : {}),
                });
              }}
            >
              {probePending ? SETTINGS_COPY['models.providerProbing'] : SETTINGS_COPY['models.providerProbe']}
            </button>
          </div>
          {row.models.length === 0 && <p className={css.fieldHint}>{SETTINGS_COPY['models.providerModelsEmpty']}</p>}
          {row.models.length > 0 && (
            <ul className={css.modelChips}>
              {row.models.map((model) => (
                <li key={model.id} className={css.modelChip}>
                  <span className={css.modelChipId}>{model.id}</span>
                  <button
                    type="button"
                    className={css.chipRemove}
                    data-provider-model-remove={model.id}
                    aria-label={`${SETTINGS_COPY['models.providerModelsRemove']} ${model.id}`}
                    title={SETTINGS_COPY['models.providerModelsRemove']}
                    onClick={() => { update(row, { models: row.models.filter((entry) => entry.id !== model.id) }); }}
                  >
                    {SETTINGS_COPY['models.providerModelsRemove']}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={css.addRow}>
            <input
              className={css.input}
              value={manualModel}
              placeholder={SETTINGS_COPY['models.providerAddModelPlaceholder']}
              aria-label={`${SETTINGS_COPY['models.providerAddModel']} ${row.id}`}
              spellCheck={false}
              onChange={(event) => { setManualModel(event.currentTarget.value); }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addModelTo(row, manualModel);
              }}
            />
            <button
              type="button"
              className={css.button}
              data-provider-model-add
              disabled={manualModel.trim() === ''}
              onClick={() => { addModelTo(row, manualModel); }}
            >
              {SETTINGS_COPY['models.providerAddModel']}
            </button>
          </div>
          {/* 探针的**失败**留在卡里：答案没来就没有可挑的东西，弹窗无从谈起，
              而「为什么没来」正是读者此刻要看的那一行。成功则交给弹窗（见下方
              的 `ProviderModelsPicker`）——它才是挑模型的地方。 */}
          {probeTarget === row.baseURL.trim() && answer !== null && !answer.ok && (
            <div className={css.poolFail} data-provider-pool-fail={row.id} role="alert">
              <span>{SETTINGS_COPY['models.providerProbeFail']}</span>
              {answer.message !== undefined && <p className={css.error}>{answer.message}</p>}
            </div>
          )}
        </div>

        {/* 卡脚（参考实现的 `EditorFooter`）：取消居左、提交居右。保存这张卡 =
            整份清单写盘一次；被拒的原因写在这一行里，不弹窗。 */}
        <div className={css.cardFooter}>
          {problem !== null && <p className={css.problem} role="alert">{problem}</p>}
          <button
            type="button"
            className={css.cancelButton}
            data-provider-cancel={row.id}
            onClick={() => { cancelCard(row.id); }}
          >
            {SETTINGS_COPY['models.providerCancel']}
          </button>
          <button
            type="button"
            className={css.saveButton}
            data-provider-save-card={row.id}
            disabled={!canSave}
            onClick={() => { saveCard(row.id); }}
          >
            {SETTINGS_COPY['models.providerSave']}
          </button>
        </div>
      </div>
    );
  };

  return (
    <SettingsSection>
      <h2 className={css.heading}>{SETTINGS_COPY['models.title']}</h2>
      <p className={css.intro}>{SETTINGS_COPY['models.intro']}</p>
      <h3 className={css.sectionTitle}>{SETTINGS_COPY['models.providerTitle']}</h3>
      <p className={css.sectionIntro}>{SETTINGS_COPY['models.providerIntro']}</p>
      {loading && <div className={css.status}>{SETTINGS_COPY['models.providerLoading']}</div>}
      {!loading && stored.length === 0 && !adding && (
        <div className={css.notice}>{SETTINGS_COPY['models.providerEmpty']}</div>
      )}

      <ul className={css.rows}>
        {stored.map((entry) => {
          const row = draftOf(entry);
          const isActive = entry.id === activeId;
          const open = openId === entry.id;
          const hasKey = storedKey.get(entry.id) === true;
          // The switch's precondition is the FILE's content, not any draft:
          // `set_provider` reads the stored list. Each refusal says which one it is
          // — the two reasons are different jobs (write the row / paste a key), so
          // they must not be swapped: a stored-but-keyless row that says "保存供应商
          // 再切换" sends the reader to a save that changes nothing.
          const canActivate = storedIds.has(entry.id) && hasKey && !isActive;
          const blocked = !storedIds.has(entry.id)
            ? SETTINGS_COPY['models.providerSaveFirst']
            : SETTINGS_COPY['models.providerKeyMissing'];
          return (
            <li
              key={entry.id}
              className={cls(css.card, isActive && css.cardActive)}
              data-provider={entry.id}
              data-active={isActive ? 'true' : undefined}
            >
              <div className={css.rowHead}>
                <span className={css.rowIdentity}>
                  <span className={css.rowName}>{row.name.trim() !== '' ? row.name.trim() : hostLabel(row.baseURL)}</span>
                  {/* 活动项：一个词，不靠顺序暗示。 */}
                  {isActive && <span className={css.activeTag}>{SETTINGS_COPY['models.providerActive']}</span>}
                  {/* 密钥状态只在**缺**的时候说，且用词说：缺密钥正是「设为当前」
                      按不动的那个原因，所以这句话解释的是它旁边那颗灰按钮。配好
                      了则一个字都不印——那颗按钮能按，本身就是读数。一个恒在的
                      小圆点说的是一种只有 tooltip 才懂的语言。 */}
                  {!hasKey && <span className={css.keyMissing}>{SETTINGS_COPY['models.providerKeyMissing']}</span>}
                </span>
                <span className={css.rowActions}>
                  <button
                    type="button"
                    className={css.rowButton}
                    data-provider-edit={entry.id}
                    aria-expanded={open}
                    onClick={() => { setOpenId(open ? null : entry.id); }}
                  >
                    {open ? <ChevronDownIcon className={css.rowButtonIcon} /> : <ChevronRightIcon className={css.rowButtonIcon} />}
                    {open ? SETTINGS_COPY['models.providerCollapse'] : SETTINGS_COPY['models.providerEdit']}
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      className={css.rowButton}
                      data-provider-use={entry.id}
                      disabled={!canActivate}
                      title={canActivate ? SETTINGS_COPY['models.providerSwitchNote'] : blocked}
                      onClick={() => { send({ type: 'set_provider', id: entry.id }); }}
                    >
                      {SETTINGS_COPY['models.providerUse']}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cls(css.rowButton, css.rowButtonDanger)}
                    data-provider-remove={entry.id}
                    title={SETTINGS_COPY['models.providerRemoveNow']}
                    onClick={() => { removeRow(entry.id); }}
                  >
                    {SETTINGS_COPY['models.providerRemove']}
                  </button>
                </span>
              </div>
              <div className={css.rowMeta}>
                <span className={cls(css.rowUrl, row.baseURL.trim() === '' && css.rowUrlEmpty)}>
                  {row.baseURL.trim() === '' ? SETTINGS_COPY['models.providerNoUrl'] : row.baseURL}
                </span>
                <span className={css.rowCount}>
                  {row.models.length === 0
                    ? SETTINGS_COPY['models.providerModelCountZero']
                    : `${String(row.models.length)} ${SETTINGS_COPY['models.providerModelCount']}`}
                </span>
              </div>
              {open && renderEditor(row, false)}
            </li>
          );
        })}

        {adding && newDraft !== null && (
          <li className={css.card} data-provider={newDraft.id} data-provider-new="true">
            <div className={css.rowHead}>
              <span className={css.rowIdentity}>
                <span className={css.rowName}>{SETTINGS_COPY['models.providerAdd']}</span>
              </span>
            </div>
            {renderEditor(newDraft, true)}
          </li>
        )}
      </ul>

      {!adding && (
        <div className={css.footer}>
          <button type="button" className={css.addButton} data-provider-add-new onClick={startAdd}>
            {SETTINGS_COPY['models.providerAdd']}
          </button>
        </div>
      )}

      {/* 探针成功 = 这个弹窗打开。清单的长度由端点决定，所以它必须活在一个固定
          高度的框里；把它铺进卡片，卡片就会长到几百像素，把设置页撑成一条长滚轴
          （这正是页面级「模型目录」被删掉的同一个理由）。 */}
      {poolOpen && probeRow !== undefined && (
        <ProviderModelsPicker
          candidates={pool}
          existing={draftOf(probeRow).models.map((model) => model.id)}
          onApply={(ids) => {
            const row = draftOf(probeRow);
            update(row, { models: [...row.models, ...ids.map((id) => ({ id }))] });
            setProbeTarget(null);
          }}
          onClose={() => { setProbeTarget(null); }}
        />
      )}
    </SettingsSection>
  );
}
