/**
 * The Skill 中心 section: every discovered skill — project-level
 * (`<root>/.agents/skills/`, then the `.nova/skills/` compatibility root) and
 * system-level (`~/.agents/skills/`, then `~/.nova/skills/`) — with a per-name
 * switch. The host reports which level a row came from, and that is the whole
 * grouping rule; a flip lands as `set_skill_enabled`, and the row in force
 * follows the host's `skills` answer, never the click. The switch is disabled
 * while a run is live (the router refuses mid-run flips: the index is part of
 * the request the live turn is built on).
 *
 * The snapshot is re-asked on every open: a workspace switch re-discovers the
 * project roots, so a cached list could lie about what is installed.
 */
import { useEffect, useMemo, useState } from 'react';
import { SearchIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { ManageError } from './ManageError.js';
import { SettingsSection } from './Section.js';
import { Switch } from './Switch.js';
import { useFlipFeedback } from './use-flip-feedback.js';
import type { ClientFrame } from '../types.js';
import type { SkillsSnapshot } from '../state.js';
import css from './SkillsSection.module.css';

export interface SkillsSectionProps {
  /** The last skills snapshot; null until the first answer lands. */
  skills: SkillsSnapshot | null;
  /** An ask is pending or the socket is down: the switches refuse. */
  disabled: boolean;
  /**
   * The last management refusal, or null. A refused flip answers with an `error`
   * frame rather than a fresh snapshot, so the in-flight switch must watch this
   * too — otherwise it stays disabled for the rest of the panel's life.
   */
  manageError: { readonly seq: number; readonly message: string } | null;
  send: (frame: ClientFrame) => void;
  /**
   * Close the panel (the search field's two-step Escape: clear first, close on
   * the second press — the plugins section's own rule).
   */
  onClose?: (() => void) | undefined;
}

/**
 * Render the Skill 中心 section.
 * @param props - see SkillsSectionProps.
 * @returns the section element tree.
 */
export function SkillsSection({ skills, disabled, manageError, send, onClose }: SkillsSectionProps): JSX.Element {
  useEffect(() => {
    send({ type: 'list_skills' });
  }, [send]);

  const [query, setQuery] = useState('');
  const feedback = useFlipFeedback(manageError);

  const items = skills?.items ?? [];
  const normalized = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () => (normalized.length === 0
      ? items
      : items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(normalized))),
    [items, normalized],
  );
  const project = matches.filter((item) => item.source === 'project');
  const user = matches.filter((item) => item.source !== 'project');
  // The counts behind the discovery roots below. `items` (not `matches`): the
  // roots answer "what is installed here", which a search box must not change.
  const projectTotal = items.filter((item) => item.source === 'project').length;
  const userTotal = items.length - projectTotal;

  const flip = (name: string, enabled: boolean): void => {
    // The row follows the host's answer, not this click: the hook only disables
    // the control until that answer lands (a refusal arrives as an error frame
    // elsewhere — either way this switch is no longer in flight once the next
    // snapshot lands).
    feedback.begin(name, enabled);
    send({ type: 'set_skill_enabled', name, enabled });
  };

  // The answer settles the in-flight flip: a success carries the new rows, and a
  // REFUSAL arrives as an `error` frame (which is why the hook watches that half
  // — the snapshot never changes on that path, so watching `skills` alone left
  // every switch disabled for the rest of the panel's life).
  useEffect(() => {
    if (skills === null) return;
    feedback.settle((done) => done.name);
  }, [skills]);

  const group = (title: string, rows: typeof items, root: string, total: number): JSX.Element | null => {
    if (total === 0) return null;
    return (
      <section role="group" aria-label={title} className={css.group}>
        {/* The discovery root, with its count. This is the page's answer to "我该
           把文件放哪": the group title alone ("项目级") told a reader nothing
           they could act on. Shown when the LEVEL has entries even if the search
           filtered them all out, so a filter never rewrites where things live. */}
        <div className={css.groupTitle}>
          <span>{title}</span>
          <span className={css.rootPath} title={root}>{root}</span>
          <span className={css.rootCount}>{SETTINGS_COPY['skills.rootCount'].replace('{count}', String(total))}</span>
        </div>
        {rows.map((item) => (
          <div key={item.name} className={css.skill}>
            <div className={css.skillText}>
              <div className={css.skillName}>{item.name}</div>
              {item.description.length > 0
                ? <div className={css.skillDesc} title={item.description}>{item.description}</div>
                : <div className={css.skillDescEmpty}>（无描述）</div>}
            </div>
            <Switch
              checked={item.enabled}
              disabled={disabled || feedback.switching !== null}
              label={`${item.name}，当前：${item.enabled ? SETTINGS_COPY['plugins.on'] : SETTINGS_COPY['plugins.off']}`}
              title={disabled ? SETTINGS_COPY['plugins.lockNote'] : (item.enabled ? SETTINGS_COPY['plugins.on'] : SETTINGS_COPY['plugins.off'])}
              onChange={(next) => { flip(item.name, next); }}
            />
          </div>
        ))}
      </section>
    );
  };

  return (
    <SettingsSection>
      <h2 className={css.heading}>{SETTINGS_COPY['skills.title']}</h2>
      <p className={css.intro}>{SETTINGS_COPY['skills.intro']}</p>
      <ManageError message={feedback.error} />
      {skills === null && <div className={css.status}>{SETTINGS_COPY['skills.loading']}</div>}
      {skills !== null && items.length > 0 && (
        <label className={css.search}>
          <SearchIcon className={css.searchIcon} />
          <input
            type="search"
            className={css.searchInput}
            value={query}
            placeholder={SETTINGS_COPY['skills.search']}
            aria-label={SETTINGS_COPY['skills.search']}
            data-modal-escape-owner
            onChange={(event) => { setQuery(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
              event.stopPropagation();
              if (query !== '') {
                setQuery('');
                return;
              }
              onClose?.();
            }}
          />
        </label>
      )}
      {skills !== null && items.length === 0 && (
        <div className={css.status}>{SETTINGS_COPY['skills.empty']}</div>
      )}
      {skills !== null && items.length > 0 && matches.length === 0 && (
        <div className={css.status}>{SETTINGS_COPY['skills.emptySearch']}</div>
      )}
      {group(SETTINGS_COPY['skills.projectGroup'], project, SETTINGS_COPY['skills.projectRoot'], projectTotal)}
      {group(SETTINGS_COPY['skills.userGroup'], user, SETTINGS_COPY['skills.userRoot'], userTotal)}
      {feedback.applied !== null && <div className={css.applied} role="status">{feedback.applied}</div>}
      {disabled && <p className={css.lockNote}>{SETTINGS_COPY['plugins.lockNote']}</p>}
      {feedback.switching !== null && <div className={css.status}>{SETTINGS_COPY['plugins.switching']}</div>}
      {skills !== null && items.length > 0 && (
        <p className={css.hint}>{SETTINGS_COPY['skills.hint']}</p>
      )}
    </SettingsSection>
  );
}
