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
import { useEffect, useRef, useState } from 'react';
import { SETTINGS_COPY } from './copy.js';
import { ManageError } from './ManageError.js';
import { StateDot, type StateDotState } from '../tool/StateDot.js';
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
}: PluginPageSectionProps): JSX.Element {
  // The request counter lives per MOUNTED SECTION, which is what makes it a
  // correlation id rather than a queue: reopening the page starts over, and a
  // late answer for a previous mount can never be matched to this one (the
  // reducer keys answers by plugin AND id, and this section only reads its own).
  const nextId = useRef(0);
  const ask = (op: string, payload?: unknown): void => {
    nextId.current += 1;
    send(
      payload === undefined
        ? { type: 'plugin_request', id: nextId.current, plugin, op }
        : { type: 'plugin_request', id: nextId.current, plugin, op, payload },
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
  const page = answer?.ok === true ? (answer.result as PluginPageDescriptor | undefined) : undefined;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const signature = page === undefined ? '' : JSON.stringify(page.fields ?? []);
  useEffect(() => {
    if (page === undefined) return;
    const seeded: Record<string, string> = {};
    for (const field of page.fields ?? []) {
      // A secret arrives WITHOUT a value (the plugin never sends one): the field
      // starts blank and blank means "keep what is stored".
      seeded[field.key] = field.kind === 'secret' ? '' : (field.value ?? '');
    }
    setDraft(seeded);
    // `signature` is the descriptor's own content, so a save that changed
    // nothing does not reset the operator's cursor mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const busy = answer?.pending === true;

  return (
    <div className={css.page}>
      <h2 className={css.heading}>{page?.title ?? plugin}</h2>
      {page?.intro !== undefined && <p className={css.intro}>{page.intro}</p>}

      {/* An answer that is not a descriptor is still an answer: a plugin that is
          switched off, or one whose operation threw, says so here. */}
      {answer !== null && answer.ok === false && (
        <div className={css.failure} role="alert">
          <span>{SETTINGS_COPY['pluginPage.failed']}</span>
          <p className={css.failureReason}>{answer.error ?? ''}</p>
        </div>
      )}
      {manageError !== null && <ManageError message={manageError} />}

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

      <div className={css.actions}>
        {(page?.actions ?? []).map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.kind === 'primary' ? css.primary : css.plain}
            disabled={disabled || busy}
            onClick={() => { ask('action', { id: action.id, fields: draft }); }}
          >
            {action.label}
          </button>
        ))}
        {(page?.fields ?? []).length > 0 && (
          <button
            type="button"
            className={css.primary}
            disabled={disabled || busy}
            onClick={() => { ask('save', { fields: draft }); }}
          >
            {busy ? SETTINGS_COPY['pluginPage.saving'] : SETTINGS_COPY['pluginPage.save']}
          </button>
        )}
      </div>

      {page?.note !== undefined && <p className={css.note}>{page.note}</p>}
    </div>
  );
}
