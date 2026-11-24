/**
 * 供应商导航里的一行（主从卡的左栏）：16px 端点字形 + 截断名 + 8px 状态点。
 *
 * 对照 `model-provider-section/Navigation.tsx:112`：`h-8 w-full rounded-lg
 * border px-2 py-1 gap-2`，选中 `border-border-hover bg-card-selected`，未选
 * `border-transparent`（边框常驻但透明——选中只换色，行高不跳）。状态点对照
 * `ProviderStatusIndicator.tsx:32`：8px 实心圆，success（在役）/ warn（缺
 * 密钥）/ idle（其余）。
 *
 * 行内没有动作按钮：编辑就是选中（右栏即编辑面），删除在详情头部——对照的
 * 导航行同样只是选择器。窄栏（<768px 视口）收成 32px 图标行，名字进
 * sr-only，点挂到右下角（对照的 `max-md:` 变体）。
 */
import { EndpointIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { cx } from '../composer/cx.js';
import css from './ProviderSection.module.css';

/** 状态点三态：在役（success）/ 缺密钥（warn）/ 其余（idle）。 */
export type ProviderNavStatus = 'active' | 'missing-key' | 'idle';

const DOT_CLASS: Record<ProviderNavStatus, string | undefined> = {
  active: css.dotActive,
  'missing-key': css.dotMissingKey,
  idle: css.dotIdle,
};

const DOT_LABEL: Record<ProviderNavStatus, string | undefined> = {
  active: SETTINGS_COPY['models.providerActive'],
  'missing-key': SETTINGS_COPY['models.providerKeyMissing'],
  idle: undefined,
};

export interface ProviderRowProps {
  /** The row's id (`data-provider` — the roster's key). */
  id: string;
  /** The display name: the typed one, or the endpoint's host (`hostLabel`). */
  name: string;
  /** The status dot's state. */
  status: ProviderNavStatus;
  /** This row is the selected nav item (its detail is on the right). */
  selected: boolean;
  onSelect: () => void;
}

/**
 * Render one provider nav row.
 * @param props - see ProviderRowProps.
 * @returns the row element tree.
 */
export function ProviderRow({ id, name, status, selected, onSelect }: ProviderRowProps): JSX.Element {
  const dotLabel = DOT_LABEL[status];
  return (
    <li className={css.navItem}>
      <button
        type="button"
        className={cx(css.navRow, selected && css.navRowSelected)}
        data-provider={id}
        data-state={selected ? 'selected' : 'idle'}
        aria-current={selected ? 'true' : undefined}
        title={name}
        onClick={onSelect}
      >
        <EndpointIcon className={css.navIcon} />
        <span className={css.navName}>{name}</span>
        <span
          className={cx(css.dot, DOT_CLASS[status])}
          data-provider-status={status}
          {...(dotLabel !== undefined ? { title: dotLabel, 'aria-label': dotLabel } : {})}
        />
      </button>
    </li>
  );
}
