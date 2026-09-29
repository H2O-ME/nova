/**
 * The blank-column hero chrome, ported from deepseek-harness `ui-conversation`
 * EmptyHero.tsx / HeroShell.module.css (c) 2026 DeepSeek — MIT License: the
 * mark + headline lockup (34px mark leading a 26/32 headline, gap 10) with the
 * superscript preview badge, centered above the composer card.
 *
 * Three divergences from the source, each deliberate:
 *  - the headline is an invitation, not a brand line — the brand lives in the
 *    sidebar's logo row (the harness does the same: its fish carries its own
 *    name elsewhere, and the hero speaks to the reader);
 *  - the mark is our own artwork — the harness's fish is its brand, and its
 *    SMIL path morph only makes sense for that geometry; ours is a four-point
 *    star inside an orbit (a nova), riding the same ported CSS sway;
 *  - the workspace chip is exported as its own `WorkspaceRow` rather than living
 *    inside `HeroShell`. The reference does the same (its `HeroShell` renders an
 *    empty `.body` and `heroWorkspaceRow` is a SIBLING of it, inside the
 *    composer hero's 8px stack) and the difference is load-bearing: nested in
 *    the shell the chip inherits the shell's own 24px gutter and 12px gap, which
 *    is what left it misaligned against the card.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Menu, type MenuItem } from '../shell/Menu.js';
import { ChevronDownIcon, FolderOpenIcon, PlusIcon } from '../icons.js';
import css from './HeroShell.module.css';

/** Native viewBox of the hero mark (square: the orbit needs the height). */
const MARK_BOX = 32;

/** The menu row that opens the directory browser (never a real path). */
export const ADD_WORKSPACE = '::add-workspace';

/**
 * The workspace chip's menu rows.
 *
 * A pure function rather than a render-time expression because the menu is
 * portaled and closed at rest: a static render never shows a row, so the only
 * way to pin "the menu is never empty" is to pin the list itself. That property
 * is the whole point — the rows once came from `recentWorkspaces` alone, which
 * starts empty on a first visit, so the menu rendered an empty white popover
 * with no way to pick a workspace at all.
 * @param recent - workspaces this browser has opened, newest first.
 * @param current - the workspace in force (filtered out: the chip states it).
 * @param canBrowse - whether the shell can open a directory browser.
 * @returns the rows, current-workspace-excluded, add route last.
 */
export function workspaceMenuItems(
  recent: readonly string[],
  current: string,
  canBrowse: boolean,
): MenuItem[] {
  const rows: MenuItem[] = recent
    .filter((dir) => dir !== current)
    .map((dir) => ({
      id: dir,
      label: basename(dir),
      icon: <FolderOpenIcon />,
      title: dir,
    }));
  // The add route is unconditional: the remembered list is a shortlist of what
  // this browser has seen, and a picker offering only remembered directories
  // would be an empty popover on a first visit.
  if (canBrowse) rows.push({ id: ADD_WORKSPACE, label: '打开文件夹…', icon: <PlusIcon /> });
  return rows;
}

/**
 * The hero mark: a four-point star inside a tilted orbit ring — a nova.
 * Decorative — hidden from the accessibility tree; the headline beside it
 * carries the words.
 * @returns the mark svg element.
 */
function HeroMark(): JSX.Element {
  return (
    <svg
      className={css.fish}
      width={34}
      height={34}
      viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="16"
        cy="16"
        rx="14.2"
        ry="6.4"
        transform="rotate(-32 16 16)"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.55"
      />
      <path
        d="M16 3.4c1.5 6.2 2.6 8.6 5.1 10.6 2.1 1.7 5.1 2.3 9.5 2 -4.4 1.3-7.2 2.4-9.2 4.2 -2.1 1.9-3.4 4.4-4.6 10.4 -1.2-6-2.5-8.5-4.6-10.4 -2-1.8-4.8-2.9-9.2-4.2 4.4-.3 7.4-.9 9.5-2.6 2.5-2 3.5-4.4 5.1-10z"
        fill="currentColor"
      />
    </svg>
  );
}

/** The folder glyph the chip leads with (the chip's own 16px box). */
function FolderGlyph(): JSX.Element {
  return <FolderOpenIcon className={css.folder} />;
}

export interface HeroShellProps {
  /** The hero mark; the default nova when the shell supplies none. */
  mark?: ReactNode;
  /**
   * The running version (`ready.version`, the shell's own single source). The
   * badge names the build — `v0.4.0`; a host that sent no version keeps the
   * static 预览版 badge rather than an empty slot.
   */
  version?: string | undefined;
}

/**
 * Render the hero chrome (headline only; no composer, and — unlike an earlier
 * revision — no workspace chip: the row is a sibling of this element, which is
 * what puts the chip on the composer hero's own axis).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ mark, version }: HeroShellProps): JSX.Element {
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: mark 34 leading the headline, gap 10. */}
          <span className={css.fishHitbox}>{mark ?? <HeroMark />}</span>
          <span className={css.titleGroup}>
            {/* Own element: keeps the headline text addressable apart from the badge. */}
            <span>今天想做点什么？</span>
            <span className={css.previewBadge}>{version !== undefined && version !== '' ? `v${version}` : '预览版'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export interface WorkspaceRowProps {
  /** The chip label (the current workspace's display name). */
  workspace: string;
  /**
   * The workspace in force, full path — the chip's tooltip and the row that is
   * filtered out of the menu (a menu exists to disambiguate; the current root
   * is already stated by the chip).
   */
  workspacePath?: string | undefined;
  /**
   * Workspaces this browser has opened, newest first: the picker's rows. A
   * workspace is remembered locally because the host's session list only knows
   * about sessions — a directory the user opened and then started a new session
   * in would otherwise vanish from the menu.
   */
  recentWorkspaces?: readonly string[];
  /** Switch the session's workspace (`set_workspace`). */
  onPickWorkspace?: ((dir: string) => void) | undefined;
  /**
   * Open the host-side directory browser. The reference's picker has exactly one
   * route for adding a workspace (pick a host directory), and so does this one:
   * without this callback the menu would offer nothing but the workspaces this
   * browser already knows, which on a first visit is none of them.
   */
  onBrowse?: (() => void) | undefined;
}

/**
 * The workspace chip and its menu: the hero's row, mounted as a sibling of
 * `HeroShell` inside the composer hero stack (the reference's
 * `heroWorkspaceRow`).
 * @param props - see {@link WorkspaceRowProps}.
 * @returns the workspace row element.
 */
export function WorkspaceRow({
  workspace,
  workspacePath,
  recentWorkspaces = [],
  onPickWorkspace,
  onBrowse,
}: WorkspaceRowProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = workspacePath ?? '';
  const rows = workspaceMenuItems(recentWorkspaces, current, onBrowse !== undefined);
  // A control only when there is something it can open: with neither a picker
  // nor a browser composed, the chip is a static echo of where the session is
  // rooted, and a disabled button that still advertises a popup would lie to a
  // screen reader about an affordance that does not exist.
  const interactive = onPickWorkspace !== undefined || onBrowse !== undefined;
  const chip = (
    <button
      type="button"
      className={css.workspace}
      title={current !== '' ? current : workspace}
      aria-label="切换工作区"
      {...(interactive
        ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': pickerOpen }
        : { disabled: true })}
      onClick={interactive ? () => { setPickerOpen((open) => !open); } : undefined}
    >
      <FolderGlyph />
      <span className={css.workspaceLabel}>{workspace}</span>
      <span className={css.workspaceChevron} aria-hidden="true">
        <ChevronDownIcon className={css.workspaceChevronIcon} />
      </span>
    </button>
  );
  return (
    <div className={css.workspaceRow}>
      {interactive ? (
        <Menu
          open={pickerOpen}
          label="切换工作区"
          items={rows}
          selectedId={current}
          onSelect={(id) => {
            setPickerOpen(false);
            if (id === ADD_WORKSPACE) {
              onBrowse?.();
              return;
            }
            if (id !== current) onPickWorkspace?.(id);
          }}
          onClose={() => { setPickerOpen(false); }}
          side="below"
          align="start"
          anchor={chip}
        />
      ) : chip}
    </div>
  );
}

/**
 * The last path segment, for a chip label. Handles both separators because a
 * remembered workspace may have been written on another platform (the host
 * stores what the user picked) — a display name never decides a filesystem
 * question.
 */
function basename(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}
