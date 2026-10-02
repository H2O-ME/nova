/**
 * 开始: the doorway page the panel shows while no tab is in front.
 *
 * Ported from the reference's guide body (`dsh ui-sidebar-right`
 * `tabs/guide`, MIT): a muted compass over a centred column of entry
 * capsules, no heading — a browser start page shows its doors without a
 * caption. Picking one opens that page in the panel, so this is a doorway
 * rather than a page that stays open.
 *
 * The terminal capsule is the reference's `TerminalGuide`: the card opens the
 * tab, and a chevron beside it opens the SHELL MENU — discovery fires when the
 * menu opens (an unopened menu costs no probe), the effective choice carries
 * the checkmark, and picking a row remembers it and re-aims the terminal. The
 * reference hangs a keyboard shortcut off every capsule; this surface has no
 * global shortcut system, so the pills end at the text (recorded deviation).
 */
import { useEffect, useState } from 'react';
import { ChevronDownIcon } from '../icons.js';
import { Menu, type MenuItem } from '../shell/Menu.js';
import { CompassGlyph } from './panel-icons.js';
import { DiffTabIcon, FilesTabIcon, TasksTabIcon, TerminalTabIcon } from './panel-icons.js';
import { RIGHTBAR_COPY } from './copy.js';
import { readShellPreference, requestedShell } from './terminal-shell.js';
import type { RightbarTabId } from './tabs.js';
import type { WireShell } from '../types.js';
import css from './StartView.module.css';

/** The glyph each entry capsule carries (the strip's own icon vocabulary). */
const ENTRY_ICONS: Record<RightbarTabId, JSX.Element> = {
  changes: <DiffTabIcon />,
  files: <FilesTabIcon />,
  tasks: <TasksTabIcon />,
  terminal: <TerminalTabIcon />,
};

export interface StartViewProps {
  /** Open the picked page in the panel (the capsule's whole job). */
  onOpen: (tab: RightbarTabId) => void;
  /** The host's discovered shells (the terminal card's menu rows); null until asked. */
  shells: { items: readonly WireShell[]; current: string } | null;
  /** Ask the host what it can start — the menu's open gesture fires it. */
  onDiscoverShells: () => void;
  /** Remember the picked shell and (re)aim the terminal at it. */
  onPickShell: (path: string) => void;
}

export function StartView({ onOpen, shells, onDiscoverShells, onPickShell }: StartViewProps): JSX.Element {
  return (
    <div className={css.view} data-rightbar-start="">
      <span className={css.hero} aria-hidden="true"><CompassGlyph /></span>
      {(['changes', 'files', 'tasks'] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={css.entry}
          data-entry={id}
          onClick={() => { onOpen(id); }}
        >
          <span className={css.entryIcon} aria-hidden="true">{ENTRY_ICONS[id]}</span>
          <span className={css.entryText}>
            <span className={css.entryTitle}>{RIGHTBAR_COPY[`tab.${id}`]}</span>
            <span className={css.entryDescription}>{RIGHTBAR_COPY[`start.${id}.note`]}</span>
          </span>
        </button>
      ))}
      <TerminalEntry onOpen={onOpen} shells={shells} onDiscoverShells={onDiscoverShells} onPickShell={onPickShell} />
    </div>
  );
}

/**
 * The terminal capsule: card = open the tab, chevron = the shell menu (the
 * reference's TerminalGuide shape — two controls, one card).
 */
function TerminalEntry({
  onOpen, shells, onDiscoverShells, onPickShell,
}: {
  onOpen: (tab: RightbarTabId) => void;
  shells: { items: readonly WireShell[]; current: string } | null;
  onDiscoverShells: () => void;
  onPickShell: (path: string) => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  // Discovery rides the OPEN, not the mount: an unopened menu costs no probe.
  useEffect(() => {
    if (menuOpen) onDiscoverShells();
  }, [menuOpen, onDiscoverShells]);
  // The checkmark marks the row a fresh terminal would actually start in —
  // the remembered choice while the host still lists it, else the default.
  const effective = shells === null
    ? undefined
    : requestedShell(shells.items, shells.current, readShellPreference());
  const items: readonly MenuItem[] = shells === null
    ? [{ id: 'loading', label: RIGHTBAR_COPY['term.shellLoading'], disabled: true }]
    : shells.items.map((shell) => ({ id: shell.path, label: shell.name }));
  return (
    <div className={css.entry} data-entry="terminal">
      <button type="button" className={css.entryMain} onClick={() => { onOpen('terminal'); }}>
        <span className={css.entryIcon} aria-hidden="true">{ENTRY_ICONS.terminal}</span>
        <span className={css.entryText}>
          <span className={css.entryTitle}>{RIGHTBAR_COPY['tab.terminal']}</span>
          <span className={css.entryDescription}>{RIGHTBAR_COPY['start.terminal.note']}</span>
        </span>
      </button>
      <Menu
        open={menuOpen}
        label={RIGHTBAR_COPY['term.shell']}
        items={items}
        selectedId={effective}
        align="end"
        onSelect={(path) => {
          onPickShell(path);
          setMenuOpen(false);
        }}
        onClose={() => { setMenuOpen(false); }}
        anchor={(
          <button
            type="button"
            className={css.entryTrigger}
            aria-label={RIGHTBAR_COPY['term.shell']}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={RIGHTBAR_COPY['term.shell']}
            onClick={() => { setMenuOpen((value) => !value); }}
          >
            <ChevronDownIcon />
          </button>
        )}
      />
    </div>
  );
}
