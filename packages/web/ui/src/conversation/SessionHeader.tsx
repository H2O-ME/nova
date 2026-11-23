/**
 * The strict session header above the scrollport: 76px of column
 * chrome (10px top inset, a 30px title row, then the tab strip with its 10px
 * margin, 16px line and 9px bottom inset), a hairline at its foot, and the four
 * trailing seats the source declares — actions, utilities, corner, and the tab
 * row itself.
 *
 * Product mapping: this replaces the hand-rolled strip the surface used to
 * carry, so the pieces are ours — the crumbs read the session title (the
 * source's current/last segment, with the workspace path as its tooltip), and
 * the seats render what the product has: `utilities` hosts the source's
 * "open in app" action, which this product has no counterpart for, while
 * `corner` hosts the right panel's expand control — ONE control of ours, as in
 * the source: a second glyph beside it is indistinguishable from the first, and
 * the detail board is opened by its own tool row. In the desktop shell the
 * corner ALSO carries the window's caption buttons after that control (the
 * reference's trailing cluster is `[panel toggle] [— □ ✕]` while the side pane
 * is closed; see `SessionRoute`), which is why the corner seat is a flex row
 * rather than a single slot. **The model is NOT here** — the
 * source keeps it in the composer's model seat, and so do we: a model printed
 * twice has two places to disagree about what is in force. The tab row renders
 * only when more than one view exists (the source's own gate), which today
 * means never: the rule stays in place for the 76px contract, not for a control
 * nobody can use.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Menu } from '../shell/Menu.js';
import { FolderOpenIcon, MoreIcon } from '../icons.js';
import { cx } from '../composer/cx.js';
import css from './SessionHeader.module.css';

/** One view the transcript can show (the source's view ledger). */
export interface SessionTab {
  id: string;
  label: string;
}

export interface SessionHeaderProps {
  /** Blank/hero phases keep the header mounted but out of the column. */
  hidden?: boolean;
  /** The session's display title; falls back to the new-session word when the
   *  session has no first prompt yet. */
  title: string;
  /** The workspace root — the title crumb's tooltip (never a visual segment:
   *  the workspace lives in the hero chip in the source, and there is no
   *  workspace selector here). */
  rootDir: string;
  /** Extra trailing controls, after the crumbs. */
  utilities?: ReactNode;
  /** The far-right corner seat's occupant (the detail panel's expand control). */
  corner?: ReactNode;
  /** The view tabs; one or none renders no strip (the source's rule). */
  tabs?: readonly SessionTab[];
  activeTabId?: string;
  onSelectTab?: (id: string) => void;
}

export function SessionHeader({
  hidden = false,
  title,
  rootDir,
  utilities,
  corner,
  tabs,
  activeTabId,
  onSelectTab,
}: SessionHeaderProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header
      className={cx(css.header, hidden && css.headerBlank)}
      // The whole row is the window's drag handle. `deep` (not the bare
      // attribute) is required: Tauri's drag script only starts a drag when the
      // mousedown target IS the attributed element, and this row's children —
      // title spans, the breadcrumb — would swallow every press otherwise.
      // Buttons and links are exempted by that script, so they keep their own
      // clicks.
      data-tauri-drag-region="deep"
    >
      <div className={css.titleRow}>
        {/* The blank phase blanks the CHROME, not the row: the title cluster
            and utilities go (there is no session to name yet), but the corner
            seat stays — it hosts the right panel's way in, and a reader who
            cannot open the sidebar until they have sent a first message has no
            way to browse the workspace they are about to talk about. The
            reference draws the same line: `hideChrome` wraps the cluster and
            utilities, and the corner is rendered outside it. */}
        {!hidden && (
          <>
            <div className={css.titleCluster}>
              {/* The reference's header: a folder glyph, the session title, then
                  a `⋯` menu. The tab strip Nova carried is gone (2026-11-15) —
                  the reference has none, and its 28px of chrome was the most
                  visible "our page starts lower" difference. The views the strip
                  used to switch live in the menu instead. */}
              <span className={css.folder} aria-hidden="true">
                <FolderOpenIcon />
              </span>
              <nav className={css.crumbs} aria-label="会话层级">
                <span className={css.crumbSeg}>
                  <span className={`${css.crumb} ${css.crumbCurrent}`} title={rootDir}>
                    {title.length > 0 ? title : '新会话'}
                  </span>
                </span>
              </nav>
              {tabs !== undefined && tabs.length > 1 && (
                <Menu
                  open={menuOpen}
                  label="会话视图"
                  items={tabs.map((viewTab) => ({ id: viewTab.id, label: viewTab.label }))}
                  selectedId={activeTabId ?? tabs[0]?.id}
                  onSelect={(id) => { setMenuOpen(false); onSelectTab?.(id); }}
                  onClose={() => { setMenuOpen(false); }}
                  side="below"
                  align="start"
                  anchor={(
                    <button
                      type="button"
                      className={css.more}
                      aria-label="更多"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => { setMenuOpen((open) => !open); }}
                    >
                      <MoreIcon />
                    </button>
                  )}
                />
              )}
              {/* The source's per-session action seat, left empty on purpose. */}
              <div className={css.headerActions} />
            </div>
            <div className={css.headerUtilities}>
              {utilities}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">{corner}</div>
      </div>
    </header>
  );
}
