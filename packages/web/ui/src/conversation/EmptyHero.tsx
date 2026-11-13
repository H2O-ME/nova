/**
 * The blank-column hero chrome: the
 * mark + headline lockup (34px mark leading a 26/32 headline, gap 10), centered
 * above the composer card.
 *
 * Three divergences from the source, each deliberate:
 *  - the headline is an invitation, not a brand line — the brand lives in the
 *    sidebar's logo row (the harness does the same: its fish carries its own
 *    name elsewhere, and the hero speaks to the reader);
 *  - the mark is our own artwork — the harness's fish is its brand, and its
 *    SMIL path morph only makes sense for that geometry; ours is a four-point
 *    star inside an orbit (a nova), riding the same CSS sway;
 *  - the workspace chip is exported as its own `WorkspaceRow` rather than living
 *    inside `HeroShell`. The reference does the same (its `HeroShell` renders an
 *    empty `.body` and `heroWorkspaceRow` is a SIBLING of it, inside the
 *    composer hero's 8px stack) and the difference is load-bearing: nested in
 *    the shell the chip inherits the shell's own 24px gutter and 12px gap, which
 *    is what left it misaligned against the card.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Menu, type MenuItem } from '../shell/Menu.js';
import { ChevronDownIcon, FolderOpenIcon, PlusIcon } from '../icons.js';
import css from './HeroShell.module.css';

/** Native viewBox of the hero mark (square: the orbit needs the height). */
const MARK_BOX = 32;

/** The menu row that opens the directory browser (never a real path). */
export const ADD_WORKSPACE = '::add-workspace';

/** Hour marks (local time) the greeting's tiers turn over at. */
const GREETING_HOURS = [5, 9, 12, 14, 18, 23];

/**
 * The headline's time-greeted sentence, in six bands over a day. The empty
 * column's one line changes with the clock the way the reference's does, and
 * the boundaries are hour marks so a plain `setTimeout` can park the tier
 * until the next one — a hero left open all day never goes stale.
 * @param now - the moment to greet at.
 * @returns the headline sentence.
 */
export function heroGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5 || hour >= 23) return '夜深了，想做点什么？';
  if (hour < 9) return '早上好，想做点什么？';
  if (hour < 12) return '上午好，想做点什么？';
  if (hour < 14) return '中午好，想做点什么？';
  if (hour < 18) return '下午好，想做点什么？';
  return '晚上好，想做点什么？';
}

/**
 * Milliseconds until the greeting's next tier boundary. Pure, so the timer in
 * {@link HeroShell} can be a plain `setTimeout` rescheduled after each
 * turn-over instead of a polling interval.
 * @param now - the moment to measure from.
 * @returns the delay to the next boundary, never shorter than a second.
 */
export function msToNextGreetingBoundary(now: Date): number {
  const hour = now.getHours();
  // Past the last mark the next turn-over is tomorrow's first one; `setHours`
  // overflows past midnight on its own (29 -> tomorrow 05:00).
  const target = hour >= 23 ? 29 : (GREETING_HOURS.find((mark) => mark > hour) ?? 29);
  const at = new Date(now);
  at.setHours(target, 0, 0, 0);
  return Math.max(at.getTime() - now.getTime(), 1000);
}

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
}

/** The headline's fit band: the reference's clamp, on our own 28px baseline. */
const TITLE_SIZE_MAX = 28;
const TITLE_SIZE_MIN = 20;

/**
 * Render the hero chrome (headline only; no composer, and — unlike an earlier
 * revision — no workspace chip: the row is a sibling of this element, which is
 * what puts the chip on the composer hero's own axis).
 *
 * The headline is the clock-greeted sentence, fitted to ONE line: squeezed, the
 * type shrinks between 28 and 20px (a hidden probe measured against the
 * headline's live width, the size written straight to a CSS variable) before
 * the mark falls to its own line — the wrap below the minimum stays the
 * overflow-driven degradation it already was.
 *
 * The running version is NOT here. It rode the headline as a superscript badge,
 * and the version is not what an empty column is asking the reader to think
 * about; the settings nav's foot states it instead (`SettingsPanel`).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ mark }: HeroShellProps): JSX.Element {
  const [greeting, setGreeting] = useState(() => heroGreeting(new Date()));
  // The tier re-resolves at the next boundary, not on a poll: one timer per
  // mount, rescheduled after each turn-over.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      timer = setTimeout(() => {
        setGreeting(heroGreeting(new Date()));
        schedule();
      }, msToNextGreetingBoundary(new Date()));
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // Headline fit. The visible headline and the probe are BOTH observed: the
  // headline because its width moves with the column, the probe because its
  // width moves with the sentence (a new greeting, a swapped webfont). The
  // probe's own size is fixed, so writing the headline's size variable cannot
  // loop the observation.
  const headlineRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLSpanElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const headline = headlineRef.current;
    const probe = probeRef.current;
    if (headline === null || probe === null) return;
    const recompute = (): void => {
      const natural = probe.getBoundingClientRect().width;
      if (natural <= 0 || !Number.isFinite(natural)) return;
      // The budget always assumes the mark rides the same line. Sizing against
      // a mark-free line would let the type grow until the mark wraps and
      // shrink again once it has wrapped — an oscillation the conservative
      // budget cannot fall into. Below the minimum the existing wrap degrades.
      const markBox = markRef.current?.getBoundingClientRect().width ?? 0;
      const gap = Number.parseFloat(getComputedStyle(headline).columnGap) || 0;
      const available = headline.clientWidth - markBox - gap;
      const size = Math.max(
        TITLE_SIZE_MIN,
        Math.min(TITLE_SIZE_MAX, Math.floor((TITLE_SIZE_MAX * available) / natural)),
      );
      headline.style.setProperty('--nova-hero-title-size', `${size}px`);
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(headline);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={css.root}>
      {/*
       * THE AURORA IS *NOT* MOUNTED HERE, and that is the lesson of two failed
       * attempts — both measured, both recorded:
       *
       *   `.root`  = 624x34   (wraps the headline row only)
       *   `.stack` = 656x34   (same row; the composer card is a SIBLING)
       *
       * `AuroraBackground` is `absolute inset-0`, so mounted on either box it
       * paints into a 34px band and reads as nothing — measured at exactly
       * 656x34 on the first attempt at this change. Scenery only becomes visible
       * when its containing block is the whole hero region, and `HeroShell`
       * cannot provide that by construction: the workspace chip and the composer
       * card live outside it.
       *
       * The wash + grid are therefore rendered by `ConversationRoot`, which owns
       * the full-height hero column (`composerSeat`), as an `AuroraBackground`
       * inside that seat. Keeping a second copy in this 34px box would be a
       * duplicate that can never be seen.
       */}
      {/* The fit probe: the sentence at its baseline size, unpainted and
          unhit-testable. It carries the SAME text as the headline — that is
          the whole measurement. */}
      <span className={css.probe} aria-hidden="true" ref={probeRef}>
        {greeting}
      </span>
      <div className={css.stack}>
        <div className={css.headline} ref={headlineRef}>
          {/* figma 34:10412: mark 34 leading the headline, gap 10. */}
          <span className={css.fishHitbox} ref={markRef}>
            {mark ?? <HeroMark />}
          </span>
          <span className={css.titleGroup}>
            <span>{greeting}</span>
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
