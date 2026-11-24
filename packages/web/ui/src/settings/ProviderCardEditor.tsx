/**
 * 主从卡的右栏：选中供应商的详情——头部（图标 / 名 / 在役 / 动作）、连接字段、
 * 端点请求参数、模型清单。**没有保存/取消页脚**：字段失焦即提交
 * （`onCommit`，由 `ProviderSection` 落盘），对照的详情就是即改即存的。
 *
 * 从 `ProviderSection` 拆出来的是**职责**：那边管草稿、写盘协议与探针归属
 * （一整台状态机），这一边只把一行的值画成详情，不知道草稿怎么存、清单怎么写。
 * 字段保持非受控于本组件：草稿文本住在父级的 `ProviderDraft` 里，同屏另一行
 * 的保存不会丢正在进行的编辑。
 */
import { useState } from 'react';
import { cx } from '../composer/cx.js';
import { EndpointIcon, EyeIcon, EyeOffIcon, MoreIcon, TrashIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import type { ProviderDraft } from './provider-draft.js';
import css from './ProviderSection.module.css';

export interface ProviderCardEditorProps {
  /** The row being edited: the stored entry's draft, or the unsaved add-card. */
  row: ProviderDraft;
  /** True for the add-card, whose values are not in the stored list yet. */
  isNew: boolean;
  /** The header's name: typed name, else the URL's host, else 新供应商. */
  displayName: string;
  /** Whether a key is already stored for this row (drives the empty-box meaning). */
  hasKey: boolean;
  /** This row is the endpoint in force. */
  isActive: boolean;
  /** 「设为当前」 may be pressed (stored + key + not already active). */
  canActivate: boolean;
  /** Why 「设为当前」 cannot be pressed — shown as its title. */
  blockedReason: string;
  /** Why the draft cannot be saved, or null when it can (`draftProblem`). */
  problem: string | null;
  /** This row's save is in flight (the header says 保存中). */
  saving: boolean;
  /** The probe is in flight for some row (disables its button). */
  probePending: boolean;
  /**
   * The probe's refusal for THIS row, or null when there is none to show.
   *
   * `message` stays OPTIONAL rather than flattened to a string: a refusal frame
   * may arrive without one, and the original markup rendered the box with no
   * detail line in that case. Passing `''` instead would add an empty `<p>` and
   * change the detail's height for a probe that failed silently.
   */
  probeFail: { message?: string | undefined } | null;
  /** The in-progress "add model" text. */
  manualModel: string;
  onEdit: (patch: Partial<ProviderDraft>) => void;
  /** Commit the row as it now stands (field blur). */
  onCommit: () => void;
  onManualModel: (text: string) => void;
  onAddModel: () => void;
  onRemoveModel: (modelId: string) => void;
  onProbe: () => void;
  onUse: () => void;
  onRemove: () => void;
}

/**
 * Render the provider detail pane.
 * @param props - see ProviderCardEditorProps.
 * @returns the detail element tree.
 */
export function ProviderCardEditor({
  row,
  displayName,
  hasKey,
  isActive,
  canActivate,
  blockedReason,
  problem,
  saving,
  probePending,
  probeFail,
  manualModel,
  onEdit,
  onCommit,
  onManualModel,
  onAddModel,
  onRemoveModel,
  onProbe,
  onUse,
  onRemove,
}: ProviderCardEditorProps): JSX.Element {
  const [keyVisible, setKeyVisible] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const needsUrl = row.baseURL.trim() === '';
  return (
    <div className={css.editor} data-provider-detail={row.id}>
      {/* 头部：`ProviderCardSections.tsx:105-131` 的 `flex items-center
          justify-between gap-3` —— 左 `logo size-5` + 16/600 名，右侧 Switch
          与 ghost `icon-sm` 的 more。名在头部**原地可编辑**（点 more → 重命名
          进场，或直接点标题），正文里没有第二个「显示名称」字段。本仓的在役
          是单选事实，Switch 座位给「设为当前」，more 菜单里放重命名与删除。 */}
      <header className={css.detailHead}>
        <div className={css.detailIdentity}>
          <EndpointIcon className={css.detailIcon} />
          {editingName ? (
            <input
              autoFocus
              className={css.nameInput}
              value={row.name}
              placeholder={SETTINGS_COPY['models.providerNamePlaceholder']}
              aria-label={SETTINGS_COPY['models.providerName']}
              onChange={(event) => { onEdit({ name: event.currentTarget.value }); }}
              onBlur={() => { setEditingName(false); onCommit(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { setEditingName(false); onCommit(); }
                if (event.key === 'Escape') { setEditingName(false); setMenuOpen(false); }
              }}
            />
          ) : (
            <button
              type="button"
              className={css.detailName}
              title={SETTINGS_COPY['models.providerRename']}
              onClick={() => { setEditingName(true); }}
            >
              {displayName}
            </button>
          )}
          {isActive && <span className={css.activeTag}>{SETTINGS_COPY['models.providerActive']}</span>}
          {saving && <span className={css.savingHint}>{SETTINGS_COPY['models.providerSaving']}</span>}
        </div>
        <div className={css.detailActions}>
          {!isActive && (
            <button
              type="button"
              className={css.useButton}
              data-provider-use={row.id}
              disabled={!canActivate}
              title={canActivate ? SETTINGS_COPY['models.providerSwitchNote'] : blockedReason}
              onClick={onUse}
            >
              {SETTINGS_COPY['models.providerUse']}
            </button>
          )}
          {/* more 菜单：`ProviderCardSections.tsx:135-160` 的 ghost `icon-sm`
              下拉，重命名与删除都在菜单里。 */}
          <button
            type="button"
            className={css.iconButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={SETTINGS_COPY['models.providerMore']}
            title={SETTINGS_COPY['models.providerMore']}
            onClick={() => { setMenuOpen(!menuOpen); }}
          >
            <MoreIcon className={css.iconButtonGlyph} />
          </button>
          {menuOpen && (
            <div className={css.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={css.menuItem}
                onClick={() => { setMenuOpen(false); setEditingName(true); }}
              >
                {SETTINGS_COPY['models.providerRename']}
              </button>
              <button
                type="button"
                role="menuitem"
                className={cx(css.menuItem, css.menuItemDanger)}
                data-provider-remove={row.id}
                title={SETTINGS_COPY['models.providerRemoveNow']}
                onClick={() => { setMenuOpen(false); onRemove(); }}
              >
                {SETTINGS_COPY['models.providerRemove']}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 正文：`InlineEditableProviderCard.tsx:810-857` 的单列 `space-y-3` ——
          连接 / 密钥 / 模型三块之间**没有分隔线**，只有间距。 */}
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerBaseUrl']}</span>
          <input
            className={css.input}
            value={row.baseURL}
            placeholder={SETTINGS_COPY['models.providerBaseUrlPlaceholder']}
            aria-label={`${SETTINGS_COPY['models.providerBaseUrl']} ${row.id}`}
            spellCheck={false}
            onBlur={onCommit}
            onChange={(event) => { onEdit({ baseURL: event.currentTarget.value }); }}
          />
        </label>
        {/* 密钥框是详情里唯一的 36px 输入（对照 `ApiKeyInput.tsx:38` 的
            `h-9 pr-10`），右侧的眼睛切换明文。 */}
        <div className={css.field}>
          <label className={css.fieldLabel} htmlFor={`key-${row.id}`}>
            {SETTINGS_COPY['models.providerApiKey']}
          </label>
          <div className={css.keySeat}>
            <input
              id={`key-${row.id}`}
              className={css.inputKey}
              type={keyVisible ? 'text' : 'password'}
              value={row.apiKey}
              placeholder={hasKey
                ? SETTINGS_COPY['models.providerApiKeySet']
                : SETTINGS_COPY['models.providerApiKeyPlaceholder']}
              aria-label={`${SETTINGS_COPY['models.providerApiKey']} ${row.id}`}
              spellCheck={false}
              autoComplete="off"
              onBlur={onCommit}
              onChange={(event) => { onEdit({ apiKey: event.currentTarget.value }); }}
            />
            <button
              type="button"
              className={css.eyeButton}
              aria-label={keyVisible
                ? SETTINGS_COPY['models.providerKeyHide']
                : SETTINGS_COPY['models.providerKeyShow']}
              title={keyVisible
                ? SETTINGS_COPY['models.providerKeyHide']
                : SETTINGS_COPY['models.providerKeyShow']}
              onClick={() => { setKeyVisible(!keyVisible); }}
            >
              {keyVisible ? <EyeOffIcon className={css.eyeGlyph} /> : <EyeIcon className={css.eyeGlyph} />}
            </button>
          </div>
          {/* The one fact this field needs, said where the field is: the empty
              box is "keep it", not "erase it". */}
          <p className={css.fieldHint}>{SETTINGS_COPY['models.providerApiKeyHint']}</p>
        </div>
      </div>

      {/* 请求参数：端点级字段，用 fieldset 圈起来，因为它们的写盘位置与模型能力不同。 */}
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
              onBlur={onCommit}
              onChange={(event) => { onEdit({ temperature: event.currentTarget.value }); }}
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
              onBlur={onCommit}
              onChange={(event) => { onEdit({ maxTokens: event.currentTarget.value }); }}
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
              onBlur={onCommit}
              onChange={(event) => { onEdit({ contextWindow: event.currentTarget.value }); }}
            />
          </label>
        </div>
        <p className={css.fieldHint}>{SETTINGS_COPY['models.providerParamsHint']}</p>
      </fieldset>

      {/* 该供应商名下的模型清单（`providers[].models`）。
          对照 `ProviderCardSections.tsx:471-488`：头是 `mb-1 flex flex-wrap
          items-center justify-between gap-3`，左边 `text-ui-base
          text-foreground-subtle`（14px 次级色标签，**不是** 500 加粗标题），
          右边是 secondary `size="default" rounded-lg` 的动作按钮（28px、带
          `+` 图标）——参照里它是「添加模型」，开一个模型编辑弹窗；本仓的模型
          是纯 id，所以这里改成「获取可用模型」（探针），添加走下方输入行。
          清单卡是 `overflow-hidden rounded-lg border border-input-border
          bg-input`，行 `px-3 py-2`、等宽字。 */}
      <div className={css.models}>
        <div className={css.modelsHead}>
          <span className={css.modelsLabel}>{SETTINGS_COPY['models.providerModels']}</span>
          <button
            type="button"
            className={css.secondaryButton}
            data-provider-probe={row.id}
            disabled={probePending || needsUrl}
            title={needsUrl ? SETTINGS_COPY['models.providerProbeNeedsUrl'] : undefined}
            onClick={onProbe}
          >
            <span className={css.plusGlyph} aria-hidden>+</span>
            {probePending ? SETTINGS_COPY['models.providerProbing'] : SETTINGS_COPY['models.providerProbe']}
          </button>
        </div>
        {row.models.length > 0 && (
          <ul className={css.modelList}>
            {row.models.map((model) => (
              <li key={model.id} className={css.modelRow}>
                <span className={css.modelId}>{model.id}</span>
                {/* 上下文徽标：参照模型行在名字后跟一颗 `h-5 rounded-md
                    bg-surface px-1.5 font-mono text-ui-sm` 的容量标
                    （300K / 1M）。本仓的 `contextWindow` 来自线上行，缺省不印。 */}
                {model.contextWindow !== undefined && model.contextWindow > 0 && (
                  <span className={css.modelBadge}>
                    {model.contextWindow >= 1_000_000
                      ? `${String(Math.round(model.contextWindow / 100_000) / 10)}M`
                      : `${String(Math.round(model.contextWindow / 1000))}K`}
                  </span>
                )}
                <button
                  type="button"
                  className={css.iconButton}
                  data-provider-model-remove={model.id}
                  aria-label={`${SETTINGS_COPY['models.providerModelsRemove']} ${model.id}`}
                  title={SETTINGS_COPY['models.providerModelsRemove']}
                  onClick={() => { onRemoveModel(model.id); }}
                >
                  <TrashIcon className={css.iconButtonGlyph} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {row.models.length === 0 && <p className={css.fieldHint}>{SETTINGS_COPY['models.providerModelsEmpty']}</p>}
        <div className={css.addRow}>
          <input
            className={css.input}
            value={manualModel}
            placeholder={SETTINGS_COPY['models.providerAddModelPlaceholder']}
            aria-label={`${SETTINGS_COPY['models.providerAddModel']} ${row.id}`}
            spellCheck={false}
            onChange={(event) => { onManualModel(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onAddModel();
            }}
          />
          <button
            type="button"
            className={css.button}
            data-provider-model-add
            disabled={manualModel.trim() === ''}
            onClick={onAddModel}
          >
            {SETTINGS_COPY['models.providerAddModel']}
          </button>
        </div>
        {/* 探针的**失败**留在详情里：答案没来就没有可挑的东西，弹窗无从谈起，
            而「为什么没来」正是读者此刻要看的那一行。成功则交给弹窗（见
            `ProviderSection` 的 `ProviderModelsPicker`）。 */}
        {probeFail !== null && (
          <div className={css.poolFail} data-provider-pool-fail={row.id} role="alert">
            <span>{SETTINGS_COPY['models.providerProbeFail']}</span>
            {probeFail.message !== undefined && <p className={css.error}>{probeFail.message}</p>}
          </div>
        )}
        {/* 读不出来的字段（越界的数字等）：即改即存被拒的原因写在字段区末尾，
            不弹窗——草稿还在，改一字再离焦即重存。 */}
        {problem !== null && <p className={css.problem} role="alert">{problem}</p>}
      </div>
    </div>
  );
}
