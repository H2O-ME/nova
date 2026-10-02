/**
 * The strict session header above the scrollport, ported from deepseek-harness
 * `ui-conversation` ConversationSession.tsx's header host + the header block of
 * ConversationRoot.module.css (c) 2026 DeepSeek — MIT License: 76px of column
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
 * `corner` hosts the right panel's expand control — ONE control, as in the
 * source: a second glyph beside it is indistinguishable from the first, and the
 * detail board is opened by its own tool row. **The model is NOT here** — the
 * source keeps it in the composer's model seat, and so do we: a model printed
 * twice has two places to disagree about what is in force. The tab row renders
 * only when more than one view exists (the source's own gate), which today
 * means never: the rule stays in place for the 76px contract, not for a control
 * nobody can use.
 */
import type { ReactNode } from 'react';
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
  return (
    <header
      className={hidden ? `${css.header} ${css.headerBlank}` : css.header}
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
              <nav className={css.crumbs} aria-label="会话层级">
                <span className={css.crumbSeg}>
                  <span className={`${css.crumb} ${css.crumbCurrent}`} title={rootDir}>
                    {title.length > 0 ? title : '新会话'}
                  </span>
                </span>
              </nav>
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
      {!hidden && tabs !== undefined && tabs.length > 1 && (
        <div className={css.tabs} role="tablist">
          {tabs.map((viewTab) => (
            <button
              key={viewTab.id}
              type="button"
              role="tab"
              aria-selected={viewTab.id === activeTabId}
              className={viewTab.id === activeTabId ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => onSelectTab?.(viewTab.id)}
            >
              {viewTab.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
