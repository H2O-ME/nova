/**
 * 「获取可用模型」的挑选弹窗：端点公布了几十个模型，**挑几个加进这张卡**。
 *
 * 版式对齐 deepseek-harness `ui-settings-models` 的取模流程（`ModelListEditor.tsx`
 * 的 `fetchDialog` / `candidateToolbar` / `candidateList` + `ModelsSection.module.css`，
 * MIT，(c) 2026 DeepSeek）：一个搜索框 + 一个全选/清空动词 + 一个**自带滚动、上限
 * 320px** 的勾选清单 + 「取消 / 添加所选」卡脚。
 *
 * 为什么必须是个弹窗：这份清单的长度由**端点**决定，不由本仓决定。把它铺在页面里
 * （卡内一墙 id 按钮、页面再一墙模型目录），设置页就被两个不受控的长列表撑成一条
 * 长滚轴，真正的设置项被顶到屏幕之外。弹窗把「选哪几个」关进一个固定高度的框里，
 * 页面高度重新由设置项决定。
 *
 * 两条读法：
 *  - **只做「加」**：清单里已有的行勾上并锁定（写明「已在清单」），移除走卡片上的
 *    模型条目。取消勾选一个已存在的模型等于移除，是另一种动词——混在一起会让
 *    「清空 + 添加所选」变成一次静默的删除。
 *  - **搜索是纯过滤**：大小写无关子串，命中 id。全选/清空作用于**过滤后的行**，
 *    否则「全选」在一屏 5 行时会悄悄勾上另外 41 个看不见的。
 *
 * 它是**纯呈现**：候选来自调用方的探针答案，勾选与查询是本地状态，确认只回调一次
 * `onApply(ids)`。portal-free 的 `ProviderModelsDialog` 与带 portal 的
 * `ProviderModelsPicker` 分开，前者给无 DOM 的静态车道直测。
 */
import { useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import { SearchIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import css from './ProviderModelsDialog.module.css';

export interface ProviderModelsDialogProps {
  /** The models the endpoint published (the probe's answer). */
  candidates: readonly string[];
  /** The ones this provider already records — checked and locked. */
  existing: readonly string[];
  /** Take the picked ids into the card's draft. Called once, on 添加所选. */
  onApply: (ids: readonly string[]) => void;
  /** Dismiss without taking anything. */
  onClose: () => void;
}

/** Case-insensitive substring over the id; an empty query keeps every row. */
export function filterCandidates(candidates: readonly string[], query: string): readonly string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return candidates;
  return candidates.filter((id) => id.toLowerCase().includes(needle));
}

export function ProviderModelsPicker(props: ProviderModelsDialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalLayer(panelRef, true, props.onClose);
  return createPortal(<ProviderModelsDialog {...props} panelRef={panelRef} />, document.body);
}

/** The dialog's ref seat, supplied by the portaled wrapper (absent in the static lane). */
export interface ProviderModelsDialogMarkupProps extends ProviderModelsDialogProps {
  /** The panel element, for the modal layer's focus and Escape ownership. */
  panelRef?: MutableRefObject<HTMLDivElement | null> | undefined;
}

/**
 * The dialog markup, portal-free so the static lane can walk it without a
 * document.
 * @param props - see {@link ProviderModelsDialogMarkupProps}.
 * @returns the dialog element tree.
 */
export function ProviderModelsDialog({
  candidates,
  existing,
  onApply,
  onClose,
  panelRef,
}: ProviderModelsDialogMarkupProps): JSX.Element {
  const titleId = useId();
  const [query, setQuery] = useState('');
  /** 只记**这次新勾上**的：已有的行锁着，不进这个集合。 */
  const [picked, setPicked] = useState<readonly string[]>([]);
  const has = new Set(existing);
  const shown = filterCandidates(candidates, query);
  // 全选/清空只看屏上的行：`picked` 里可能有被查询滤掉的那些，它们**不算数**
  // （看不见的东西不该被一个可见的动词改掉）。分母是**可以勾的**行——已在清单的
  // 行锁着、不进 `picked`，把它们算进「全选了吗」会让一个全是锁定行的弹窗显示
  // 「清空」，而点下去什么也不会发生。
  const pickable = shown.filter((id) => !has.has(id));
  const allShown = pickable.length > 0 && pickable.every((id) => picked.includes(id));

  const toggle = (id: string): void => {
    setPicked((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };
  const toggleAll = (): void => {
    setPicked((current) => {
      const onScreen = new Set(shown);
      const kept = current.filter((id) => !onScreen.has(id));
      return allShown ? kept : [...kept, ...shown.filter((id) => !has.has(id) && !kept.includes(id))];
    });
  };

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={css.header}>
          {/* The title names the JOB: this dialog adds to the card's list, it does
              not switch what the session is using. */}
          <div className={css.title} id={titleId}>{SETTINGS_COPY['models.pickTitle']}</div>
        </div>

        <div className={css.toolbar}>
          <div className={css.search}>
            <SearchIcon className={css.searchIcon} />
            <input
              type="search"
              className={css.searchInput}
              value={query}
              autoFocus
              data-modal-autofocus=""
              placeholder={SETTINGS_COPY['models.pickSearch']}
              aria-label={SETTINGS_COPY['models.pickSearch']}
              onChange={(event) => { setQuery(event.currentTarget.value); }}
            />
          </div>
          {/* One verb, two labels: the reference's `selectAll` / `deselectAll`.
              Absent when nothing on screen is pickable (all rows locked). */}
          {pickable.length > 0 && (
            <button type="button" className={css.verb} data-pick-all onClick={toggleAll}>
              {allShown ? SETTINGS_COPY['models.pickNone'] : SETTINGS_COPY['models.pickAll']}
            </button>
          )}
        </div>

        {candidates.length === 0 && (
          <div className={css.empty}>{SETTINGS_COPY['models.providerNoReachable']}</div>
        )}
        {candidates.length > 0 && shown.length === 0 && (
          <div className={css.empty}>{SETTINGS_COPY['models.pickNoMatch']}</div>
        )}
        {shown.length > 0 && (
          <ul className={css.list}>
            {shown.map((id) => {
              const already = has.has(id);
              const checked = already || picked.includes(id);
              return (
                <li key={id}>
                  <label className={css.row} data-pick-row={id}>
                    <input
                      type="checkbox"
                      className={css.box}
                      checked={checked}
                      /* 已记录的行锁定：本弹窗只做「加」，移除在卡片上。 */
                      disabled={already}
                      onChange={() => { toggle(id); }}
                    />
                    <span className={css.id} title={id}>{id}</span>
                    {already && <span className={css.tag}>{SETTINGS_COPY['models.pickExisting']}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className={css.footer}>
          <button type="button" className={css.secondary} onClick={onClose}>
            {SETTINGS_COPY['models.pickCancel']}
          </button>
          <button
            type="button"
            className={css.primary}
            data-pick-apply
            disabled={picked.length === 0}
            onClick={() => { onApply(picked); }}
          >
            {SETTINGS_COPY['models.pickApply']}
          </button>
        </div>
      </div>
    </div>
  );
}
