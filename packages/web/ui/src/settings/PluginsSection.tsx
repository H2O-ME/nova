/**
 * The 插件管理 section: the kernel's live roster — the same rows `/plugins`
 * prints, carried by the `roster` frame — grouped by TIER into 核心功能 /
 * 基础能力 / 扩展能力.
 *
 * Why tiers and not the old origin groups: origin says who SHIPPED a plugin,
 * tier says what a reader may do with it. Those are different questions, and
 * grouping by the first is what made `subagent` (an opt-in capability) read as a
 * system plugin while `jobs` (a plain tool) looked untouchable. The three groups
 * now state the contract directly:
 *
 *  - 核心功能 — load-bearing. NO switch is drawn, and the row explains why
 *    (`plugins.locked`). The kernel refuses these regardless; not drawing the
 *    control is how the page avoids offering a button that throws.
 *  - 基础能力 — ships on, may be turned off. The switch writes that row's own
 *    `enabled` in `plugins.entries`.
 *  - 扩展能力 — OFF until asked for. The row carries `plugins.defaultOff` and the
 *    switch writes the SAME field: one list, one switch per row, so there is no
 *    way for a settings row and a startup to disagree about whether it is on.
 *
 * Rows expand to show the description and the services they inject (see
 * `PluginRow.tsx`); failed rows sort to the top of their group with a count,
 * because a plugin that did not load is the only thing up here that needs
 * acting on.
 *
 * The search box matches the Chinese title, the identifier, the description and
 * the injected service names — the four ways a reader arrives at a row. There is
 * no pre-flip confirmation dialog: every switch here is reversible in place, and
 * the kernel-side tier refusal is the safety net that matters (it answers with a
 * reason).
 *
 * The roster is re-asked on every open: a workspace switch re-rosters tools, so
 * a cached list could lie about what is loaded. The config file's seat (its
 * path, copyable: a browser cannot open the file, but the path is what the
 * terminal needs) stays at the page's foot.
 */
import { useEffect, useRef, useState } from 'react';
import { writeClipboard } from '../clipboard.js';
import { SearchIcon } from '../icons.js';
import { SETTINGS_COPY } from './copy.js';
import { ManageError } from './ManageError.js';
import { failedCount, pluginGroups, rowTitle, type PluginRowGroup } from './row-model.js';
import { PluginGroup } from './PluginRow.js';
import { SettingsRow } from './SettingsRow.js';
import { SettingsSection } from './Section.js';
import { useFlipFeedback, titleLookup } from './use-flip-feedback.js';
import type { ClientFrame } from '../types.js';
import type { PluginsSnapshot, RosterSnapshot } from '../state.js';
import css from './PluginsSection.module.css';

/** How long the copy control reads 已复制 before reverting. */
const COPIED_MS = 2_000;

/** Each tier group's header, in the order the groups stack. */
const GROUP_TITLES = {
  core: SETTINGS_COPY['plugins.coreGroup'],
  standard: SETTINGS_COPY['plugins.standardGroup'],
  advanced: SETTINGS_COPY['plugins.advancedGroup'],
} as const;

export interface PluginsSectionProps {
  /** The last roster snapshot; null until the first answer lands. */
  roster: RosterSnapshot | null;
  /** The manager's last flip answer; null until the first flip lands. */
  plugins: PluginsSnapshot | null;
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
   * Close the panel. The search field owns Escape while it is focused (the
   * shell's standing rule), so it is also the field's job to give the key a
   * second meaning once there is nothing left to clear — see the input below.
   */
  onClose?: (() => void) | undefined;
}

/**
 * Render the 插件管理 section.
 * @param props - see PluginsSectionProps.
 * @returns the section element tree.
 */
export function PluginsSection({ roster, plugins, disabled, manageError, send, onClose }: PluginsSectionProps): JSX.Element {
  useEffect(() => {
    send({ type: 'roster' });
  }, [send]);

  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  // Which rows are expanded. Independent per row and kept across a flip (a
  // refresh re-renders the same names, so an open row does not snap shut).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Group folds, as an OVERRIDE map: an absent entry means "the group's own
  // default", which is a property of the group rather than of this state. Storing
  // the resolved default would freeze whatever the roster looked like on the
  // first render — and on the first render there is no roster at all.
  const [fold, setFold] = useState<ReadonlyMap<string, boolean>>(new Map());
  const feedback = useFlipFeedback(manageError);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(timer.current); }, []);
  const copyPath = (): void => {
    if (roster === null) return;
    void writeClipboard(roster.configPath).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setCopied(false); }, COPIED_MS);
    });
  };

  // The flip's answer settles the in-flight switch: a success carries the new
  // roster, and a REFUSAL arrives as an `error` frame instead (the hook watches
  // that half). Watching only the snapshot left the switch disabled for the rest
  // of the panel's life after a single refusal.
  const entries = plugins?.entries ?? roster?.entries ?? [];
  const shownTitle = titleLookup(entries, rowTitle);
  useEffect(() => {
    if (plugins === null) return;
    feedback.settle(shownTitle);
  }, [plugins]);

  // Grouped and filtered by the pure model, so the rules are testable without a
  // DOM (see `row-model.ts`).
  const groups = pluginGroups(entries, query);
  const shown = groups.reduce((total, group) => total + group.rows.length, 0);
  const failed = failedCount(entries);
  // While the box is filtering, every group is unfolded: a hit inside a folded
  // group is a hit the reader cannot see, and the fold is not offered at all
  // (`foldable` below) rather than offered and ignored.
  const searching = query.trim() !== '';
  // The switches are live only when the shell says the kernel can take a flip.
  // When they are locked the reason is stated on every row's `title` and once as
  // a line on the page: a greyed control with no explanation reads as a bug.
  const lockedNote = disabled ? SETTINGS_COPY['plugins.lockNote'] : null;

  // The one status line this page can show, decided in one place. Three
  // separate `&&` chains made "is this list loaded" a question the reader had to
  // answer from four booleans; the states are in fact mutually exclusive, and
  // writing that down is both clearer and one branch instead of four.
  const loaded = roster !== null || plugins !== null;
  const notice = !loaded
    ? SETTINGS_COPY['plugins.loading']
    : entries.length === 0
      ? SETTINGS_COPY['plugins.empty']
      // An empty roster and a search with no hits are different readings: the
      // first says this deployment ships nothing, the second says the box is
      // filtering everything out.
      : shown === 0 ? SETTINGS_COPY['plugins.emptySearch'] : null;

  const toggleRow = (name: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  };
  // A group whose rows carry no switch is reference, and it arrives folded: 17
  // core rows put the first live switch 706px below the fold of a 720px window.
  // A group the reader can act on arrives open.
  const groupOpen = (group: PluginRowGroup): boolean =>
    searching || (fold.get(group.tier) ?? group.switchable);
  const toggleGroup = (tier: string): void => {
    setFold((previous) => {
      const next = new Map(previous);
      const group = groups.find((candidate) => candidate.tier === tier);
      next.set(tier, !(previous.get(tier) ?? group?.switchable ?? true));
      return next;
    });
  };
  // The row follows the host's answer, not this click: the hook only disables the
  // controls until that answer lands.
  const flip = (name: string, enabled: boolean): void => {
    feedback.begin(name, enabled);
    send({ type: 'set_plugin_enabled', name, enabled });
  };

  return (
    <SettingsSection>
      {/* The reference's page head: `<h2>` then the one-line intro. */}
      <h2 className={css.heading}>{SETTINGS_COPY['plugins.title']}</h2>
      <p className={css.intro}>{SETTINGS_COPY['plugins.intro']}</p>
      <ManageError message={feedback.error} />
      {notice !== null && <div className={css.status}>{notice}</div>}
      {loaded && entries.length > 0 && (
        <SearchBox
          query={query}
          onQuery={setQuery}
          {...(onClose !== undefined ? { onClose } : {})}
        />
      )}
      {/* A count over the whole page, for the case where the failures are spread
          across groups and the reader has scrolled past one of them. */}
      {failed > 0 && <div className={css.failureBanner}>{`${failed} ${SETTINGS_COPY['plugins.failedCount']}`}</div>}
      <div className={css.feedbackSlot} aria-live="polite">
        {feedback.switching !== null
          ? SETTINGS_COPY['plugins.switching']
          : feedback.applied ?? (disabled ? SETTINGS_COPY['plugins.lockNote'] : '')}
      </div>
      {groups.map((group) => (
        <PluginGroup
          key={group.tier}
          group={group}
          title={GROUP_TITLES[group.tier]}
          open={groupOpen(group)}
          foldable={!searching}
          expanded={expanded}
          disabled={disabled}
          lockedNote={lockedNote}
          switching={feedback.switching}
          onToggleGroup={() => { toggleGroup(group.tier); }}
          onToggle={toggleRow}
          onFlip={flip}
        />
      ))}
      {roster !== null && (
        <ConfigPathRow path={roster.configPath} copied={copied} onCopy={copyPath} />
      )}
    </SettingsSection>
  );
}

/**
 * The config file's seat at the page's foot: its path (copyable — a browser
 * cannot open the file, but the path is what the terminal needs).
 *
 * Split out because it is a different subject from the roster above: this row
 * says where the switches are PERSISTED, which stays useful even when the list
 * fails to load or is filtered down to nothing.
 */
function ConfigPathRow({ path, copied, onCopy }: {
  path: string;
  copied: boolean;
  onCopy: () => void;
}): JSX.Element {
  return (
    <SettingsRow title={SETTINGS_COPY['config.title']} description={SETTINGS_COPY['config.description']}>
      <span className={css.path} title={path}>{path}</span>
      <button type="button" className={css.copy} onClick={onCopy}>
        {copied ? SETTINGS_COPY['config.copied'] : SETTINGS_COPY['config.copy']}
      </button>
    </SettingsRow>
  );
}

/**
 * The roster's search box, split out because its Escape handling is a contract
 * of its own rather than page structure.
 */
function SearchBox({ query, onQuery, onClose }: {
  query: string;
  onQuery: (next: string) => void;
  onClose?: (() => void) | undefined;
}): JSX.Element {
  return (
    /* The icon is decorative: the input carries the same name for a screen
       reader, so the glyph is aria-hidden by the icon set itself. */
    <label className={css.search}>
      <SearchIcon className={css.searchIcon} />
      <input
        type="search"
        className={css.searchInput}
        value={query}
        placeholder={SETTINGS_COPY['plugins.search']}
        aria-label={SETTINGS_COPY['plugins.search']}
        /* Declared so the modal layer's Escape yield is auditable from the
           markup: a field that claims the key must handle it (see below). */
        data-modal-escape-owner
        onChange={(event) => { onQuery(event.currentTarget.value); }}
        onKeyDown={(event) => {
          // The modal layer yields Escape to a focused text field only when that
          // field declares `data-modal-escape-owner` (`shell/modal-layer.ts`),
          // and the declaration is a PROMISE: the field must actually act on the
          // key. A search box that claims Escape and then swallows it leaves the
          // reader with a dead key and no way out but the mouse. Clearing first
          // and closing on the second press is the same two-step the reference's
          // search boxes follow.
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.stopPropagation();
          if (query !== '') {
            onQuery('');
            return;
          }
          onClose?.();
        }}
      />
    </label>
  );
}
