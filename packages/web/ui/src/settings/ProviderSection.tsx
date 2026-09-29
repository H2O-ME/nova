/**
 * 供应商（BYOK）编辑区：设置页「模型」页的第 1 步——**哪个端点在役**。
 *
 * 版式对齐 deepseek-harness `ui-settings-models`（`src/client/ModelsSection.tsx` +
 * `ModelsSection.module.css`，MIT，(c) 2026 DeepSeek）：页面头是 `<h2>` + 一行说明；
 * 每个供应商是一张卡（`.rowCard` / `.rowHead` / `.rowIdentity` / `.rowActions`），
 * 卡头左边是身份（名称 + 标记 + 密钥点），右边是行内动作（编辑 / 设为当前 / 删除）；
 * 一次只展开一张卡；「添加模型提供商」是列表末尾的虚线整行按钮。
 *
 * 本仓与参考实现的三处差异，都有理由：
 *  - **请求参数（temperature / maxTokens / contextWindow）在卡内**：schema
 *    （`cli/src/config-schema-models.ts`）把这三个字段放在 provider 条目上，而
 *    `models[]` 条目是 `.strict()` 的——写进去会让整份配置加载失败。参考实现的
 *    provider 编辑器同样把适配器参数与模型清单放在同一张卡里。
 *  - **设为当前发的是 `set_provider`，不是带 `activeId` 的 `save_providers`**：只有
 *    前者会 `ChatProvider.setEndpoint` 就地改写在役客户端；带指针的保存会把
 *    「当前使用」写进文件却把请求留在旧端点上——标记说切换了，会话还在跟旧端点说话。
 *    于是它有前置条件（已存进文件、已有密钥），不满足时按钮禁用并写明原因。
 *  - **端点一换就补问第 2/3 步的数据**：切换后模型目录与「自动值」都还属于旧端点
 *    （`state.catalog` / `state.modelConfig` 只由帧驱动），而壳把三段拼成兄弟节点、
 *    不给它们 `activeId`，所以由**发起切换的**这一段补问。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsSection } from './Section.js';
import { StepHeading } from './StepHeading.js';
import { parseCapacityField } from './ModelConfigEditor.js';
import { cls } from '../sidebar/view.js';
import type { ClientFrame } from '../types.js';
import type { WireProviderRow } from '../types.js';
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
  models: readonly string[];
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
    models: entry.models.map((model) => model.id),
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
      ...(row.models.length > 0 ? { models: row.models.map((id) => ({ id })) } : {}),
    },
  };
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
  const [drafts, setDrafts] = useState<ProviderDraft[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [probeTarget, setProbeTarget] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [manualModel, setManualModel] = useState('');

  useEffect(() => {
    if (providers === null || dirty) return;
    setDrafts(stored.map(toProviderDraft));
  }, [providers, dirty, stored]);

  // The endpoint in force changed under us (a switch, or another window's save):
  // the catalog and the automatic-value table both belong to the NEW endpoint, and
  // no other section can see that they went stale. Re-asked only on a CHANGE, so
  // the first answer never costs a second round trip.
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

  // The draft is what the operator is editing; until the mount effect has taken
  // it, the STORED rows are the same content — so the first paint (and any
  // server-side/static render, where no effect runs) already shows the list
  // instead of an empty one.
  const rows = drafts ?? stored.map(toProviderDraft);
  const storedIds = new Set(stored.map((entry) => entry.id));
  const storedKey = new Map(stored.map((entry) => [entry.id, entry.hasApiKey]));
  /**
   * The probe's state. `pending` comes from the reducer (set when the frame goes
   * OUT, cleared when the host's answer lands) and `probeTarget` is this control's
   * own memory of which address it asked about — the answer is rendered only when
   * the two agree, so a late reply for edited text is dropped.
   */
  const probePending = probe?.pending === true;
  const answer = probe !== null && !probe.pending ? probe : null;
  const update = (index: number, patch: Partial<ProviderDraft>): void => {
    setDirty(true);
    setDrafts(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };
  /** 逐字段体检：`${index}:${field}` → 文案。空 = 这一行可以写盘。 */
  const problems = new Map<string, string>();
  rows.forEach((row, index) => {
    const fields = [
      ['temperature', parseTemperatureField(row.temperature)],
      ['maxTokens', parseCapacityField(row.maxTokens, MAX_MAX_TOKENS)],
      ['contextWindow', parseCapacityField(row.contextWindow, MAX_PROVIDER_CONTEXT_WINDOW)],
    ] as const;
    for (const [field, result] of fields) {
      if (!result.ok) problems.set(`${String(index)}:${field}`, SETTINGS_COPY[result.key]);
    }
  });
  const firstProblem = [...problems.values()][0];
  /** 草稿行 → 线上清单；任一行读不出来就整份拒绝（写盘是整段替换，不能只写一半）。 */
  const toInput = (): WireProviderRowInput[] | undefined => {
    const built: WireProviderRowInput[] = [];
    for (const row of rows.filter((candidate) => candidate.baseURL.trim() !== '')) {
      const parsed = toInputRow(row);
      if (!parsed.ok) return undefined;
      built.push(parsed.entry);
    }
    return built;
  };
  const save = (): void => {
    const input = toInput();
    if (input === undefined) return;
    setDirty(false);
    send({ type: 'save_providers', providers: input, ...(activeId !== undefined ? { activeId } : {}) });
  };
  const pick = (id: string): void => {
    send({ type: 'set_provider', id });
  };
  const remove = (index: number): void => {
    setDirty(true);
    setDrafts(rows.filter((_, at) => at !== index));
  };
  const addRow = (): void => {
    const id = newProviderId(rows.map((row) => row.id));
    setDirty(true);
    setDrafts([...rows, { id, name: '', baseURL: '', apiKey: '', temperature: '', maxTokens: '', contextWindow: '', models: [] }]);
    setOpenId(id);
  };
  const addModel = (index: number, id: string): void => {
    const trimmed = id.trim();
    const row = rows[index];
    if (row === undefined || trimmed === '' || row.models.includes(trimmed)) return;
    update(index, { models: [...row.models, trimmed] });
    setManualModel('');
  };

  const pool = answer !== null && answer.ok ? answer.models : [];
  const loading = providers === null;

  return (
    <SettingsSection>
      {/* The reference's page head (`ui-settings-models` `ModelsSection`:
          `<h2>` + one line). The numbered step headings below are this shell's
          addition (see `StepHeading`): the three sections are sibling columns
          here, so the reader has to be able to tell which is which. */}
      <h2 className={css.heading}>{SETTINGS_COPY['models.title']}</h2>
      <p className={css.intro}>{SETTINGS_COPY['models.intro']}</p>
      <StepHeading
        step={1}
        title={SETTINGS_COPY['models.providerTitle']}
        intro={SETTINGS_COPY['models.providerIntro']}
      />
      {loading && <div className={css.status}>{SETTINGS_COPY['models.providerLoading']}</div>}
      {!loading && rows.length === 0 && <div className={css.notice}>{SETTINGS_COPY['models.providerEmpty']}</div>}

      <ul className={css.rows}>
        {rows.map((row, index) => {
          const isActive = row.id === activeId;
          const open = openId === row.id;
          const hasKey = storedKey.get(row.id) === true;
          const saved = storedIds.has(row.id);
          // The switch's precondition is the FILE's content, not this draft's:
          // `set_provider` reads the stored list, so an unsaved edit would either
          // be ignored or overwritten. Each refusal says which one it is.
          const canActivate = !dirty && saved && hasKey && !isActive;
          const blocked = !saved || dirty
            ? SETTINGS_COPY['models.providerSaveFirst']
            : SETTINGS_COPY['models.providerKeyMissing'];
          return (
            <li
              key={row.id}
              className={cls(css.card, isActive && css.cardActive)}
              data-provider={row.id}
              data-active={isActive ? 'true' : undefined}
            >
              <div className={css.rowHead}>
                <span className={css.rowIdentity}>
                  <span className={css.rowName}>{row.name.trim() !== '' ? row.name.trim() : hostLabel(row.baseURL)}</span>
                  {/* 活动项：一个词加一个点，不靠顺序暗示。 */}
                  {isActive && <span className={css.activeTag}>{SETTINGS_COPY['models.providerActive']}</span>}
                  <span
                    className={cls(css.keyDot, hasKey ? css.keyDotSet : css.keyDotMissing)}
                    role="img"
                    aria-label={hasKey ? SETTINGS_COPY['models.providerKeySet'] : SETTINGS_COPY['models.providerKeyMissing']}
                    title={hasKey ? SETTINGS_COPY['models.providerKeySet'] : SETTINGS_COPY['models.providerKeyMissing']}
                  />
                </span>
                <span className={css.rowActions}>
                  <button
                    type="button"
                    className={css.rowButton}
                    data-provider-edit={row.id}
                    aria-expanded={open}
                    onClick={() => { setOpenId(open ? null : row.id); }}
                  >
                    {open ? <ChevronDownIcon className={css.rowButtonIcon} /> : <ChevronRightIcon className={css.rowButtonIcon} />}
                    {open ? SETTINGS_COPY['models.providerCollapse'] : SETTINGS_COPY['models.providerEdit']}
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      className={css.rowButton}
                      data-provider-use={row.id}
                      disabled={!canActivate}
                      title={canActivate ? SETTINGS_COPY['models.providerSwitchNote'] : blocked}
                      onClick={() => { pick(row.id); }}
                    >
                      {SETTINGS_COPY['models.providerUse']}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cls(css.rowButton, css.rowButtonDanger)}
                    data-provider-remove={row.id}
                    onClick={() => { remove(index); }}
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

              {open && (
                <div className={css.editor}>
                  <div className={css.fields}>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerName']}</span>
                      <input
                        className={css.input}
                        value={row.name}
                        placeholder={SETTINGS_COPY['models.providerNamePlaceholder']}
                        aria-label={`${SETTINGS_COPY['models.providerName']} ${row.id}`}
                        onChange={(event) => { update(index, { name: event.currentTarget.value }); }}
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
                        onChange={(event) => { update(index, { baseURL: event.currentTarget.value }); }}
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
                        onChange={(event) => { update(index, { apiKey: event.currentTarget.value }); }}
                      />
                    </label>
                  </div>

                  {/* 请求参数：端点的采样参数，随端点保存（模型能力在下一步）。 */}
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
                          aria-invalid={problems.has(`${String(index)}:temperature`) ? 'true' : undefined}
                          onChange={(event) => { update(index, { temperature: event.currentTarget.value }); }}
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
                          aria-invalid={problems.has(`${String(index)}:maxTokens`) ? 'true' : undefined}
                          onChange={(event) => { update(index, { maxTokens: event.currentTarget.value }); }}
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
                          aria-invalid={problems.has(`${String(index)}:contextWindow`) ? 'true' : undefined}
                          onChange={(event) => { update(index, { contextWindow: event.currentTarget.value }); }}
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
                        {row.models.map((id) => (
                          <li key={id} className={css.modelChip}>
                            <span className={css.modelChipId}>{id}</span>
                            <button
                              type="button"
                              className={css.chipRemove}
                              data-provider-model-remove={id}
                              aria-label={`${SETTINGS_COPY['models.providerModelsRemove']} ${id}`}
                              title={SETTINGS_COPY['models.providerModelsRemove']}
                              onClick={() => {
                                update(index, { models: row.models.filter((entry) => entry !== id) });
                              }}
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
                          addModel(index, manualModel);
                        }}
                      />
                      <button
                        type="button"
                        className={css.button}
                        data-provider-model-add
                        disabled={manualModel.trim() === ''}
                        onClick={() => { addModel(index, manualModel); }}
                      >
                        {SETTINGS_COPY['models.providerAddModel']}
                      </button>
                    </div>
                    {/* The pool belongs to the row it was asked about: a probe answer for
                        a DIFFERENT address is not rendered here (see the module header). */}
                    {probeTarget === row.baseURL.trim() && answer !== null && (
                      <div className={css.pool} data-provider-pool={row.id}>
                        <div className={css.fieldHint}>
                          {answer.ok ? SETTINGS_COPY['models.providerProbeOk'] : SETTINGS_COPY['models.providerProbeFail']}
                        </div>
                        {!answer.ok && answer.message !== undefined && <div className={css.error}>{answer.message}</div>}
                        {answer.ok && pool.length === 0 && (
                          <div className={css.fieldHint}>{SETTINGS_COPY['models.providerNoReachable']}</div>
                        )}
                        {pool.length > 0 && (
                          <div className={css.poolRows}>
                            {pool.map((id) => {
                              const picked = row.models.includes(id);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className={cls(css.poolRow, picked && css.poolPicked)}
                                  data-provider-add={id}
                                  aria-pressed={picked}
                                  onClick={() => {
                                    update(index, {
                                      models: picked ? row.models.filter((entry) => entry !== id) : [...row.models, id],
                                    });
                                  }}
                                >
                                  {id}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    <p className={css.fieldHint}>{SETTINGS_COPY['models.providerModelsHint']}</p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className={css.footer}>
        <button type="button" className={css.addButton} data-provider-add-new onClick={addRow}>
          {SETTINGS_COPY['models.providerAdd']}
        </button>
      </div>
      {/* The page's own tail: one right-aligned action row (the reference's
          `editorActions`), so the section ends on the control that writes it. */}
      <div className={css.actions}>
        {firstProblem !== undefined
          ? <p className={css.problem} role="alert">{firstProblem}</p>
          : dirty && <span className={css.dirtyNote}>{SETTINGS_COPY['models.providerDirty']}</span>}
        <button
          type="button"
          className={css.primary}
          data-provider-save
          disabled={!dirty || problems.size > 0}
          onClick={save}
        >
          {SETTINGS_COPY['models.providerSave']}
        </button>
      </div>
      <p className={css.fieldHint}>{SETTINGS_COPY['models.providerSwitchNote']}</p>
      <p className={css.fieldHint}>{SETTINGS_COPY['models.providerApiKeyHint']}</p>
    </SettingsSection>
  );
}
