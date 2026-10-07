/**
 * 会话标题模型（config `titleModel`）：一个即时保存的下拉行。
 *
 * 与模型参数编辑器的草稿态刻意不同：这里只有一个值，且宿主的答案（`model_config`
 * 帧里的 `titleModel`）就是状态——选中即发送 `set_title_model`，回帧落定显示，不存在
 * 「没保存的标题模型」这种草稿。候选 = 已存名单 + 端点公布的 id（去重），与模型参数
 * 页的两个来源同源；`null`（不生成）是显式选项，不是空值巧合。
 *
 * 版式复用 `ModelConfigEditor` 的类（同一张页面的同一套行文），不另开一份样式。
 */
import { ChevronDownIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { cls } from '../sidebar/view.js';
import type { ClientFrame } from '../types.js';
import type { ModelConfigSnapshot } from '../state.js';
import css from './ModelConfigEditor.module.css';

export interface TitleModelRowProps {
  config: ModelConfigSnapshot | null;
  writable: boolean;
  send: (frame: ClientFrame) => void;
}

/**
 * 渲染会话标题模型行。
 * @param props - see TitleModelRowProps.
 * @returns the row element tree; `null` until the host's first answer lands
 *   (without it the select would show 「不生成」 as a fact, and it may not be).
 */
export function TitleModelRow({ config, writable, send }: TitleModelRowProps): JSX.Element | null {
  if (config === null) return null;
  const ids = [
    ...new Set([...config.models.map((model) => model.id), ...config.published]),
  ].filter((id) => id !== '');
  return (
    <div className={css.addBlock} data-title-model>
      <label className={css.field}>
        <span className={css.fieldHead}>
          <span className={css.fieldLabel}>{SETTINGS_COPY['models.titleRow']}</span>
        </span>
        <span className={css.selectWrap}>
          <select
            className={cls(css.input, css.select)}
            value={config.titleModel ?? ''}
            aria-label={SETTINGS_COPY['models.titleRow']}
            disabled={!writable}
            data-title-model-select
            onChange={(event) => {
              const value = event.currentTarget.value;
              send({ type: 'set_title_model', model: value === '' ? null : value });
            }}
          >
            <option value="">{SETTINGS_COPY['models.titleNone']}</option>
            {ids.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <ChevronDownIcon className={css.selectIcon} />
        </span>
      </label>
      <p className={css.autoLine}>{SETTINGS_COPY['models.titleHint']}</p>
    </div>
  );
}
