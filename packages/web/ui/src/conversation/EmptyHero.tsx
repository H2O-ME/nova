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
import { Menu, type MenuItem } from '../shell/Menu.js';
import { ChevronDownIcon, FolderOpenIcon, PlusIcon } from '../icons.js';
import css from './HeroShell.module.css';

/** The menu row that opens the directory browser (never a real path). */
export const ADD_WORKSPACE = '::add-workspace';

/** Hour marks (local time) the greeting's tiers turn over at. */
const GREETING_HOURS = [5, 9, 12, 14, 18, 23];

/**
 * The headline's time-greeted sentence, in six bands over a day. The bands and
 * boundaries are the operator's reference's own (`getChatEmptyGreetingMessageId`,
 * `[5, 9, 12, 14, 18, 23]`), and so are the words — the greeting is the one
 * sentence a reader compares side by side, so it reads the same. The boundaries
 * are hour marks so a plain `setTimeout` can park the tier until the next one —
 * a hero left open all day never goes stale.
 * @param now - the moment to greet at.
 * @returns the headline sentence.
 */
export function heroGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5 || hour >= 23) return '夜深啦，别忘了照顾好自己哦';
  if (hour < 9) return '早上好呀，新的一天开始啦';
  if (hour < 12) return '上午好呀，有什么想让我帮忙的吗';
  if (hour < 14) return '中午好呀，要不要先休息一下';
  if (hour < 18) return '下午好呀，接下来交给我吧';
  return '晚上好呀，今天辛苦啦';
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
 * The hero mark: a four-point star inside a tilted orbit ring — a nova, the
 * same artwork the 34px headline mark carried, promoted to the empty state's
 * background line art (the reference's own move: its brand glyph is a large
 * faint outline centred behind the greeting, not a badge in the line).
 *
 * Decorative — hidden from the accessibility tree and from hit-testing; the
 * headline above it carries the words.
 * @returns the backdrop svg element.
 */
export function HeroBackdrop(): JSX.Element {
  return (
    <svg
      className={css.backdrop}
      width={400}
      height={320}
      viewBox="0 0 400 320"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" fill="none" strokeWidth="1.4">
        {/* The orbit ring and the star, both re-centred on (200, 160) and
            scaled from the 32px mark's own geometry (32-box × 9 ≈ 288px star
            span inside the 400px box). */}
        <g transform="translate(200 160) scale(9)">
          <ellipse rx="14.2" ry="6.4" transform="rotate(-32)" strokeWidth="0.17" />
          <path
            transform="translate(-16 -16)"
            d="M16 3.4c1.5 6.2 2.6 8.6 5.1 10.6 2.1 1.7 5.1 2.3 9.5 2 -4.4 1.3-7.2 2.4-9.2 4.2 -2.1 1.9-3.4 4.4-4.6 10.4 -1.2-6-2.5-8.5-4.6-10.4 -2-1.8-4.8-2.9-9.2-4.2 4.4-.3 7.4-.9 9.5-2.6 2.5-2 3.5-4.4 5.1-10z"
            strokeWidth="0.17"
          />
        </g>
      </g>
    </svg>
  );
}

/** The folder glyph the chip leads with (the chip's own 16px box). */
function FolderGlyph(): JSX.Element {
  return <FolderOpenIcon className={css.folder} />;
}

/** The headline's fit band: the reference's own clamp (30px baseline, 20px floor). */
const TITLE_SIZE_MAX = 30;
const TITLE_SIZE_MIN = 20;

/**
 * Render the hero chrome (the greeting line only; the brand mark is
 * `HeroBackdrop`, mounted by `ConversationRoot` on the full-height hero
 * region — this element is a 34px band and cannot host scenery, the lesson
 * two aurora attempts recorded).
 *
 * The headline is the clock-greeted sentence, fitted to ONE line: squeezed, the
 * type shrinks between 30 and 20px (a hidden probe measured against the
 * headline's live width, the size written straight to a CSS variable) before
 * it wraps — the wrap below the minimum stays the overflow-driven degradation
 * it already was.
 *
 * The running version is NOT here. It rode the headline as a superscript badge,
 * and the version is not what an empty column is asking the reader to think
 * about; the settings nav's foot states it instead (`SettingsPanel`).
 * @returns the centered hero element tree.
 */
export function HeroShell(): JSX.Element {
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
  // loop the observation. No mark rides the line any more — the fit budget is
  // the column's own width.
  const headlineRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const headline = headlineRef.current;
    const probe = probeRef.current;
    if (headline === null || probe === null) return;
    const recompute = (): void => {
      const natural = probe.getBoundingClientRect().width;
      if (natural <= 0 || !Number.isFinite(natural)) return;
      const available = headline.clientWidth;
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
       * The backdrop mark is therefore rendered by `ConversationRoot`, which
       * owns the full-height hero column, as a `HeroBackdrop` inside that seat.
       * Keeping a copy in this 34px box would be a duplicate that can never be
       * seen.
       */}
      {/* The fit probe: the sentence at its baseline size, unpainted and
          unhit-testable. It carries the SAME text as the headline — that is
          the whole measurement. */}
      <span className={css.probe} aria-hidden="true" ref={probeRef}>
        {greeting}
      </span>
      <div className={css.stack}>
        <div className={css.headline} ref={headlineRef}>
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
