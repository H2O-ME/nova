/**
 * 供应商（BYOK）编辑区：设置页「模型」页——**哪个端点在役**。
 *
 * SHAPE (2026-11-24, ZCode split panel): the reference's model page is ONE
 * master-detail card — `model-provider-section/SectionLayout.tsx:67-89` wraps a
 * `min-h-[36rem]` grid in `overflow-clip rounded-xl border border-border
 * bg-card`, with a 224px provider navigation on the left (`Navigation.tsx:112`:
 * 32px rows, 16px glyph, truncated name, 8px status dot — `border-transparent`
 * idle / `border-border-hover bg-card-selected` selected) and the selected
 * provider's detail on the right (`p-4 pb-20 sm:p-6 sm:pb-24`). Nova's vertical
 * accordion list was its own invention; this section now renders the
 * reference's split, and each half scrolls on its own.
 *
 * **详情即改即存**（the reference has NO save/cancel footer): a field commits
 * when it loses focus, and a roster change commits with the click. The wire
 * unit is still the whole `providers[]` list (`save_providers` protocol), so
 * every commit sends the full roster with ONLY this row's draft taking part —
 * the rest ride as stored, exactly the one-card-per-save rule the old footer
 * had. A refused or unreadable draft simply stays on screen with its reason;
 * nothing is dropped.
 *
 * 本仓与参考实现的差异，都有理由：
 *  - **请求参数（temperature / maxTokens / contextWindow）在详情里**：schema
 *    （`cli/src/config-schema-models.ts`）把这三个字段放在 provider 条目上，而
 *    `models[]` 条目是 `.strict()` 的——写进去会让整份配置加载失败。
 *  - **「设为当前」发的是 `set_provider`，不是带 `activeId` 的 `save_providers`**：
 *    只有前者会 `ChatProvider.setEndpoint` 就地改写在役客户端；带指针的保存会把
 *    「当前使用」写进文件却把请求留在旧端点上。前置条件（已存进文件、已有密钥）
 *    不满足时按钮禁用并写明原因。参照头部的 Switch 座位（enable 开关）在这里
 *    是同一颗「设为当前」——本仓的在役是单选事实，不是可并行的开关组。
 *  - **删除立刻生效**：整份替换的协议下，一次删除就是一次保存。删的是**当前**
 *    供应商时，指针显式重指到剩下的第一行。未保存的添加卡删除即丢弃草稿，
 *    不发帧。写盘可再添加，所以不设确认弹窗。
 *  - **端点一换就补问模型目录的数据**：切换后目录还属于旧端点（`state.catalog`
 *    只由帧驱动），由发起切换的这一段补问。
 */
import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { parseCapacityField } from './ModelConfigEditor.js';
import { ProviderModelsPicker } from './ProviderModelsDialog.js';
import { ProviderCardEditor } from './ProviderCardEditor.js';
import { ProviderRow } from './ProviderRow.js';
import type { ProviderDraft } from './provider-draft.js';
import { useManageRefusal, type ManageErrorValue } from './use-manage-refusal.js';
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

export interface ProviderSectionProps {
  /** The host's snapshot; null until the section's first answer lands. */
  providers: ProvidersSnapshot | null;
  /** The last probe answer (or its in-flight marker). */
  probe: ProviderProbe | null;
  /**
   * The shared refusal channel, attributed by this section's own writes: a
   * refused save is answered by an `error` frame, not a snapshot, and the
   * sentence belongs where the edit was made.
   */
  manageError?: ManageErrorValue | null;
  /** Whether this section holds unsaved edits, reported whenever it changes. */
  onDirtyChange?: (dirty: boolean) => void;
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
 * 「这次保存落盘了吗」——按内容回答，不按「来了一帧」回答。
 *
 * `save_providers` 没有回执 id：宿主的确认就是广播出来的下一份 `providers`
 * 快照。但共享通道上还会来**别人**的快照（另一个窗口的保存、迟到的首答），
 * 「来了一帧就清草稿」会把操作者还在看的字删掉。所以拿**我们发出去的那份
 * 清单**逐行逐字段对——密钥本身浏览器永远收不到（线上只有 `hasApiKey`），
 * 对比时跳过它。导出给测试车道。
 * @param sent - this save carried, in order.
 * @param incoming - the frame the host broadcast.
 * @param sentActiveId - the active pointer this save asked for, if any.
 * @param incomingActiveId - the pointer the frame carries.
 * @returns true when the frame IS the echo of this save.
 */
export function saveLanded(
  sent: readonly WireProviderRowInput[],
  incoming: readonly WireProviderRow[],
  sentActiveId: string | undefined,
  incomingActiveId: string | undefined,
): boolean {
  if (sent.length !== incoming.length) return false;
  if ((sentActiveId ?? undefined) !== (incomingActiveId ?? undefined)) return false;
  for (const [index, row] of incoming.entries()) {
    const mine = sent[index];
    if (mine === undefined) return false;
    if (mine.id !== row.id || mine.baseURL !== row.baseURL) return false;
    if ((mine.name ?? undefined) !== (row.name ?? undefined)) return false;
    if ((mine.temperature ?? undefined) !== (row.temperature ?? undefined)) return false;
    if ((mine.maxTokens ?? undefined) !== (row.maxTokens ?? undefined)) return false;
    if ((mine.contextWindow ?? undefined) !== (row.contextWindow ?? undefined)) return false;
    const mineModels = mine.models ?? [];
    if (mineModels.length !== row.models.length) return false;
    for (const [modelIndex, model] of row.models.entries()) {
      if (mineModels[modelIndex]?.id !== model.id) return false;
    }
  }
  return true;
}

/**
 * Render the 供应商 section.
 * @param props - see ProviderSectionProps.
 * @returns the section element tree.
 */
export function ProviderSection({ providers, probe, manageError, onDirtyChange, send }: ProviderSectionProps): JSX.Element {
  // On demand, every open: the file is the authority and the operator may have
  // hand-edited it (or another window may have saved), so a cached list could lie.
  useEffect(() => {
    send({ type: 'list_providers' });
  }, [send]);

  // The shared refusal channel, attributed to THIS section's own writes: a
  // refused save lands as an `error` frame and is shown in the detail pane that
  // sent it — not absorbed, and not blamed on a section that never wrote.
  const refusal = useManageRefusal(manageError ?? null);

  const stored = providers?.providers ?? [];
  const activeId = providers?.activeId;
  /** 只记**被改过**的那几行：其余行与已存内容逐字相同，不必进草稿。 */
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  /** 导航选中的行；null = 跟随在役端点（或首行）。 */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 末尾的添加卡（未保存过，所以永远不在 `stored` 里）。 */
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<ProviderDraft | null>(null);
  const [manualModel, setManualModel] = useState('');
  const [probeTarget, setProbeTarget] = useState<string | null>(null);

  // The unsaved-edit report for the settings shell's leave guard: a draft in
  // any row, or an open add-card, is an edit a switch would discard.
  const dirty = Object.keys(drafts).length > 0 || adding;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);

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
   * `row` 是**这次写盘的那一行**：只有它的草稿参与，其余行一律用**已存内容**。
   * 否则提交 B 行会把 A 行还没落盘的编辑一起写进去——一次失焦写了两行的内容，
   * 而读者只动了 B 的字段。未存的添加行追加在末尾。
   */
  const buildListFor = (row: ProviderDraft): WireProviderRowInput[] | undefined => {
    const built: WireProviderRowInput[] = [];
    let placed = false;
    for (const entry of stored) {
      const parsed = entry.id === row.id ? toInputRow(row) : toInputRow(toProviderDraft(entry));
      if (!parsed.ok) return undefined;
      if (entry.id === row.id) placed = true;
      built.push(parsed.entry);
    }
    if (!placed) {
      const parsed = toInputRow(row);
      if (!parsed.ok) return undefined;
      built.push(parsed.entry);
    }
    return built;
  };

  /**
   * 写盘一行：整份清单带上这一行的草稿。**回执按内容匹配**（见 `saveLanded`）
   * ——共享通道上别人的快照不清草稿；写盘被拒时拒绝句就在详情里（`refusal`），
   * 草稿原样，读者改一字再离焦即再存。
   */
  const saveDraft = (row: ProviderDraft): void => {
    if (draftProblem(row) !== null) return;
    const input = buildListFor(row);
    if (input === undefined) return;
    setPendingSave(row.id);
    sentSaveRef.current = { providers: input, activeId };
    refusal.begin();
    send({ type: 'save_providers', providers: input, ...(activeId !== undefined ? { activeId } : {}) });
  };
  /**
   * 字段失焦提交。纯聚焦走过的字段不是一次保存：没有本地编辑就不发帧，
   * 否则点开一行再点别处也会写一遍盘。
   */
  const commitRow = (row: ProviderDraft, isNew: boolean): void => {
    const edited = drafts[row.id] !== undefined || (isNew && newDraft?.id === row.id);
    if (!edited) return;
    saveDraft(row);
  };
  // The save's ACK is the `providers` frame (the file is the truth, the frame is
  // its echo) — but the frame carries no correlation id, and other writers ride
  // the same channel. The echo is recognized by CONTENT: only a frame that
  // matches what this save sent settles it and drops the draft. Anything else
  // (another window's save, a late first answer) leaves the draft alone.
  const [pendingSave, setPendingSave] = useState<string | null>(null);
  const sentSaveRef = useRef<{ providers: WireProviderRowInput[]; activeId: string | undefined } | null>(null);
  useEffect(() => {
    if (providers === null || pendingSave === null) return;
    const sent = sentSaveRef.current;
    if (sent === null) return;
    if (!saveLanded(sent.providers, providers.providers, sent.activeId, providers.activeId)) return;
    const id = pendingSave;
    sentSaveRef.current = null;
    setPendingSave(null);
    refusal.settle();
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (newDraft !== null && newDraft.id === id) {
      setAdding(false);
      setNewDraft(null);
    }
  }, [providers, pendingSave, newDraft, refusal]);
  /** 删除即保存：整份替换的协议下，清单里去掉这一行就是一次写盘。删的是**当前**
      供应商时，指针显式重指到剩下的第一行——把「删掉当前项之后用哪一行」写成帧里
      的事实，而不是让宿主的回落规则替读者猜（两边的答案今天相同，但显式重指让
      「保存了什么」与「页面显示什么」永远一致）。未保存的添加行删的是本地草稿，
      不发帧。 */
  const removeRow = (id: string): void => {
    if (adding && newDraft !== null && newDraft.id === id) {
      setAdding(false);
      setNewDraft(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setSelectedId(null);
      return;
    }
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
    if (selectedId === id) setSelectedId(null);
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
    setSelectedId(id);
  };
  const addModelTo = (row: ProviderDraft, id: string): void => {
    const trimmed = id.trim();
    if (trimmed === '' || row.models.some((model) => model.id === trimmed)) return;
    const next = { ...row, models: [...row.models, { id: trimmed }] };
    update(row, { models: next.models });
    setManualModel('');
    saveDraft(next);
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
   * 探针问的是**哪一行**：答案按地址归属，地址不等于 `probeTarget` 的答案不是
   * 这一张的。存过的行看草稿、添加卡看 `newDraft`（探针本来就能问一个还没
   * 保存的地址）。`poolOpen` 只在答案**成功**时为真——失败没有可挑的东西，
   * 那一行留在详情里（见 `ProviderCardEditor` 的 `poolFail`）。
   */
  const probeDraft: ProviderDraft | undefined = probeTarget === null
    ? undefined
    : (() => {
      const storedMatch = stored.find((entry) => entry.baseURL.trim() === probeTarget);
      if (storedMatch !== undefined) return draftOf(storedMatch);
      if (adding && newDraft !== null && newDraft.baseURL.trim() === probeTarget) return newDraft;
      return undefined;
    })();
  const poolOpen = probeDraft !== undefined && answer !== null && answer.ok;
  const loading = providers === null;
  const storedIds = new Set(stored.map((entry) => entry.id));
  const storedKey = new Map(stored.map((entry) => [entry.id, entry.hasApiKey]));

  /** 详情面板当前承载的一行：添加卡优先于用户点选，点选优先于在役回退。 */
  let detail: { row: ProviderDraft; isNew: boolean } | null = null;
  if (adding && newDraft !== null && (selectedId === null || selectedId === newDraft.id)) {
    detail = { row: newDraft, isNew: true };
  } else {
    const id = selectedId ?? activeId ?? stored[0]?.id;
    const entry = id === undefined ? undefined : stored.find((row) => row.id === id);
    if (entry !== undefined) detail = { row: draftOf(entry), isNew: false };
  }

  return (
    <div className={css.page}>
      {/* 顶部说明 + 新建动作：`SectionLayout.tsx:54-58` 的 description 左 / actions 右。
          页名由设置壳的页标题承担，这里不再有组标题层。 */}
      <div className={css.head}>
        <p className={css.intro}>{SETTINGS_COPY['models.intro']}</p>
        {!adding && (
          <button type="button" className={css.addButton} data-provider-add-new onClick={startAdd}>
            <PlusIcon className={css.addIcon} />
            {SETTINGS_COPY['models.providerAdd']}
          </button>
        )}
      </div>

      {/* 主从卡：一张卡两个滚动列（`SectionLayout.tsx:67-89`）。 */}
      <div className={css.splitCard} data-model-provider-split-panel="true">
        <nav className={css.nav} aria-label={SETTINGS_COPY['models.providerTitle']}>
          <div className={css.navGroup}>
            <h3 className={css.navGroupTitle}>{SETTINGS_COPY['models.providerTitle']}</h3>
            <ul className={css.navList}>
              {stored.map((entry) => {
                const row = draftOf(entry);
                const isActive = entry.id === activeId;
                const hasKey = storedKey.get(entry.id) === true;
                const status: 'active' | 'missing-key' | 'idle' = isActive
                  ? 'active'
                  : hasKey ? 'idle' : 'missing-key';
                return (
                  <ProviderRow
                    key={entry.id}
                    id={entry.id}
                    name={row.name.trim() !== '' ? row.name.trim() : hostLabel(row.baseURL)}
                    status={status}
                    selected={detail !== null && !detail.isNew && detail.row.id === entry.id}
                    onSelect={() => { setSelectedId(entry.id); }}
                  />
                );
              })}
              {adding && newDraft !== null && (
                <ProviderRow
                  key={newDraft.id}
                  id={newDraft.id}
                  name={SETTINGS_COPY['models.providerNew']}
                  status="idle"
                  selected={detail !== null && detail.isNew}
                  onSelect={() => { setSelectedId(newDraft.id); }}
                />
              )}
            </ul>
            {loading && <div className={css.navStatus}>{SETTINGS_COPY['models.providerLoading']}</div>}
          </div>
        </nav>

        <div className={css.detail}>
          {refusal.message !== null && (
            <div className={css.notice} role="alert">{refusal.message}</div>
          )}
          {detail === null && loading && <div className={css.status}>{SETTINGS_COPY['models.providerLoading']}</div>}
          {detail === null && !loading && <div className={css.status}>{SETTINGS_COPY['models.providerEmpty']}</div>}
          {detail !== null && (
            <ProviderCardEditor
              row={detail.row}
              isNew={detail.isNew}
              displayName={detail.row.name.trim() !== ''
                ? detail.row.name.trim()
                : detail.row.baseURL.trim() !== ''
                  ? hostLabel(detail.row.baseURL)
                  : SETTINGS_COPY['models.providerNew']}
              hasKey={storedKey.get(detail.row.id) === true}
              isActive={detail.row.id === activeId}
              canActivate={storedIds.has(detail.row.id) && storedKey.get(detail.row.id) === true && detail.row.id !== activeId}
              blockedReason={!storedIds.has(detail.row.id)
                ? SETTINGS_COPY['models.providerSaveFirst']
                : SETTINGS_COPY['models.providerKeyMissing']}
              problem={draftProblem(detail.row)}
              saving={pendingSave === detail.row.id}
              probePending={probePending}
              probeFail={probeTarget === detail.row.baseURL.trim() && answer !== null && !answer.ok
                ? answer
                : null}
              manualModel={manualModel}
              onEdit={detail.isNew ? patchNew : (patch) => { update(detail.row, patch); }}
              onCommit={() => { commitRow(detail.row, detail.isNew); }}
              onManualModel={setManualModel}
              onAddModel={() => { addModelTo(detail.row, manualModel); }}
              onRemoveModel={(modelId) => {
                const next = { ...detail.row, models: detail.row.models.filter((model) => model.id !== modelId) };
                update(detail.row, { models: next.models });
                saveDraft(next);
              }}
              onProbe={() => {
                setProbeTarget(detail.row.baseURL.trim());
                send({
                  type: 'probe_provider',
                  baseURL: detail.row.baseURL.trim(),
                  // Only a freshly-typed key travels; an empty field means the host
                  // should reuse the stored one (it never left the server).
                  ...(detail.row.apiKey !== '' ? { apiKey: detail.row.apiKey } : {}),
                });
              }}
              onUse={() => { send({ type: 'set_provider', id: detail.row.id }); }}
              onRemove={() => { removeRow(detail.row.id); }}
            />
          )}
        </div>
      </div>

      {/* 探针成功 = 这个弹窗打开。清单的长度由端点决定，所以它必须活在一个固定
          高度的框里；把它铺进详情，详情就会长到几百像素，把设置页撑成一条长滚轴
          （这正是页面级「模型目录」被删掉的同一个理由）。 */}
      {poolOpen && probeDraft !== undefined && (
        <ProviderModelsPicker
          candidates={pool}
          existing={probeDraft.models.map((model) => model.id)}
          onApply={(ids) => {
            const next = { ...probeDraft, models: [...probeDraft.models, ...ids.map((id) => ({ id }))] };
            update(probeDraft, { models: next.models });
            saveDraft(next);
            setProbeTarget(null);
          }}
          onClose={() => { setProbeTarget(null); }}
        />
      )}
    </div>
  );
}
