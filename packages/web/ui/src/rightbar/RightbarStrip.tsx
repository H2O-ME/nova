/**
 * The tab strip: the panel's top edge.
 *
 * Two kinds of tab, and only two: the fixed 文件 page and the documents opened
 * from its tree. The strip carries the column's chrome — fullscreen and close
 * sit at its end — so no title row is drawn above it.
 *
 * The strip's END is also where the window's caption buttons stand while this
 * panel is open (the reference's side-pane header carries them in its own
 * trailing cluster, `AnimatedSidePanePanel.tsx:811-828`), so the row reads
 * `[文件] … [⤢] [✕] [— □ ✕]` — one band, one lane.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { CloseIcon, FileIcon } from '../icons.js';
import { IconButton } from '../kit/IconButton.js';
import { WindowControls } from '../shell/WindowControls.js';
import { ExitFullscreenIcon, FullscreenIcon } from '../tool/icons.js';
import { FilesTabIcon } from './panel-icons.js';
import { RIGHTBAR_COPY } from './copy.js';
import { isFileTabId, filePathOf, type StripTabId } from './tabs.js';
import css from './RightbarStrip.module.css';

/** Last path segment (a file tab's label — tabs are named by file). */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at === -1 ? path : path.slice(at + 1);
}

/** The strip label of one tab. */
function tabLabel(id: StripTabId): string {
  return isFileTabId(id) ? baseName(filePathOf(id)) : RIGHTBAR_COPY['tab.files'];
}

export interface RightbarStripProps {
  /** The tabs the reader has OPEN, in strip order (文件 is always first). */
  tabs: readonly StripTabId[];
  /** The tab in front. */
  tab: StripTabId;
  onPickTab: (tab: StripTabId) => void;
  /** Close one file tab. The 文件 page cannot be closed. */
  onCloseTab: (tab: StripTabId) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

/** Which sides of the chip run are clipped (the mask fades those sides). */
type ScrollSides = '' | 'start' | 'end' | 'start end';

function scrollSides(el: HTMLElement): ScrollSides {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return '';
  const start = el.scrollLeft > 0;
  const end = el.scrollLeft < max - 0.5;
  return start && end ? 'start end' : start ? 'start' : 'end';
}

export function RightbarStrip(props: RightbarStripProps): JSX.Element {
  const modeLabel = props.fullscreen ? RIGHTBAR_COPY['panel.exitFullscreen'] : RIGHTBAR_COPY['panel.fullscreen'];
  // The overflow mask rides the real scroll position: a chip run that fits
  // shows no fade at all.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [sides, setSides] = useState<ScrollSides>('');
  useEffect(() => {
    const el = tabsRef.current;
    if (el === null) return;
    const update = (): void => { setSides(scrollSides(el)); };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => { el.removeEventListener('scroll', update); };
  }, [props.tabs.length]);
  return (
    <div className={css.strip}>
      <div className={css.tabs} role="tablist" aria-label={RIGHTBAR_COPY['panel.label']} data-strip-scroll={sides || undefined} ref={tabsRef}>
        {props.tabs.map((id, index) => {
          const label = tabLabel(id);
          const closable = isFileTabId(id);
          return (
            <Fragment key={id}>
              {index > 0 && (
                <span
                  className={`${css.slot} ${props.tabs[index - 1] === props.tab ? css.slotAfterActive : ''} ${id === props.tab ? css.slotBeforeActive : ''}`}
                  aria-hidden="true"
                />
              )}
              <div
                className={css.tab}
                role="tab"
                aria-selected={id === props.tab}
                data-tab={id}
                title={label}
                onClick={() => { props.onPickTab(id); }}
              >
                <span className={css.tabTitle}>
                  <span className={css.tabIcon} aria-hidden="true">{isFileTabId(id) ? <FileIcon /> : <FilesTabIcon />}</span>
                  <span className={css.tabLabel}>{label}</span>
                </span>
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
            </Fragment>
          );
        })}
      </div>
      {/* The strip's END: the panel's own controls, then the window's caption
          buttons when the desktop shell has them — the panel owns the window's
          top-right corner while it is open, so the cluster belongs to this
          row, not to an overlay above it. */}
      <div className={css.stripEnd}>
        <IconButton label={modeLabel} onClick={props.onToggleFullscreen}>
          {props.fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </IconButton>
        <IconButton label={RIGHTBAR_COPY['panel.close']} onClick={props.onClose}>
          <CloseIcon />
        </IconButton>
        <WindowControls />
      </div>
    </div>
  );
}
