/**
 * The tab strip: the panel's top edge, and the only way to open or empty a page.
 *
 * Split from `RightbarPanel` because the two answer different questions — this
 * file is how the strip is drawn and clicked, that one is how the panel mounts
 * its pages. Rebuilt against the reference plugin's shell (dsh-better-sidebar,
 * MIT): one tab per OPEN page (icon + title + close), capped and ellipsized,
 * and the panel's own controls at the strip's end — so the strip carries the
 * column's chrome instead of a title row above it.
 *
 * **The start page is a tab, not the absence of one** (the reference's
 * `GUIDE_KIND`): the `+` control opens it (`addTab → openTab(GUIDE_KIND)`), a
 * pane holds at most one (the control disappears while it is open —
 * `canAddTab`), and it cannot be closed while it is the only tab there
 * (`canCloseTab`). Picking an entry from it replaces it, which is the next
 * file's answer.
 */
import { CloseIcon, PlusIcon } from '../icons.js';
import { ExitFullscreenIcon, FullscreenIcon } from '../tool/icons.js';
import { CompassGlyph, DiffTabIcon, FilesTabIcon, TasksTabIcon, TerminalTabIcon } from './panel-icons.js';
import { RIGHTBAR_COPY } from './copy.js';
import { GUIDE_TAB, type RightbarTabId, type StripTabId } from './tabs.js';
import css from './RightbarStrip.module.css';

/** The glyph each tab carries (the guide's is the start page's compass). */
const TAB_ICONS: Record<StripTabId, JSX.Element> = {
  [GUIDE_TAB]: <CompassGlyph />,
  changes: <DiffTabIcon />,
  files: <FilesTabIcon />,
  tasks: <TasksTabIcon />,
  terminal: <TerminalTabIcon />,
};

/** The strip label of one tab. */
function tabLabel(id: StripTabId): string {
  return id === GUIDE_TAB ? RIGHTBAR_COPY['tab.guide'] : RIGHTBAR_COPY[`tab.${id as RightbarTabId}`];
}

export interface RightbarStripProps {
  /** The tabs the reader has OPEN, in strip order (the guide is one of them). */
  tabs: readonly StripTabId[];
  /** The tab in front. */
  tab: StripTabId;
  onPickTab: (tab: StripTabId) => void;
  /** Close one tab (an emptied strip is the reference's contradiction, so App seeds the guide back). */
  onCloseTab: (tab: StripTabId) => void;
  /** Open the start page as a new tab — the `+` control's whole job. */
  onAddGuide: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function RightbarStrip(props: RightbarStripProps): JSX.Element {
  const modeLabel = props.fullscreen ? RIGHTBAR_COPY['panel.exitFullscreen'] : RIGHTBAR_COPY['panel.fullscreen'];
  const guideOpen = props.tabs.includes(GUIDE_TAB);
  return (
    <div className={css.strip}>
      <div className={css.tabs} role="tablist" aria-label={RIGHTBAR_COPY['panel.label']}>
        {props.tabs.map((id) => {
          const label = tabLabel(id);
          // The guide alone in the strip is not a closable tab: the reference
          // hides its close route (`canCloseTab`), because a strip with no tabs
          // has nothing to draw.
          const closable = id !== GUIDE_TAB || props.tabs.length > 1;
          return (
            <div
              key={id}
              className={css.tab}
              role="tab"
              aria-selected={id === props.tab}
              data-tab={id}
              title={label}
              onClick={() => { props.onPickTab(id); }}
            >
              <span className={css.tabIcon} aria-hidden="true">{TAB_ICONS[id]}</span>
              <span className={css.tabLabel}>{label}</span>
              {closable && (
                <button
                  type="button"
                  className={css.tabClose}
                  aria-label={`${RIGHTBAR_COPY['panel.closeTab']}：${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCloseTab(id);
                  }}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!guideOpen && (
        <button
          type="button"
          className={css.plus}
          aria-label={RIGHTBAR_COPY['panel.newTab']}
          title={RIGHTBAR_COPY['panel.newTab']}
          data-add-guide=""
          onClick={props.onAddGuide}
        >
          <PlusIcon />
        </button>
      )}
      {/* The strip's END: the panel's own controls, so the tab strip IS the
          panel's top edge and no title row is drawn above it. */}
      <div className={css.stripEnd}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={modeLabel}
          title={modeLabel}
          onClick={props.onToggleFullscreen}
        >
          {props.fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={RIGHTBAR_COPY['panel.close']}
          title={RIGHTBAR_COPY['panel.close']}
          onClick={props.onClose}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
