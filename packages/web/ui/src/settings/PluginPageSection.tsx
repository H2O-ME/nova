/**
 * The 插件页面 section: ONE settings page, rendered for any plugin.
 *
 * The plugin returns a {@link PluginPageDescriptor} from its own `page` operation
 * and this renders it — title, prose, status rows, fields, action buttons. The
 * browser knows nothing about the plugin: not its name, not what its fields mean,
 * not what an action does. That is the whole point. The section that used to sit
 * here was hand-written for one channel (three text inputs, a probe button, a
 * live-connection block, its own frames on the wire, its own reducer fields, its
 * own nav entry), and every new plugin with settings needed that entire stack
 * repeated.
 *
 * ## What the browser still owns
 *
 * The transport. It attaches the correlation id, sends `plugin_request`, and
 * renders the answer — including the failure. A refusal is a normal answer here
 * (`ok: false` + a sentence), because "这个插件被关掉了" and "这个操作不存在" are
 * facts about the plugin rather than transport faults, and showing them in place
 * is what keeps one broken plugin from blanking the panel.
 *
 * Secrets are the plugin's business: a `secret` field never receives a stored
 * value (the descriptor may say one IS set), and a blank submission means "leave
 * what is stored alone" — which the plugin implements, because only it knows
 * whether its own field is a secret.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SETTINGS_COPY } from './copy.js';
import { ManageError } from './ManageError.js';
import { StateDot, type StateDotState } from '../tool/StateDot.js';
import { parsePageDescriptor } from './page-descriptor.js';
import { nextPluginRequestId } from './plugin-request-id.js';
import { draftDirty } from './plugin-state.js';
import type { ClientFrame, PluginPageDescriptor } from '../types.js';
import type { PluginRequestAnswer } from '../state.js';
import css from './PluginPageSection.module.css';

/**
 * A status row's tone as the dot's semantic.
 *
 * A plugin writes `ok` / `warn` / `bad` because those are the words of ITS
 * reading; the dot draws them with the shell's own vocabulary. An unknown tone
 * reads as `idle`, the same fail-quiet choice `pluginStateDot` makes: a plugin
 * newer than this bundle gets a neutral mark rather than an invented fault.
 */
function toneDot(tone: string | undefined): StateDotState {
  if (tone === 'ok') return 'done';
  if (tone === 'warn') return 'warning';
  if (tone === 'bad') return 'error';
  return 'idle';
}

/** Narrow a plugin-owned RPC result before reading its optional action fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `pendingAction` marker for the commit button.
 *
 * The save control is not one of the plugin's own `actions` (it exists whenever
 * the page has fields), so it needs a marker that cannot collide with an action
 * id — the page then knows which of its buttons is the one waiting.
 */
const SAVE_ACTION = '\u0000save';

export interface PluginPageSectionProps {
  /** The row's id — the namespace its operations are addressed by. */
  plugin: string;
  /** The last answer to this plugin's `page` (or a `save` / `action`), if any. */
  answer: PluginRequestAnswer | null;
  /** Why a write is refused right now (a run in flight, or no connection). */
  disabled: boolean;
  /** The last management failure, shown in place when an answer is an error. */
  manageError: string | null;
  send(frame: ClientFrame): void;
  /** Forget a previous action's answer (a field edit invalidates it). */
  onEdit(): void;
  /**
   * Whether the operator has unsaved edits on this page, reported whenever it
   * changes. The settings panel reads it to guard section switches — a switch
   * unmounts this component, and an unmount without this report would discard
   * the edit silently.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Render one plugin's page.
 * @param props - see PluginPageSectionProps.
 */
export function PluginPageSection({
  plugin,
  answer,
  disabled,
  manageError,
  send,
  onEdit,
  onDirtyChange,
}: PluginPageSectionProps): JSX.Element {
  // Correlation ids come from the page-wide monotonic source, NOT a per-mount
  // counter: a per-mount restart made this mount's ids collide with a previous
  // mount's, and a slow reply to the previous mount then landed on the fresh
  // page as if it were the fresh page's answer (the reducer keys answers by
  // plugin and drops ids older than the newest it holds — which only isolates
  // mounts when the ids never repeat). See `plugin-request-id.ts`.
  const ask = (op: string, payload?: unknown): void => {
    const id = nextPluginRequestId();
    send(
      payload === undefined
        ? { type: 'plugin_request', id, plugin, op }
        : { type: 'plugin_request', id, plugin, op, payload },
    );
  };

  // Opening the page asks for its descriptor: the plugin decides what to show,
  // and it is asked fresh rather than cached because its answers describe LIVE
  // state (is the channel connected, which credentials are stored).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    ask('page');
    // The plugin's id and the send function are stable for this mount; asking
    // again on every render would be a request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Field values are local edits over what the descriptor last said. A save
  // returns a fresh descriptor, so the drafts are rebuilt from it — never merged,
  // because the plugin may have normalized what it stored.
  const answerResult = answer?.ok === true ? answer.result : undefined;
  const actionResult = isRecord(answerResult) ? answerResult : undefined;
  const returnedDescriptor = answer?.op === 'action' && actionResult !== undefined
    ? actionResult['descriptor']
    : answerResult;
  // A descriptor is PLUGIN-owned data crossing a JSON boundary, so it is
  // validated before rendering sees it: the renderer indexes into its
  // collections (`fields.map`, `guide.length`, `options.map`), and a malformed
  // one used to throw and take the settings panel with it. A bad payload now
  // renders as the failure card with the reason instead.
  const parsed = returnedDescriptor === undefined ? undefined : parsePageDescriptor(returnedDescriptor);
  const invalidReason = parsed !== undefined && !parsed.ok ? parsed.reason : null;
  const validDescriptor = parsed !== undefined && parsed.ok ? parsed.page : undefined;
  const [lastPage, setLastPage] = useState<PluginPageDescriptor | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // What the descriptor last seeded, kept beside the draft: the dirty report is
  // "draft differs from the seed", not "draft differs from an empty object" —
  // a page whose stored value is pre-filled must not read as edited on mount.
  const baselineRef = useRef<Record<string, string>>({});
  const page = validDescriptor ?? lastPage;
  const signature = page === undefined ? '' : JSON.stringify(page.fields ?? []);
  const busy = answer?.pending === true;

  useEffect(() => {
    if (validDescriptor !== undefined) setLastPage(validDescriptor);
  }, [validDescriptor]);
  useEffect(() => {
    if (!busy) setPendingAction(null);
  }, [busy, answer?.id]);

  useEffect(() => {
    if (page === undefined) return;
    const seeded: Record<string, string> = {};
    for (const field of page.fields ?? []) {
      // A secret arrives WITHOUT a value (the plugin never sends one): the field
      // starts blank and blank means "keep what is stored".
      seeded[field.key] = field.kind === 'secret' ? '' : (field.value ?? '');
    }
    baselineRef.current = seeded;
    setDraft(seeded);
    // `signature` is the descriptor's own content, so a save that changed
    // nothing does not reset the operator's cursor mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const actionMessage = answer?.op === 'action' && answer.ok && actionResult !== undefined
    && typeof actionResult['message'] === 'string'
    ? actionResult['message']
    : null;
  const actionFailed = answer?.op === 'action' && answer.ok && actionResult !== undefined
    && actionResult['ok'] === false;
  // The unsaved-edit report (see the prop's doc): any field's draft differing
  // from what the descriptor seeded. A save re-seeds from the fresh descriptor,
  // so a successful save clears it; leaving the section unmounts this component,
  // whose cleanup reports `false` so the guard never fires for a gone page.
  const dirty = useMemo(() => draftDirty(baselineRef.current, draft), [draft]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  // A save that landed answers with the fresh descriptor — which, when the
  // plugin normalized nothing, is byte-identical to what was already on screen.
  // So the page has to SAY it: without this line a successful save is
  // indistinguishable from a dead button, which is exactly how it was reported.
  // The line is dropped by the next edit (`plugin_edit` clears non-`page`
  // answers), so it never outlives the state it describes.
  const saved = answer?.op === 'save' && answer.ok === true;

  return (
    <div className={css.page}>
      <h2 className={css.heading}>{page?.title ?? plugin}</h2>
      {page?.intro !== undefined && <p className={css.intro}>{page.intro}</p>}

      {/* An answer that is not a descriptor is still an answer: a plugin that is
          switched off, or one whose operation threw, says so here. A request that
          is merely IN FLIGHT is not a failure — `pending` carries `ok: false`
          only because there is no result yet, and rendering it would flash the
          failure card on every click. */}
      {answer !== null && answer.ok === false && answer.pending !== true && (
        <div className={css.failure} role="alert">
          <span>{SETTINGS_COPY['pluginPage.failed']}</span>
          <p className={css.failureReason}>{answer.error ?? ''}</p>
        </div>
      )}
      {invalidReason !== null && (
        <div className={css.failure} role="alert">
          <span>{SETTINGS_COPY['pluginPage.invalid']}</span>
          <p className={css.failureReason}>{invalidReason}</p>
        </div>
      )}
      {manageError !== null && <ManageError message={manageError} />}
      {actionMessage !== null && (
        <div className={actionFailed ? css.actionFailure : css.actionSuccess} role={actionFailed ? 'alert' : 'status'}>
          {actionMessage}
        </div>
      )}
      {saved && (
        <div className={css.actionSuccess} role="status">{SETTINGS_COPY['pluginPage.saved']}</div>
      )}

      {page?.guide !== undefined && page.guide.length > 0 && (
        <div className={css.guide}>
          <div className={css.guideTitle}>{SETTINGS_COPY['pluginPage.guideTitle']}</div>
          <ul className={css.guideList}>
            {page.guide.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {page?.status !== undefined && page.status.length > 0 && (
        <dl className={css.status}>
          {page.status.map((row) => (
            <div className={css.statusRow} key={row.label}>
              <dt className={css.statusTerm}>
                {row.tone !== undefined && <StateDot state={toneDot(row.tone)} />}
                {row.label}
              </dt>
              <dd className={css.statusValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(page?.fields ?? []).map((field) => (
        <div className={css.field} key={field.key}>
          <label className={css.label} htmlFor={`${plugin}-${field.key}`}>{field.label}</label>
          {field.kind === 'select' ? (
            <select
              id={`${plugin}-${field.key}`}
              className={css.input}
              value={draft[field.key] ?? ''}
              disabled={disabled || busy}
              onChange={(event) => {
                onEdit();
                setDraft((current) => ({ ...current, [field.key]: event.target.value }));
              }}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : field.kind === 'switch' ? (
            <input
              id={`${plugin}-${field.key}`}
              type="checkbox"
              checked={draft[field.key] === 'true'}
              disabled={disabled || busy}
              onChange={(event) => {
                onEdit();
                setDraft((current) => ({ ...current, [field.key]: String(event.target.checked) }));
              }}
            />
          ) : (
            <input
              id={`${plugin}-${field.key}`}
              className={css.input}
              type={field.kind === 'secret' ? 'password' : 'text'}
              value={draft[field.key] ?? ''}
              placeholder={field.placeholder ?? ''}
              autoComplete="off"
              disabled={disabled || busy}
              onChange={(event) => {
                onEdit();
                setDraft((current) => ({ ...current, [field.key]: event.target.value }));
              }}
            />
          )}
          {field.hint !== undefined && <p className={css.fieldHint}>{field.hint}</p>}
        </div>
      ))}

      {/* The note explains what the buttons below DO ("saving re-mounts this
          row"), so it belongs on their side of the form, not below them — and
          below them it was also physically covered by the footer, which is the
          overlap this order removes. */}
      {page?.note !== undefined && <p className={css.note}>{page.note}</p>}

      {/* The page's commit row. It ends the page rather than sticking to the
          bottom of the scroll column: a sticky bar overlays whatever is under
          it, and there is no honest way to pin a row over the fields it is
          committing. The reference's own editor footer is a plain row too. */}
      <div className={css.actions}>
        {(page?.actions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.kind === 'primary' ? css.primary : css.plain}
            disabled={disabled || busy}
            aria-busy={busy && pendingAction === action.id}
            onClick={() => {
              setPendingAction(action.id);
              ask('action', { id: action.id, fields: draft });
            }}
          >
            {busy && pendingAction === action.id ? SETTINGS_COPY['pluginPage.working'] : action.label}
          </button>
        ))}
        {(page?.fields ?? []).length > 0 && (
          <button
            type="button"
            className={css.primary}
            disabled={disabled || busy}
            aria-busy={busy && pendingAction === SAVE_ACTION}
            onClick={() => {
              setPendingAction(SAVE_ACTION);
              ask('save', { fields: draft });
            }}
          >
            {/* The label tracks THIS button's own write. Reading `busy` alone
                made a running 测试连接 relabel the save control too, so the page
                said two different things were being saved. */}
            {busy && pendingAction === SAVE_ACTION ? SETTINGS_COPY['pluginPage.saving'] : SETTINGS_COPY['pluginPage.save']}
          </button>
        )}
      </div>
    </div>
  );
}
