/**
 * One provider card's editor body: the connection fields, the endpoint's request
 * parameters, its model roster, and the card's own footer.
 *
 * It was a ~200-line closure (`renderEditor`) inside `ProviderSection`, which
 * also owned the draft map, the save/delete protocol and the probe's state —
 * four jobs in one function. The split is by responsibility, not by line count:
 * this file renders ONE card from the values and callbacks it is handed, and
 * knows nothing about how a draft is stored or how the list is written back.
 *
 * Every control stays uncontrolled-by-design here: the draft text lives in the
 * parent's `ProviderDraft`, so an in-progress edit survives a sibling card's
 * save, and this component never holds field state of its own.
 */
import { SETTINGS_COPY } from './copy.js';
import type { ProviderDraft } from './provider-draft.js';
import css from './ProviderSection.module.css';

export interface ProviderCardEditorProps {
  /** The row being edited: the stored entry, or the unsaved add-card. */
  row: ProviderDraft;
  /** True for the add-card, whose values are not in the stored list yet. */
  isNew: boolean;
  /** Whether a key is already stored for this row (drives the empty-box meaning). */
  hasKey: boolean;
  /** Why the draft cannot be saved, or null when it can (`draftProblem`). */
  problem: string | null;
  /** The draft differs from what is stored (or the card is new) — enables save. */
  dirty: boolean;
  /** The probe is in flight for some card (disables its button). */
  probePending: boolean;
  /**
   * The probe's refusal for THIS card, or null when there is none to show.
   *
   * `message` stays OPTIONAL rather than flattened to a string: a refusal frame
   * may arrive without one, and the original markup rendered the box with no
   * detail line in that case. Passing `''` instead would add an empty `<p>` and
   * change the card's height for a probe that failed silently.
   */
  probeFail: { message?: string | undefined } | null;
  /** The in-progress "add model" text. */
  manualModel: string;
  onEdit: (patch: Partial<ProviderDraft>) => void;
  onManualModel: (text: string) => void;
  onAddModel: () => void;
  onRemoveModel: (modelId: string) => void;
  onProbe: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Render one provider card's editor.
 * @param props - see ProviderCardEditorProps.
 * @returns the editor element tree.
 */
export function ProviderCardEditor({
  row,
  isNew,
  hasKey,
  problem,
  dirty,
  probePending,
  probeFail,
  manualModel,
  onEdit,
  onManualModel,
  onAddModel,
  onRemoveModel,
  onProbe,
  onSave,
  onCancel,
}: ProviderCardEditorProps): JSX.Element {
  const canSave = problem === null && (isNew || dirty);
  const needsUrl = row.baseURL.trim() === '';
  return (
    <div className={css.editor}>
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{SETTINGS_COPY['models.providerName']}</span>
          <input
            className={css.input}
            value={row.name}
            placeholder={SETTINGS_COPY['models.providerNamePlaceholder']}
            aria-label={`${SETTINGS_COPY['models.providerName']} ${row.id}`}
            onChange={(event) => { onEdit({ name: event.currentTarget.value }); }}
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
            onChange={(event) => { onEdit({ baseURL: event.currentTarget.value }); }}
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
            onChange={(event) => { onEdit({ apiKey: event.currentTarget.value }); }}
          />
          {/* The one fact this field needs, said where the field is: the empty
              box is "keep it", not "erase it". */}
          <p className={css.fieldHint}>{SETTINGS_COPY['models.providerApiKeyHint']}</p>
        </label>
      </div>

      {/* 请求参数：端点的采样参数，随端点保存（模型能力在「高级」里）。 */}
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
              onChange={(event) => { onEdit({ contextWindow: event.currentTarget.value }); }}
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
            disabled={probePending || needsUrl}
            title={needsUrl ? SETTINGS_COPY['models.providerProbeNeedsUrl'] : undefined}
            onClick={onProbe}
          >
            {probePending ? SETTINGS_COPY['models.providerProbing'] : SETTINGS_COPY['models.providerProbe']}
          </button>
        </div>
        {row.models.length === 0 && <p className={css.fieldHint}>{SETTINGS_COPY['models.providerModelsEmpty']}</p>}
        {row.models.length > 0 && (
          <ul className={css.modelChips}>
            {row.models.map((model) => (
              <li key={model.id} className={css.modelChip}>
                <span className={css.modelChipId}>{model.id}</span>
                <button
                  type="button"
                  className={css.chipRemove}
                  data-provider-model-remove={model.id}
                  aria-label={`${SETTINGS_COPY['models.providerModelsRemove']} ${model.id}`}
                  title={SETTINGS_COPY['models.providerModelsRemove']}
                  onClick={() => { onRemoveModel(model.id); }}
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
        {/* 探针的**失败**留在卡里：答案没来就没有可挑的东西，弹窗无从谈起，
            而「为什么没来」正是读者此刻要看的那一行。成功则交给弹窗（见下方的
            `ProviderModelsPicker`）——它才是挑模型的地方。 */}
        {probeFail !== null && (
          <div className={css.poolFail} data-provider-pool-fail={row.id} role="alert">
            <span>{SETTINGS_COPY['models.providerProbeFail']}</span>
            {probeFail.message !== undefined && <p className={css.error}>{probeFail.message}</p>}
          </div>
        )}
      </div>

      {/* 卡脚（参考实现的 `EditorFooter`）：取消居左、提交居右。保存这张卡 =
          整份清单写盘一次；被拒的原因写在这一行里，不弹窗。 */}
      <div className={css.cardFooter}>
        {problem !== null && <p className={css.problem} role="alert">{problem}</p>}
        <button
          type="button"
          className={css.cancelButton}
          data-provider-cancel={row.id}
          onClick={onCancel}
        >
          {SETTINGS_COPY['models.providerCancel']}
        </button>
        <button
          type="button"
          className={css.saveButton}
          data-provider-save-card={row.id}
          disabled={!canSave}
          onClick={onSave}
        >
          {SETTINGS_COPY['models.providerSave']}
        </button>
      </div>
    </div>
  );
}
