/**
 * 供应商清单里的一行：身份、状态词、行内动作、第二行读数（地址 / 模型数），
 * 展开后的编辑器作为 `children` 挂在行内。
 *
 * 从 `ProviderSection` 拆出来的是**职责**，不是行数：那边管草稿、保存回执与探针
 * 归属（一整台状态机），这一边只把一行的值画成 ZCode 的设置行
 * （`SettingsPageParts.tsx:196` 的行节奏；`model-provider-section/SectionLayout.tsx:67`
 * 的卡由列表外层提供）。两者共用 `ProviderSection.module.css`，不另开一份样式。
 */
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { cx } from '../composer/cx.js';
import css from './ProviderSection.module.css';

export interface ProviderRowProps {
  /** The stored row's id (`data-provider` — the roster's key). */
  id: string;
  /** The display name: the typed one, or the endpoint's host (`hostLabel`). */
  name: string;
  /** The endpoint address, verbatim (empty renders as 「尚未填写」). */
  baseURL: string;
  /** How many model ids this endpoint records. */
  modelCount: number;
  /** The endpoint in force right now. */
  isActive: boolean;
  /** A key is already stored for this row. */
  hasKey: boolean;
  /** This row's editor is unfolded. */
  open: boolean;
  /** 「设为当前」 may be pressed (stored + key + not already active). */
  canActivate: boolean;
  /** Why 「设为当前」 cannot be pressed — shown as its title. */
  blockedReason: string;
  onToggle: () => void;
  onUse: () => void;
  onRemove: () => void;
  /** The row's editor, rendered under the second line when open. */
  children?: ReactNode;
}

/**
 * Render one provider row.
 * @param props - see ProviderRowProps.
 * @returns the row element tree.
 */
export function ProviderRow({
  id,
  name,
  baseURL,
  modelCount,
  isActive,
  hasKey,
  open,
  canActivate,
  blockedReason,
  onToggle,
  onUse,
  onRemove,
  children,
}: ProviderRowProps): JSX.Element {
  return (
    <li className={cx(css.card, isActive && css.cardActive)} data-provider={id} data-active={isActive ? 'true' : undefined}>
      <div className={css.rowHead}>
        <span className={css.rowIdentity}>
          <span className={css.rowName}>{name}</span>
          {/* 活动项：一个词，不靠顺序暗示。 */}
          {isActive && <span className={css.activeTag}>{SETTINGS_COPY['models.providerActive']}</span>}
          {/* 密钥状态只在**缺**的时候说，且用词说：缺密钥正是「设为当前」按不动的
              那个原因，所以这句话解释的是它旁边那颗灰按钮。配好了则一个字都不印
              ——那颗按钮能按，本身就是读数。 */}
          {!hasKey && <span className={css.keyMissing}>{SETTINGS_COPY['models.providerKeyMissing']}</span>}
        </span>
        <span className={css.rowActions}>
          <button
            type="button"
            className={css.rowButton}
            data-provider-edit={id}
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? <ChevronDownIcon className={css.rowButtonIcon} /> : <ChevronRightIcon className={css.rowButtonIcon} />}
            {open ? SETTINGS_COPY['models.providerCollapse'] : SETTINGS_COPY['models.providerEdit']}
          </button>
          {!isActive && (
            <button
              type="button"
              className={css.rowButton}
              data-provider-use={id}
              disabled={!canActivate}
              title={canActivate ? SETTINGS_COPY['models.providerSwitchNote'] : blockedReason}
              onClick={onUse}
            >
              {SETTINGS_COPY['models.providerUse']}
            </button>
          )}
          <button
            type="button"
            className={cx(css.rowButton, css.rowButtonDanger)}
            data-provider-remove={id}
            title={SETTINGS_COPY['models.providerRemoveNow']}
            onClick={onRemove}
          >
            {SETTINGS_COPY['models.providerRemove']}
          </button>
        </span>
      </div>
      <div className={css.rowMeta}>
        <span className={cx(css.rowUrl, baseURL.trim() === '' && css.rowUrlEmpty)}>
          {baseURL.trim() === '' ? SETTINGS_COPY['models.providerNoUrl'] : baseURL}
        </span>
        <span className={css.rowCount}>
          {modelCount === 0
            ? SETTINGS_COPY['models.providerModelCountZero']
            : `${String(modelCount)} ${SETTINGS_COPY['models.providerModelCount']}`}
        </span>
      </div>
      {children}
    </li>
  );
}
