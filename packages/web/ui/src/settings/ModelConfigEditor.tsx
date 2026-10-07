/**
 * 模型参数（第 3 步）：把配置里的 `models[]` 当成**可增删、可逐字段改能力**的名单来编。
 *
 * 版式对齐 deepseek-harness `ui-settings-models`（`src/client/ModelListEditor.tsx` +
 * `ModelRow.tsx` + `ModelInputTypes.tsx`，MIT，(c) 2026 DeepSeek）：一行一个模型，
 * 行内是 ID 与显示名两个输入框，右侧一个展开箭头（`modelAdvanced` = 模型选项）与一个
 * 删除按钮；展开后是上下文窗口 / 最大输出 / 输入类型；容量字段接受 `256K` / `1M`
 * 这类写法（`parseCapacity` / `formatCapacity` 的语义照搬参考实现）。「获取可用模型」
 * 的候选在这里退化成一行可选中的 id 芯片——参考实现开弹窗，是因为它的目录编辑器在
 * 卡片里；这一段是整页的清单，直接把候选摆在添加行下面更短。
 *
 * 三条来自宿主的事实（`model_config` 帧），这个组件一条都不自己算：
 *  - `models` —— 已存的名单；**空 = 没有名单**，此时目录归端点管，页面明说这一点，
 *    而不是显示「没有模型」（两者是相反的事实）；
 *  - `published` —— 端点自己公布的 id，用来把删掉的模型加回来；
 *  - `automatic[id]` —— models.dev 的答案（**未叠加**覆盖）。
 *
 * 「当前生效」与「自动值」并排显示，正是 AGENTS.md 对设置页的要求：前者回答「现在
 * 用的是什么」，后者回答「不覆盖会得到什么」，两者的差就是操作者在偏离什么。这里的
 * 「当前生效」只说**值的来源**（手动写下的 / 自动），合并覆盖与自动值的优先级仍然只有
 * 一个实现（`core/model-catalog-rules.ts` 的 `resolveCapabilities`，由宿主的
 * `capabilities()` 供目录页使用）——所以这一页不自己算合并结果，只标注来源。
 *
 * 编辑是**草稿态**：所有改动先落在本地，按「保存」才整份写回。逐字段写回会让「清空
 * 一个字段」和「没填过这个字段」变得不可区分，而那正是「自动」与「手动」的分界。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsSection } from './Section.js';
import { TitleModelRow } from './TitleModelRow.js';
import { cls } from '../sidebar/view.js';
import type { ClientFrame, ConfiguredModel } from '../types.js';
import type { ModelConfigSnapshot } from '../state.js';
import css from './ModelConfigEditor.module.css';

/** `256K` / `1M` / `8192` — the reference implementation's capacity grammar. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i;

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const;

/**
 * The config schema's bounds for the two model capacities
 * (`cli/src/config-schema-models.ts`). Checked here as well as there because the
 * file is loaded through a `.strict()` zod schema: a value past the bound makes
 * the whole configuration fail to load, so it is refused before the write.
 */
const MAX_MODEL_CONTEXT_WINDOW = 200_000_000;
const MAX_MODEL_OUTPUT = 10_000_000;

/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count. Exported because the
 * provider card's request parameters are spelled the same way — one vocabulary,
 * one implementation.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable.
 */
export function parseCapacityText(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const match = CAPACITY_PATTERN.exec(trimmed);
  if (match === null) return Number.NaN;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1;
  const scaled = Number(match[1]) * scale;
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled;
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacityText}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value);
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`;
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`;
  return String(value);
}

/** One numeric field's outcome: a value, "clear" (blank = no override), or a reason. */
export type CapacityFieldResult =
  | { ok: true; value: number | undefined }
  | { ok: false; key: keyof typeof SETTINGS_COPY };

/**
 * A field's count, against the bound its target field declares.
 * @param text - raw field text.
 * @param max - the largest value the config schema accepts for this field.
 * @returns the count (or "no override"), or the copy key saying why it was refused.
 */
export function parseCapacityField(text: string, max: number): CapacityFieldResult {
  const parsed = parseCapacityText(text);
  if (parsed === undefined) return { ok: true, value: undefined };
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, key: 'models.configInvalidCapacity' };
  }
  if (parsed > max) return { ok: false, key: 'models.configRangeExceeded' };
  return { ok: true, value: parsed };
}

/** 三态开关：`auto` = 未覆盖（跟随 models.dev）。 */
type Toggle = 'auto' | 'on' | 'off';

/** 一个模型条目的草稿态：数字保持文本，模态是勾选集合，开关是三态。 */
interface ModelDraft {
  id: string;
  name: string;
  contextWindow: string;
  maxOutput: string;
  inputModalities: readonly string[];
  outputModalities: readonly string[];
  attachment: Toggle;
  reasoning: Toggle;
  toolCall: Toggle;
}

export interface ModelConfigEditorProps {
  /** The stored list + the host's two reference answers (null until asked). */
  config: ModelConfigSnapshot | null;
  /** Whether this host can write the config at all (inert text when false). */
  writable: boolean;
  /** Whether this editor holds unsaved edits, reported whenever it changes. */
  onDirtyChange?: (dirty: boolean) => void;
  send: (frame: ClientFrame) => void;
}

/** 模态选项：请求路径接受的那五种（`core/image-projection.ts`）。 */
const MODALITY_CHOICES = [
  { id: 'text', label: 'models.modalityText' },
  { id: 'image', label: 'models.modalityImage' },
  { id: 'audio', label: 'models.modalityAudio' },
  { id: 'video', label: 'models.modalityVideo' },
  { id: 'pdf', label: 'models.modalityPdf' },
] as const;

/** 开关字段的清单：顺序、文案与草稿键都在这张表里。 */
const TOGGLE_FIELDS = [
  { key: 'attachment', label: 'models.fieldAttachment' },
  { key: 'reasoning', label: 'models.fieldReasoning' },
  { key: 'toolCall', label: 'models.fieldToolCall' },
] as const;

/** 容量字段的清单（每个字段有自己的上限，见 config schema）。 */
const CAPACITY_FIELDS = [
  { key: 'contextWindow', label: 'models.fieldContextWindow', max: MAX_MODEL_CONTEXT_WINDOW },
  { key: 'maxOutput', label: 'models.fieldMaxOutput', max: MAX_MODEL_OUTPUT },
] as const;

/** 布尔 → 三态。 */
function toToggle(value: boolean | undefined): Toggle {
  return value === undefined ? 'auto' : value ? 'on' : 'off';
}

/**
 * One patch for a computed field key.
 *
 * A switch rather than `{ [key]: value }`: a computed key widens the object to an
 * index signature, which is not a `Partial<ModelDraft>` — the patch stays a real
 * literal, so the update is type-checked against the very field it writes.
 */
function capacityPatch(key: (typeof CAPACITY_FIELDS)[number]['key'], value: string): Partial<ModelDraft> {
  return key === 'contextWindow' ? { contextWindow: value } : { maxOutput: value };
}

/** One patch for a toggle field (same reason as {@link capacityPatch}). */
function togglePatch(key: (typeof TOGGLE_FIELDS)[number]['key'], value: Toggle): Partial<ModelDraft> {
  switch (key) {
    case 'attachment': return { attachment: value };
    case 'reasoning': return { reasoning: value };
    case 'toolCall': return { toolCall: value };
  }
}

/** One patch for a modality field (same reason as {@link capacityPatch}). */
function modalityPatch(
  key: 'inputModalities' | 'outputModalities',
  value: readonly string[],
): Partial<ModelDraft> {
  return key === 'inputModalities' ? { inputModalities: value } : { outputModalities: value };
}

/** 一条已存条目 → 草稿（缺的字段留空 = 自动）。 */
function toDraft(entry: ConfiguredModel): ModelDraft {
  return {
    id: entry.id,
    name: entry.name ?? '',
    contextWindow: entry.contextWindow === undefined ? '' : formatCapacity(entry.contextWindow),
    maxOutput: entry.maxOutput === undefined ? '' : formatCapacity(entry.maxOutput),
    inputModalities: [...(entry.inputModalities ?? [])],
    outputModalities: [...(entry.outputModalities ?? [])],
    attachment: toToggle(entry.attachment),
    reasoning: toToggle(entry.reasoning),
    toolCall: toToggle(entry.toolCall),
  };
}

/** 草稿 → 线上条目（空字段**不写**，那才是「自动」的含义）。 */
function toEntry(draft: ModelDraft): { ok: true; entry: ConfiguredModel } | { ok: false; key: keyof typeof SETTINGS_COPY } {
  const id = draft.id.trim();
  if (id === '') return { ok: false, key: 'models.configEmptyId' };
  const contextWindow = parseCapacityField(draft.contextWindow, MAX_MODEL_CONTEXT_WINDOW);
  if (!contextWindow.ok) return contextWindow;
  const maxOutput = parseCapacityField(draft.maxOutput, MAX_MODEL_OUTPUT);
  if (!maxOutput.ok) return maxOutput;
  const name = draft.name.trim();
  return {
    ok: true,
    entry: {
      id,
      ...(name !== '' ? { name } : {}),
      ...(contextWindow.value !== undefined ? { contextWindow: contextWindow.value } : {}),
      ...(maxOutput.value !== undefined ? { maxOutput: maxOutput.value } : {}),
      ...(draft.inputModalities.length > 0 ? { inputModalities: [...draft.inputModalities] } : {}),
      ...(draft.outputModalities.length > 0 ? { outputModalities: [...draft.outputModalities] } : {}),
      ...(draft.attachment !== 'auto' ? { attachment: draft.attachment === 'on' } : {}),
      ...(draft.reasoning !== 'auto' ? { reasoning: draft.reasoning === 'on' } : {}),
      ...(draft.toolCall !== 'auto' ? { toolCall: draft.toolCall === 'on' } : {}),
    },
  };
}

/** 「当前生效 手动 256K」/「当前生效 自动」—— 只说来源，不算合并结果。 */
function effectiveLabel(manual: boolean, value: string): string {
  const label = SETTINGS_COPY['models.configEffectiveLabel'];
  return manual
    ? `${label} ${SETTINGS_COPY['models.configEffectiveManual']} ${value}`
    : `${label} ${SETTINGS_COPY['models.configEffectiveAuto']}`;
}

/** 一个模态 id 的读者语言（表外的值原样显示，不丢信息）。 */
function modalityName(id: string): string {
  const choice = MODALITY_CHOICES.find((candidate) => candidate.id === id);
  return choice === undefined ? id : SETTINGS_COPY[choice.label];
}

/** 一串模态 id 的读者语言。 */
function modalityNames(ids: readonly string[]): string {
  return ids.map(modalityName).join('/');
}

/** 自动值的占位文案；自动源也不知道时只写「自动值」。 */
function autoLabel(value: number | readonly string[] | boolean | undefined): string {
  const label = SETTINGS_COPY['models.configAutoLabel'];
  if (value === undefined) return label;
  if (typeof value === 'number') return `${label} ${formatCapacity(value)}`;
  if (Array.isArray(value)) return value.length === 0 ? label : `${label} ${modalityNames(value)}`;
  return `${label} ${value ? SETTINGS_COPY['models.stateOn'] : SETTINGS_COPY['models.stateOff']}`;
}

/**
 * 渲染模型参数编辑器。
 * @param props - see ModelConfigEditorProps.
 * @returns the editor element tree.
 */
export function ModelConfigEditor({ config, writable, onDirtyChange, send }: ModelConfigEditorProps): JSX.Element {
  // 草稿与「已存名单」分开：没有待保存的改动时，重新问一次宿主不该把正在编辑的内容
  // 冲掉，所以草稿只在首次拿到名单、或宿主回报的结果与它一致时才重置。挂载 effect
  // 生效之前（以及不发生 effect 的静态渲染里）用**已存名单**当草稿：内容逐字相同，
  // 第一帧就不会是一张空清单。
  const [drafts, setDrafts] = useState<ModelDraft[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newId, setNewId] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());

  // The shell's leave guard reads this: a draft here is an edit a section
  // switch would silently discard, so the editor reports it like the plugin
  // pages do. The unmount cleanup clears it for a gone page.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

  useEffect(() => {
    send({ type: 'list_model_config' });
  }, [send]);

  useEffect(() => {
    if (config === null || dirty) return;
    setDrafts(config.models.map(toDraft));
  }, [config, dirty]);

  // A save changes which ids the MENU offers (this list IS the menu once it is
  // non-empty), and only this section knows it just changed them. The catalog
  // above is asked again once the host's answer has landed — never before, or the
  // reply could describe the list as it was a moment ago.
  const awaitingCatalog = useRef(false);
  useEffect(() => {
    if (config === null || !awaitingCatalog.current) return;
    awaitingCatalog.current = false;
    send({ type: 'list_models' });
  }, [config, send]);

  const rows = drafts ?? (config?.models ?? []).map(toDraft);
  const update = (index: number, patch: Partial<ModelDraft>): void => {
    setDirty(true);
    setDrafts(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number): void => {
    setDirty(true);
    setDrafts(rows.filter((_, at) => at !== index));
  };
  const add = (id: string): void => {
    const trimmed = id.trim();
    if (trimmed === '' || rows.some((row) => row.id.toLowerCase() === trimmed.toLowerCase())) return;
    setDirty(true);
    setDrafts([...rows, toDraft({ id: trimmed })]);
    setNewId('');
  };
  /** 逐行体检：`${index}` → 文案。空 = 这一份清单可以写盘。 */
  const problems = new Map<number, string>();
  rows.forEach((row, index) => {
    const entry = toEntry(row);
    if (!entry.ok) {
      problems.set(index, SETTINGS_COPY[entry.key]);
      return;
    }
    const duplicate = rows.some(
      (other, at) => at !== index && other.id.trim().toLowerCase() === entry.entry.id.toLowerCase(),
    );
    if (duplicate) problems.set(index, SETTINGS_COPY['models.configDuplicateId']);
  });
  const firstProblem = [...problems.values()][0];
  const save = (): void => {
    const built: ConfiguredModel[] = [];
    for (const row of rows) {
      const entry = toEntry(row);
      if (!entry.ok) return;
      built.push(entry.entry);
    }
    setDirty(false);
    awaitingCatalog.current = true;
    send({ type: 'save_models', models: built });
  };

  const stored = config?.models ?? [];
  const pool = (config?.published ?? []).filter(
    (id) => !rows.some((row) => row.id.toLowerCase() === id.toLowerCase()),
  );

  return (
    <SettingsSection>
      {/* 会话标题模型：主路设置，即时保存（宿主的回帧就是状态），不进草稿。 */}
      <TitleModelRow config={config} writable={writable} send={send} />
      {/* 逐字段覆盖能力是进阶操作，默认收进一张「高级」折叠：主路（填密钥、选
          模型）不再被一份空的参数表打断。折叠用原生 `details`——收起是浏览器的
          事，不是第二份状态。 */}
      <details className={css.advanced} data-model-advanced>
        <summary className={css.advancedSummary}>
          <ChevronRightIcon className={css.advancedChevron} />
          <span className={css.advancedTitle}>{SETTINGS_COPY['models.configTitle']}</span>
          <span className={css.advancedHint}>{SETTINGS_COPY['models.configIntro']}</span>
        </summary>
        <div className={css.advancedBody}>
      <p className={css.notice}>
        {stored.length === 0 ? SETTINGS_COPY['models.configInherited'] : SETTINGS_COPY['models.configTakeover']}
      </p>

      {rows.length > 0 && (
        <ul className={css.list}>
          {rows.map((row, index) => {
            const open = !collapsed.has(index);
            return (
              <li key={`${row.id}-${String(index)}`} className={css.card} data-model={row.id}>
                <div className={css.cardHead}>
                  <input
                    className={css.input}
                    value={row.id}
                    placeholder={SETTINGS_COPY['models.configId']}
                    aria-label={SETTINGS_COPY['models.configId']}
                    spellCheck={false}
                    disabled={!writable}
                    onChange={(event) => { update(index, { id: event.currentTarget.value }); }}
                  />
                  <input
                    className={css.input}
                    value={row.name}
                    placeholder={SETTINGS_COPY['models.configNamePlaceholder']}
                    aria-label={SETTINGS_COPY['models.configName']}
                    disabled={!writable}
                    onChange={(event) => { update(index, { name: event.currentTarget.value }); }}
                  />
                  <button
                    type="button"
                    className={css.iconButton}
                    data-model-disclosure={row.id}
                    aria-expanded={open}
                    aria-label={`${SETTINGS_COPY['models.configAdvanced']} ${row.id}`}
                    title={SETTINGS_COPY['models.configAdvanced']}
                    onClick={() => {
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (!next.delete(index)) next.add(index);
                        return next;
                      });
                    }}
                  >
                    {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </button>
                  <button
                    type="button"
                    className={cls(css.iconButton, css.iconButtonDanger)}
                    data-model-remove={row.id}
                    aria-label={`${SETTINGS_COPY['models.configRemove']} ${row.id}`}
                    title={SETTINGS_COPY['models.configRemove']}
                    disabled={!writable}
                    onClick={() => { remove(index); }}
                  >
                    <TrashIcon />
                  </button>
                </div>

                {open && (
                  <div className={css.fields}>
                    {CAPACITY_FIELDS.map((field) => {
                      const manual = row[field.key];
                      const value = config?.automatic[row.id]?.[field.key];
                      return (
                        <label key={field.key} className={css.field}>
                          <span className={css.fieldHead}>
                            <span className={css.fieldLabel}>{SETTINGS_COPY[field.label]}</span>
                            <span className={css.effective}>{effectiveLabel(manual !== '', manual)}</span>
                          </span>
                          <input
                            className={css.input}
                            inputMode="numeric"
                            value={manual}
                            placeholder={autoLabel(value)}
                            aria-label={`${SETTINGS_COPY[field.label]} ${row.id}`}
                            aria-invalid={problems.has(index) ? 'true' : undefined}
                            disabled={!writable}
                            onChange={(event) => { update(index, capacityPatch(field.key, event.currentTarget.value)); }}
                          />
                        </label>
                      );
                    })}
                    {TOGGLE_FIELDS.map((field) => {
                      const state = row[field.key];
                      const value = config?.automatic[row.id]?.[field.key];
                      return (
                        <label key={field.key} className={css.field}>
                          <span className={css.fieldHead}>
                            <span className={css.fieldLabel}>{SETTINGS_COPY[field.label]}</span>
                            <span className={css.effective}>
                              {effectiveLabel(state !== 'auto', state === 'on' ? SETTINGS_COPY['models.stateOn'] : SETTINGS_COPY['models.stateOff'])}
                            </span>
                          </span>
                          <span className={css.selectWrap}>
                            <select
                              className={cls(css.input, css.select)}
                              value={state}
                              aria-label={`${SETTINGS_COPY[field.label]} ${row.id}`}
                              disabled={!writable}
                              onChange={(event) => {
                                update(index, togglePatch(field.key, event.currentTarget.value as Toggle));
                              }}
                            >
                              <option value="auto">{autoLabel(value)}</option>
                              <option value="on">{SETTINGS_COPY['models.stateOn']}</option>
                              <option value="off">{SETTINGS_COPY['models.stateOff']}</option>
                            </select>
                            {/* The OS arrow sits flush against the right edge and cannot take
                                the label colour, so the select is drawn with `appearance: none`
                                and this chevron takes its cell. */}
                            <ChevronDownIcon className={css.selectIcon} />
                          </span>
                        </label>
                      );
                    })}
                    {(['inputModalities', 'outputModalities'] as const).map((key) => {
                      const chosen = row[key];
                      const value = config?.automatic[row.id]?.[key];
                      const label = key === 'inputModalities' ? 'models.fieldInputModalities' : 'models.fieldOutputModalities';
                      return (
                        <fieldset key={key} className={css.modalities}>
                          <legend className={css.fieldHead}>
                            <span className={css.fieldLabel}>{SETTINGS_COPY[label]}</span>
                            <span className={css.effective}>{effectiveLabel(chosen.length > 0, modalityNames(chosen))}</span>
                          </legend>
                          <div className={css.choices}>
                            {MODALITY_CHOICES.map((choice) => {
                              const picked = chosen.includes(choice.id);
                              return (
                                <label key={choice.id} className={css.choice}>
                                  <input
                                    type="checkbox"
                                    className={css.checkbox}
                                    checked={picked}
                                    disabled={!writable}
                                    onChange={() => {
                                      update(index, modalityPatch(
                                        key,
                                        picked ? chosen.filter((entry) => entry !== choice.id) : [...chosen, choice.id],
                                      ));
                                    }}
                                  />
                                  <span>{SETTINGS_COPY[choice.label]}</span>
                                </label>
                              );
                            })}
                          </div>
                          <p className={css.autoLine}>{autoLabel(value)}</p>
                        </fieldset>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className={css.addBlock}>
        <div className={css.addRow}>
          <input
            className={css.input}
            value={newId}
            placeholder={SETTINGS_COPY['models.configAddPlaceholder']}
            aria-label={SETTINGS_COPY['models.configAddPlaceholder']}
            spellCheck={false}
            disabled={!writable}
            onChange={(event) => { setNewId(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add(newId);
            }}
          />
          <button
            type="button"
            className={css.button}
            data-model-add
            disabled={!writable || newId.trim() === ''}
            onClick={() => { add(newId); }}
          >
            {SETTINGS_COPY['models.configAdd']}
          </button>
        </div>
        {pool.length > 0 && (
          <div className={css.pool} data-model-pool>
            <span className={css.poolTitle}>{SETTINGS_COPY['models.configPublished']}</span>
            <div className={css.poolRows}>
              {pool.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={css.poolRow}
                  data-model-candidate={id}
                  disabled={!writable}
                  onClick={() => { add(id); }}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}
        {pool.length === 0 && <p className={css.autoLine}>{SETTINGS_COPY['models.configPublishedEmpty']}</p>}
      </div>

      {firstProblem !== undefined && <p className={css.problem} role="alert">{firstProblem}</p>}
      <div className={css.actions}>
        <button
          type="button"
          className={css.primary}
          data-model-save
          disabled={!writable || !dirty || problems.size > 0}
          onClick={save}
        >
          {SETTINGS_COPY['models.configSave']}
        </button>
        {!writable && <span className={css.readOnly}>{SETTINGS_COPY['models.configReadOnly']}</span>}
      </div>
        </div>
      </details>
    </SettingsSection>
  );
}
