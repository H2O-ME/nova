/**
 * 开始: the doorway page the panel shows while no tab is in front.
 *
 * Ported from the reference's guide body (`dsh ui-sidebar-right`
 * `tabs/guide`, MIT): a muted compass over a centred column of entry
 * capsules, no heading — a browser start page shows its doors without a
 * caption. Picking one opens that page in the panel, so this is a doorway
 * rather than a page that stays open.
 *
 * The reference hangs a keyboard shortcut off every capsule; this surface has
 * no global shortcut system, so the pills end at the text and the affordance
 * stays honest (recorded deviation).
 */
import { CompassGlyph } from './panel-icons.js';
import { DiffTabIcon, FilesTabIcon, TasksTabIcon, TerminalTabIcon } from './panel-icons.js';
import { RIGHTBAR_COPY } from './copy.js';
import type { RightbarTabId } from './tabs.js';
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
}

export function StartView({ onOpen }: StartViewProps): JSX.Element {
  return (
    <div className={css.view} data-rightbar-start="">
      <span className={css.hero} aria-hidden="true"><CompassGlyph /></span>
      {(['changes', 'files', 'tasks', 'terminal'] as const).map((id) => (
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
    </div>
  );
}
