/**
 * 模型目录（第 2 步）：**在役端点上有哪些模型，当前在用哪一个**。
 *
 * 版式对齐 deepseek-harness `ui-settings-models` 的模型列表
 * （`src/client/ModelListEditor.tsx` 的 `modelCatalog` / `modelRow` 一族，MIT，
 * (c) 2026 DeepSeek）：端点名做分组标题（参考实现里那正是 `ModelCatalogPort.label`，
 * 本仓由 `plugins/src/runtime-models.ts` 填成端点 host），下面是一行一个模型。
 *
 * 与参考实现的两处差异：
 *  - 本仓的这一段只**选**模型（`set_model`）；模型的参数在第 3 步编辑，因为参数的
 *    写盘单位是整份 `models[]` 清单，而那一份数据归 `ModelConfigEditor` 的 props。
 *  - 分组标题右边带模型数：参考实现的库样式没有计数，而这里「这个端点上有几个模型」
 *    正是一眼分清多供应商所需的读数。
 *
 * 目录按需取（每次打开都问）：端点是「它提供什么」的唯一权威，缓存的菜单会推荐一个
 * 已经下线的模型。答案落在 `state.catalog`，选择落在 `state.model`（内核事件驱动），
 * 所以勾选永远跟着宿主，不跟着点击的乐观值。
 */
import { useEffect } from 'react';
import { CheckIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsSection } from './Section.js';
import { StepHeading } from './StepHeading.js';
import { cls } from '../sidebar/view.js';
import type { ClientFrame } from '../types.js';
import type { ModelCatalog } from '../state.js';
import css from './ModelSection.module.css';

export interface ModelSectionProps {
  /** The model id in force (`state.model`). */
  model: string;
  /** Whether this kernel can switch models at all (inert text when false). */
  switching: boolean;
  /** The catalog: null until asked, then rows or the reason there are none. */
  catalog: ModelCatalog | null;
  send: (frame: ClientFrame) => void;
}

/**
 * Render the 模型目录 section.
 * @param props - see ModelSectionProps.
 * @returns the section element tree.
 */
export function ModelSection({ model, switching, catalog, send }: ModelSectionProps): JSX.Element {
  // On demand, every open — matching the seat (`ModelSeat.show()`), which re-asks
  // unconditionally for the same reason: the endpoint is the authority on what it
  // serves, and a menu fed from a cached list could offer a model it retired. The
  // catalog survives in reducer state while this section does NOT (the panel
  // unmounts on close), so gating on `catalog === null` meant the first open of a
  // session fetched and every later one reused that list — the opposite of what
  // this effect claims. A manual 重试 control below covers a failed fetch.
  useEffect(() => {
    send({ type: 'list_models' });
  }, [send]);

  const loading = catalog?.loading === true;
  const groups = catalog?.groups ?? [];
  const hasRows = groups.some((group) => group.models.length > 0);

  return (
    <SettingsSection>
      {/* Step 2 of the page's flow: the provider above was step 1. */}
      <StepHeading
        step={2}
        title={SETTINGS_COPY['models.catalogTitle']}
        intro={SETTINGS_COPY['models.catalogIntro']}
      />
      {/* 在役模型与它所属端点，一句话说清（端点名由分组标题给出）。 */}
      <div className={css.current}>
        {model === ''
          ? <span className={css.currentEmpty}>{SETTINGS_COPY['models.catalogNoEndpoint']}</span>
          : (
            <>
              <span className={css.currentLabel}>{SETTINGS_COPY['models.catalogCurrent']}</span>
              <span className={css.currentId}>{model}</span>
            </>
          )}
      </div>
      {loading && <div className={css.status}>{SETTINGS_COPY['models.loading']}</div>}
      {catalog?.error !== undefined && (
        <div className={css.error}>
          <span>{catalog.error}</span>
          <button type="button" className={css.retry} onClick={() => { send({ type: 'list_models' }); }}>
            {SETTINGS_COPY['models.retry']}
          </button>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.id} role="group" aria-label={group.name} className={css.group}>
          <div className={css.groupTitle}>
            <span className={css.groupName}>{group.name}</span>
            <span className={css.groupCount}>{`${String(group.models.length)} ${SETTINGS_COPY['models.providerModelCount']}`}</span>
          </div>
          <ul className={css.list}>
            {group.models.map((option) => {
              const inUse = option.id === model;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={cls(css.row, inUse && css.rowActive)}
                    aria-current={inUse ? 'true' : undefined}
                    disabled={!switching}
                    title={switching ? option.id : SETTINGS_COPY['models.catalogReadOnly']}
                    onClick={() => {
                      if (!inUse) send({ type: 'set_model', model: option.id });
                    }}
                  >
                    <span className={css.rowText}>
                      <span className={css.rowLabel}>{option.name}</span>
                      {/* The id is what a request carries, so it stays visible beside
                          the label: a display name is metadata, the id is the fact. */}
                      <span className={css.rowId}>{option.id}</span>
                    </span>
                    {inUse && <span className={css.rowTag}>{SETTINGS_COPY['models.inUse']}</span>}
                    <span className={css.check}>{inUse ? <CheckIcon /> : null}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!loading && !hasRows && catalog?.error === undefined && (
        <div className={css.status}>{SETTINGS_COPY['models.empty']}</div>
      )}
      {!switching && <p className={css.note}>{SETTINGS_COPY['models.catalogReadOnly']}</p>}
    </SettingsSection>
  );
}
