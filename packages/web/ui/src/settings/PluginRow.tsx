/**
 * One 插件管理 row and one tier group, as plain components.
 *
 * Split from `PluginsSection.tsx` so that file answers only "how is the page
 * assembled" (search, request, flip bookkeeping) while this one answers "what
 * does a row look like". They change for different reasons — a row's anatomy
 * versus the page's data flow — and the section was long enough that the two
 * were being read as one.
 *
 * The row is a DISCLOSURE, and the markup is shaped by one HTML constraint: a
 * `<button>` cannot contain another `<button>`, and browsers disagree about
 * which one a click reaches when it tries. So the row is `<li>` holding TWO
 * siblings in a flex line — `.rowToggle` (the leading area, which expands) and
 * the switch — rather than one wrapper element around both.
 */
import { ChevronDownIcon, ChevronRightIcon } from '../icons.js';
import { Switch } from './Switch.js';
import { SETTINGS_COPY } from './copy.js';
import { pluginStateLabel } from './plugin-state.js';
import { rowSwitchable, rowTitle, type PluginRowGroup } from './row-model.js';
import type { WireRosterEntry } from '../types.js';
import css from './PluginsSection.module.css';

/** One group's header, resolved from the tier by the caller's own table. */
export interface PluginGroupProps {
  group: PluginRowGroup;
  /** The group's Chinese title. */
  title: string;
  /** Whether the group is unfolded. */
  open: boolean;
  /**
   * Whether the header may fold at all. False while the roster is being
   * filtered: a hit inside a folded group would be invisible, and a control that
   * cannot change what is on screen is the thing this page is being fixed for.
   */
  foldable: boolean;
  expanded: ReadonlySet<string>;
  disabled: boolean;
  /** Why the switches are locked, or null when they are live. */
  lockedNote: string | null;
  switching: string | null;
  onToggleGroup: () => void;
  onToggle: (name: string) => void;
  onFlip: (name: string, enabled: boolean) => void;
}

/**
 * Render one tier group: its header, a failure count when it has one, and its rows.
 *
 * The header folds. A group whose rows carry no switch is reference material
 * rather than a set of controls, and it was pushing the controls off the page:
 * 17 core rows put the first live switch 706px below the fold of a 720px window
 * — the reported 「都藏在页面最底部」. Such a group arrives folded, and its
 * header states how many rows are behind it, so nothing disappears silently.
 *
 * @param props - see PluginGroupProps.
 * @returns the group element (or null when it has no rows).
 */
export function PluginGroup({
  group,
  title,
  open,
  foldable,
  expanded,
  disabled,
  lockedNote,
  switching,
  onToggleGroup,
  onToggle,
  onFlip,
}: PluginGroupProps): JSX.Element | null {
  if (group.rows.length === 0) return null;
  const failed = group.rows.filter((entry) => entry.state === 'failed').length;
  // The count is the whole reason a folded group is not a lie: the reader sees
  // how much is behind the header without opening it.
  const head = (
    <>
      {foldable && (open ? <ChevronDownIcon className={css.groupHeadIcon} /> : <ChevronRightIcon className={css.groupHeadIcon} />)}
      {title}
      <span className={css.groupCount}>{`· ${String(group.rows.length)}`}</span>
      {/* The count only appears when it is non-zero: a standing "0 个启动失败"
          is noise on every healthy page. */}
      {failed > 0 && <span className={css.failed}>{`${String(failed)} ${SETTINGS_COPY['plugins.failedCount']}`}</span>}
    </>
  );
  return (
    <section role="group" aria-label={title} className={css.group}>
      {foldable ? (
        <button
          type="button"
          className={css.groupHead}
          aria-expanded={open}
          title={SETTINGS_COPY['plugins.groupToggle']}
          onClick={onToggleGroup}
        >
          {head}
        </button>
      ) : (
        <div className={css.groupTitle}>{head}</div>
      )}
      {open && (
        <ul className={css.list}>
          {group.rows.map((entry) => (
            <PluginRow
              key={entry.name}
              entry={entry}
              switchable={group.switchable}
              advanced={group.tier === 'advanced'}
              open={expanded.has(entry.name)}
              disabled={disabled}
              lockedNote={lockedNote}
              switching={switching}
              onToggle={onToggle}
              onFlip={onFlip}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface PluginRowProps {
  entry: WireRosterEntry;
  /** Whether this row's GROUP allows a switch at all (`core` does not). */
  switchable: boolean;
  /** Whether the row is in the opt-in tier, which gets the 默认关闭 mark. */
  advanced: boolean;
  open: boolean;
  disabled: boolean;
  /** Why the switches are locked, or null when they are live. */
  lockedNote: string | null;
  switching: string | null;
  onToggle: (name: string) => void;
  onFlip: (name: string, enabled: boolean) => void;
}

/**
 * Render one plugin row.
 * @param props - see PluginRowProps.
 * @returns the row element.
 */
export function PluginRow({
  entry,
  switchable,
  advanced,
  open,
  disabled,
  lockedNote,
  switching,
  onToggle,
  onFlip,
}: PluginRowProps): JSX.Element {
  const on = entry.enabled ?? true;
  const canSwitch = switchable && rowSwitchable(entry);
  const title = rowTitle(entry);
  return (
    <li
      className={css.plugin}
      data-failed={entry.state === 'failed' ? 'true' : undefined}
    >
      {/* The whole leading area is the disclosure control: a reader clicks the
          name, not a bare chevron. */}
      <button
        type="button"
        className={css.rowToggle}
        aria-expanded={open}
        /* The row's own words carry the meaning; the identifier is what a
           reader compares against `/plugins` and the config file. */
        aria-label={`${title}（${entry.name}）：${pluginStateLabel(entry.state)}`}
        onClick={() => { onToggle(entry.name); }}
      >
        <span className={css.pluginText}>
          <span className={css.pluginName}>{title}</span>
          <span className={css.pluginMeta}>
            <span className={css.pluginId}>{entry.name}</span>
            {/* A row the switch turned off has ONE fact to state: the roster
                reports its state as `disabled`, so printing the state word and
                「已关闭」 said the same thing twice. The off row keeps the
                operator's word; every other phase (failed, loading, …) still
                prints, because there it adds. */}
            {entry.state !== 'disabled' && ` · ${pluginStateLabel(entry.state)}`}
            {` · ${on ? SETTINGS_COPY['plugins.on'] : SETTINGS_COPY['plugins.off']}`}
            {advanced && <span className={css.tag}>{SETTINGS_COPY['plugins.defaultOff']}</span>}
          </span>
        </span>
      </button>
      {/* The expanded area: the description, what it injects, and — for a core
          row — why it carries no switch rather than a switch. */}
      {open && (
        <div className={css.detail}>
          {entry.description !== undefined && entry.description.length > 0 && (
            <p className={css.detailLine}>{entry.description}</p>
          )}
          {/* Why an enabled row has no fiber (an extension whose package could
              not load): the reason belongs with the row, not only in the host's
              stdout — the reader acting here is the one who can fix it. */}
          {entry.error !== undefined && <p className={css.detailLine}>{`加载失败：${entry.error}`}</p>}
          {entry.inject.length > 0 && <p className={css.detailLine}>{`依赖：${entry.inject.join(' / ')}`}</p>}
          {!canSwitch && <p className={css.detailLine}>{SETTINGS_COPY['plugins.locked']}</p>}
        </div>
      )}
      {canSwitch && (
        /* The shared `Switch`: one control, three sections, so the appearance
           cannot drift. The reason it is locked travels in `title` — a silently
           greyed control leaves the reader guessing.

           Only the row whose OWN write is in flight refuses input. Disabling
           every switch in the section for the duration of one write made the
           whole list dim and come back on each toggle — the reported
           「开关一次整个页面都要闪烁」 — and the reference does it per row
           (`busy: (row) => boolean`, `disabled={busy || locked}`). */
        <Switch
          checked={on}
          disabled={disabled || switching === entry.name}
          busy={switching === entry.name}
          label={`${title}，当前：${on ? SETTINGS_COPY['plugins.on'] : SETTINGS_COPY['plugins.off']}`}
          title={lockedNote ?? (on ? SETTINGS_COPY['plugins.on'] : SETTINGS_COPY['plugins.off'])}
          onChange={(next) => { onFlip(entry.name, next); }}
        />
      )}
    </li>
  );
}
