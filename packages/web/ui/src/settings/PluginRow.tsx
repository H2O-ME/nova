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
import { PluginIcon } from '../icons.js';
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
 * How many rows a folded group leaves on the page. Same number and same reason
 * as the reference's `CATEGORY_VISIBLE_LIMIT`
 * (PluginStoreListView.tsx:28): a fold that keeps only a teaser is still a lie
 * about how much is there, so the hint row counts what remains.
 */
const GROUP_FOLD_LIMIT = 6;

/**
 * Render one tier group: its header, a failure count when it has one, and its rows.
 *
 * The header is PLAIN TEXT with no chevron — the reference's `StoreSection`
 * draws the subject line as a static `h2` (PluginStoreListView.tsx:301-307)
 * and puts the fold at the BOTTOM of the group instead: a folded group ends in
 * "查看其余 N 项" (its `CollapsibleCardGroup`, lines 353-386), an open one ends
 * in 收起 (lines 387-397). Clicking the title was a second, competing entry
 * that the reference does not have.
 *
 * The fold still exists for the reason it was added: a group whose rows carry
 * no switch is reference material rather than a set of controls, and 17 core
 * rows put the first live switch 706px below the fold of a 720px window — the
 * reported 「都藏在页面最底部」. Such a group arrives folded, leaving its first
 * {@link GROUP_FOLD_LIMIT} rows and counting the rest.
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
  // A folded group keeps the reference's six teaser rows (its
  // `items.slice(0, CATEGORY_VISIBLE_LIMIT)`); anything else is behind the
  // hint row, which states the remaining count so nothing disappears silently.
  const folded = foldable && !open;
  const visible = folded ? group.rows.slice(0, GROUP_FOLD_LIMIT) : group.rows;
  const hidden = group.rows.length - visible.length;
  // 收起 is only offered where folding would actually hide rows, exactly like
  // the reference's `expanded && items.length > CATEGORY_VISIBLE_LIMIT`.
  const collapsible = foldable && group.rows.length > GROUP_FOLD_LIMIT;
  // The subject line: title, row count, failed count. No icon and no control —
  // the reference's `px-2 pb-2` heading band (PluginStoreListView.tsx:301-307).
  const head = (
    <>
      {title}
      <span className={css.groupCount}>{`· ${String(group.rows.length)}`}</span>
      {/* The count only appears when it is non-zero: a standing "0 个启动失败"
          is noise on every healthy page. */}
      {failed > 0 && <span className={css.failed}>{`${String(failed)} ${SETTINGS_COPY['plugins.failedCount']}`}</span>}
    </>
  );
  return (
    <section role="group" aria-label={title} className={css.group}>
      <div className={css.groupTitle}>{head}</div>
      {/* The reference's `h-px bg-surface` under a group's subject line: it is
          what separates the heading band from the cards, and it stays whether
          the group is folded or open. */}
      <div aria-hidden="true" className={css.groupRule} />
      <ul className={css.list}>
        {visible.map((entry) => (
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
      {/* The reference's fold seat is the group's FOOT, not its header:
          collapsed → "查看其余 N 项", expanded → 收起
          (PluginStoreListView.tsx:353-397, `mt-2 flex w-full items-center gap-2
          rounded-xl px-2 py-2 … hover:bg-hover`). */}
      {folded && hidden > 0 && (
        <button
          type="button"
          className={css.groupToggle}
          aria-expanded={false}
          onClick={onToggleGroup}
        >
          {SETTINGS_COPY['plugins.viewMore'].replace('{count}', String(hidden))}
        </button>
      )}
      {!folded && collapsible && (
        <button
          type="button"
          className={css.groupToggle}
          aria-expanded
          onClick={onToggleGroup}
        >
          {SETTINGS_COPY['plugins.showLess']}
        </button>
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
        {/* The leading mark, at the reference's 40px seat (`rowIcon`). Nova's
            plugins declare no artwork of their own, so every row draws the
            plugin glyph — the reference's own behaviour for a package that
            ships no icon (`PackageArtwork`'s fallback). */}
        <span className={css.rowIcon} aria-hidden="true">
          <PluginIcon className={css.rowIconGlyph} />
        </span>
        <span className={css.pluginText}>
          {/* The title line carries the row's badges, as the reference's card
              does (its paid-plan / update marks ride beside the name). */}
          <span className={css.pluginTitle}>
            <span className={css.pluginName}>{title}</span>
            {advanced && <span className={css.tag}>{SETTINGS_COPY['plugins.defaultOff']}</span>}
          </span>
          {/* The one-line description sits ON the row, not behind the
              disclosure: it is what tells two plugin names apart, and the
              reference reads it in the collapsed state. The line is drawn even
              when the host sent no description — its `mt-0.5 min-h-5` reserves
              the line box (PluginStoreCard.tsx:378), so a card without one is
              the same height as its neighbours. */}
          <span className={css.pluginDesc}>{entry.description ?? ''}</span>
          <span className={css.pluginMeta}>
            <span className={css.pluginId}>{entry.name}</span>
            {/* A row the switch turned off has ONE fact to state: the roster
                reports its state as `disabled`, so printing the state word and
                「已关闭」 said the same thing twice. The on/off word is gone from
                this line entirely — the switch beside it is the state, and the
                reference's card prints no such word either. */}
            {entry.state !== 'disabled' && ` · ${pluginStateLabel(entry.state)}`}
          </span>
        </span>
      </button>
      {/* The expanded area: what it injects, and — for a core row — why it
          carries no switch rather than a switch. */}
      {open && (
        <div className={css.detail}>
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
