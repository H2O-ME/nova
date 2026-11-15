/**
 * 供应商（BYOK）编辑区：设置页「模型」页——**哪个端点在役**。
 *
 * 版式对齐 ZCode 的设置页资源卡（2026-11-15 复核）：**一张卡**装全部供应商行
 * （`model-provider-section/SectionLayout.tsx:67` 的
 * `rounded-xl border border-border bg-card`），行是设置行节奏
 * （`SettingsPageParts.tsx:196` 的 `border-t px-4 py-3 first:border-t-0`），
 * 组头是 16/600 的标题 + 一行说明；「添加模型提供商」是组头右侧的主色按钮
 * （`SettingsResourceHeaderActions.tsx:113`），不是列表末尾的虚线板。一次只展开
 * 一行编辑器（这一条是 Nova 自己的取舍：参照的卡是左右分栏，它的编辑面在右栏）。
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
import { PlusIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsSection } from './Section.js';
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
   * sentence belongs next to the button that asked.
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
  // refused save lands as an `error` frame and is shown by the card that sent
  // it — not absorbed, and not blamed on a section that never wrote.
  const refusal = useManageRefusal(manageError ?? null);

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

  // The unsaved-edit report for the settings shell's leave guard: a draft in
  // any card, or an open add-card, is an edit a switch would discard.
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

  /** 保存一张卡：只写它的草稿，其余照已存内容。**保存的回执按内容匹配**
      （见 `saveLanded`）——共享通道上别人的快照不清草稿；写盘被拒时拒绝句
      就在卡边（`refusal`），草稿原样，读者改一字再存即可。 */
  const saveCard = (id: string): void => {
    const input = buildList(id);
    if (input === undefined) return;
    setPendingSave(id);
    sentSaveRef.current = { providers: input, activeId: activeId };
    refusal.begin();
    send({ type: 'save_providers', providers: input, ...(activeId !== undefined ? { activeId } : {}) });
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
   * 卡片里（见 `ProviderCardEditor` 的 `poolFail`）。
   */
  const probeRow = probeTarget === null
    ? undefined
    : stored.find((entry) => entry.baseURL.trim() === probeTarget);
  const poolOpen = probeRow !== undefined && answer !== null && answer.ok;
  const loading = providers === null;
  const storedIds = new Set(stored.map((entry) => entry.id));
  const storedKey = new Map(stored.map((entry) => [entry.id, entry.hasApiKey]));

  /**
   * 一张卡（已存或添加中）的编辑器：字段 + 卡脚由 `ProviderCardEditor` 渲染，
   * 这里只把草稿的读写、探针归属和保存动作接进去。
   */
  const editorFor = (row: ProviderDraft, isNew: boolean): JSX.Element => {
    const write = (patch: Partial<ProviderDraft>): void => {
      if (isNew) patchNew(patch);
      else update(row, patch);
    };
    // The probe's refusal belongs to the card whose address it was asked about,
    // never to whichever card happens to be open. The frame itself travels (not
    // its text) so a refusal with no detail line keeps rendering without one.
    const fail = probeTarget === row.baseURL.trim() && answer !== null && !answer.ok
      ? answer
      : null;
    return (
      <ProviderCardEditor
        row={row}
        isNew={isNew}
        hasKey={storedKey.get(row.id) === true}
        problem={draftProblem(row)}
        dirty={drafts[row.id] !== undefined}
        probePending={probePending}
        probeFail={fail}
        manualModel={manualModel}
        onEdit={write}
        onManualModel={setManualModel}
        onAddModel={() => { addModelTo(row, manualModel); }}
        onRemoveModel={(modelId) => {
          write({ models: row.models.filter((entry) => entry.id !== modelId) });
        }}
        onProbe={() => {
          setProbeTarget(row.baseURL.trim());
          send({
            type: 'probe_provider',
            baseURL: row.baseURL.trim(),
            // Only a freshly-typed key travels; an empty field means the host
            // should reuse the stored one (it never left the server).
            ...(row.apiKey !== '' ? { apiKey: row.apiKey } : {}),
          });
        }}
        onSave={() => { saveCard(row.id); }}
        onCancel={() => { cancelCard(row.id); }}
      />
    );
  };

  return (
    <div className={css.page}>
      {/* 页面说明在卡外：对齐 ZCode `model-provider-section/SectionLayout.tsx:54-56`
          （`text-ui-base leading-6 text-foreground-subtle`）。页名由设置壳的页标题
          承担（`SettingsPanel.module.css` 的 `.pageTitle`），这一段不再重复「模型」。 */}
      <p className={css.intro}>{SETTINGS_COPY['models.intro']}</p>

      <section className={css.group}>
        {/* 组头：16/600 组标题 + 一组一句 14/24，右侧是资源动作。ZCode 的
            `SettingsPage.tsx:1766` 页标题下就是这种组头结构（常规页可见）。 */}
        <div className={css.groupHead}>
          <div className={css.groupText}>
            <h3 className={css.groupTitle}>{SETTINGS_COPY['models.providerTitle']}</h3>
            <p className={css.groupDesc}>{SETTINGS_COPY['models.providerIntro']}</p>
          </div>
          {/* 「添加」是组头的资源动作：ZCode `SettingsResourceHeaderActions.tsx:113-124`
              把新建放在资源头右侧，而不是列表末尾。 */}
          {!adding && (
            <button type="button" className={css.addButton} data-provider-add-new onClick={startAdd}>
              <PlusIcon className={css.addIcon} />
              {SETTINGS_COPY['models.providerAdd']}
            </button>
          )}
        </div>

        <SettingsSection>
          {/* A refused save is this section's own fact (its write started it), said
              once at the top of the roster — the draft it protected is still on the
              card, unchanged. */}
          {refusal.message !== null && (
            <div className={css.notice} role="alert">{refusal.message}</div>
          )}
          {loading && <div className={css.status}>{SETTINGS_COPY['models.providerLoading']}</div>}
          {!loading && stored.length === 0 && !adding && (
            <div className={css.status}>{SETTINGS_COPY['models.providerEmpty']}</div>
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
                <ProviderRow
                  key={entry.id}
                  id={entry.id}
                  name={row.name.trim() !== '' ? row.name.trim() : hostLabel(row.baseURL)}
                  baseURL={row.baseURL}
                  modelCount={row.models.length}
                  isActive={isActive}
                  hasKey={hasKey}
                  open={open}
                  canActivate={canActivate}
                  blockedReason={blocked}
                  onToggle={() => { setOpenId(open ? null : entry.id); }}
                  onUse={() => { send({ type: 'set_provider', id: entry.id }); }}
                  onRemove={() => { removeRow(entry.id); }}
                >
                  {open && editorFor(row, false)}
                </ProviderRow>
              );
            })}

            {adding && newDraft !== null && (
              <li className={css.card} data-provider={newDraft.id} data-provider-new="true">
                <div className={css.rowHead}>
                  <span className={css.rowIdentity}>
                    <span className={css.rowName}>{SETTINGS_COPY['models.providerAdd']}</span>
                  </span>
                </div>
                {editorFor(newDraft, true)}
              </li>
            )}
          </ul>
        </SettingsSection>
      </section>

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
    </div>
  );
}
