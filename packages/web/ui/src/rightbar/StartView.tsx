/**
 * 开始/新标签页: the doorway page the panel shows while no tab is in front.
 *
 * The reference's open-tab launcher page (`AnimatedSidePanePanel.tsx:829-901`):
 * a left-aligned page head over a list of horizontal rows, each row a 48px
 * icon block, a semibold title over a quiet one-line description, and a
 * trailing 「打开」 pill. Picking a row opens that page in the panel, so this is
 * a doorway rather than a page that stays open.
 *
 * The terminal row is the reference's `TerminalGuide`: the row opens the tab,
 * and a chevron beside it opens the SHELL MENU — discovery fires when the menu
 * opens (an unopened menu costs no probe), the effective choice carries the
 * checkmark, and picking a row remembers it and re-aims the terminal. The
 * reference hangs a keyboard shortcut off every capsule; this surface has no
 * global shortcut system, so the rows end at the pill (recorded deviation).
 */
import { useEffect, useState } from 'react';
import { ChevronDownIcon } from '../icons.js';
import { Menu, type MenuItem } from '../shell/Menu.js';
import { DiffTabIcon, FilesTabIcon, TasksTabIcon, TerminalTabIcon } from './panel-icons.js';
import { RIGHTBAR_COPY } from './copy.js';
import { readShellPreference, requestedShell } from './terminal-shell.js';
import type { RightbarTabId } from './tabs.js';
import type { WireShell } from '../types.js';
import css from './StartView.module.css';

/** The glyph each row carries inside its 48px block (the strip's vocabulary). */
const ENTRY_ICONS: Record<RightbarTabId, JSX.Element> = {
  changes: <DiffTabIcon />,
  files: <FilesTabIcon />,
  tasks: <TasksTabIcon />,
  terminal: <TerminalTabIcon />,
};

export interface StartViewProps {
  /** Open the picked page in the panel (the row's whole job). */
  onOpen: (tab: RightbarTabId) => void;
  /** The host's discovered shells (the terminal row's menu rows); null until asked. */
  shells: { items: readonly WireShell[]; current: string } | null;
  /** Ask the host what it can start — the menu's open gesture fires it. */
  onDiscoverShells: () => void;
  /** Remember the picked shell and (re)aim the terminal at it. */
  onPickShell: (path: string) => void;
}

export function StartView({ onOpen, shells, onDiscoverShells, onPickShell }: StartViewProps): JSX.Element {
  return (
    <div className={css.view} data-rightbar-start="">
      <div className={css.column}>
        <h2 className={css.title}>{RIGHTBAR_COPY['start.title']}</h2>
        <div className={css.list}>
          {(['changes', 'files', 'tasks'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={css.row}
              data-entry={id}
              onClick={() => { onOpen(id); }}
            >
              <span className={css.rowIcon} aria-hidden="true">{ENTRY_ICONS[id]}</span>
              <span className={css.rowText}>
                <span className={css.rowTitle}>{RIGHTBAR_COPY[`tab.${id}`]}</span>
                <span className={css.rowDescription}>{RIGHTBAR_COPY[`start.${id}.note`]}</span>
              </span>
              <span className={css.rowOpen} aria-hidden="true">{RIGHTBAR_COPY['start.open']}</span>
            </button>
          ))}
          <TerminalEntry onOpen={onOpen} shells={shells} onDiscoverShells={onDiscoverShells} onPickShell={onPickShell} />
        </div>
      </div>
    </div>
  );
}

/**
 * The terminal row: row = open the tab, chevron = the shell menu (the
 * reference's TerminalGuide shape — two controls, one row).
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
    <div className={css.row} data-entry="terminal">
      <button type="button" className={css.rowMain} onClick={() => { onOpen('terminal'); }}>
        <span className={css.rowIcon} aria-hidden="true">{ENTRY_ICONS.terminal}</span>
        <span className={css.rowText}>
          <span className={css.rowTitle}>{RIGHTBAR_COPY['tab.terminal']}</span>
          <span className={css.rowDescription}>{RIGHTBAR_COPY['start.terminal.note']}</span>
        </span>
        <span className={css.rowOpen} aria-hidden="true">{RIGHTBAR_COPY['start.open']}</span>
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
            className={css.rowTrigger}
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
