/**
 * The right sidebar: one panel, three tabs, drawn against the frame's right edge.
 *
 * Ported from deepseek-harness `ui-sidebar-right` (MIT) in everything this build
 * can carry: the panel is a COLUMN of the page rather than a raised card (the
 * conversation's own ground, one hairline on the edge), its tabs are chips along
 * the strip with the panel's own two controls (presentation, close) at the strip's
 * END, and hiding it is the same gesture as showing it.
 *
 * What the harness has and this does not: a docking kit (split panes, floating
 * windows, per-tab close), a resource-address registry shared by every tab type,
 * and a guide page. Those are the machinery of a dozen tab kinds; this panel has
 * three fixed ones, so it is a tab strip and a body switch — the parts a reader
 * actually touches.
 *
 * The frame owns the column's geometry and passes the resolved width in; the
 * panel reports nothing back, because the shell (App) is what calls
 * `openRightbar`/`closeRightbar`. `fullscreen` is one of the frame's
 * presentations and is drawn here (`data-rightbar`), the same vocabulary the tool
 * detail panel uses.
 */
import { useState } from 'react';
import { CloseIcon, PanelIcon } from '../icons.js';
import { ExitFullscreenIcon, FullscreenIcon } from '../tool/icons.js';
import type { ClientFrame, SessionListItem } from '../types.js';
import { ChangesPanel } from './ChangesPanel.js';
import { FilesPanel } from './FilesPanel.js';
import { TerminalPanel } from './TerminalPanel.js';
import { RIGHTBAR_COPY } from './copy.js';
import type { ChangesModel } from './changes-model.js';
import type { TreeState } from './files-model.js';
import type { TerminalState } from './terminal-model.js';
import { readTabPreference, RIGHTBAR_TABS, writeTabPreference, type RightbarTabId } from './tabs.js';
import css from './RightbarPanel.module.css';

export interface RightbarPanelProps {
  /** Resolved normal panel width in px (AppFrame's rightbar slot parameter). */
  width: number;
  /** The column has a track for the panel; false = the panel covers the centre. */
  canShow: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** The tab in force; uncontrolled (remembered locally) when omitted. */
  tab?: RightbarTabId | undefined;
  onPickTab?: ((tab: RightbarTabId) => void) | undefined;
  /** Everything the three bodies read — one prop per fact, no re-derivation. */
  changes: ChangesModel;
  tree: TreeState;
  terminal: TerminalState;
  sessions: readonly SessionListItem[] | null;
  currentFile: string;
  rootDir: string;
  connected: boolean;
  send: (frame: ClientFrame) => void;
}

export function RightbarPanel(props: RightbarPanelProps): JSX.Element {
  const [ownTab, setOwnTab] = useState<RightbarTabId>(() => readTabPreference());
  const [selected, setSelected] = useState<string | null>(null);
  const tab = props.tab ?? ownTab;
  const pick = (next: RightbarTabId): void => {
    if (props.onPickTab !== undefined) props.onPickTab(next);
    else setOwnTab(next);
    writeTabPreference(next);
  };
  const presentation = props.fullscreen ? 'fullscreen' : props.canShow ? 'push' : 'takeover';
  const modeLabel = props.fullscreen ? RIGHTBAR_COPY['panel.exitFullscreen'] : RIGHTBAR_COPY['panel.fullscreen'];
  return (
    <aside
      className={css.panel}
      data-rightbar={presentation}
      style={presentation === 'push' ? { width: props.width } : undefined}
      aria-label={RIGHTBAR_COPY['panel.label']}
    >
      <div className={css.strip}>
        <div className={css.tabs} role="tablist" aria-label={RIGHTBAR_COPY['panel.label']}>
          {RIGHTBAR_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className={css.tab}
              aria-selected={entry.id === tab}
              data-tab={entry.id}
              onClick={() => { pick(entry.id); }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {/* The strip's END: the harness's own seat for the panel's controls, so
            the tab row IS the panel's top edge and no title row is drawn. */}
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
      <div className={css.body}>
        {tab === 'changes' && (
          <ChangesPanel model={props.changes} selected={selected} onSelect={setSelected} />
        )}
        {tab === 'files' && (
          <FilesPanel
            rootDir={props.rootDir}
            tree={props.tree}
            sessions={props.sessions}
            currentFile={props.currentFile}
            send={props.send}
          />
        )}
        {tab === 'terminal' && (
          <TerminalPanel
            state={props.terminal}
            rootDir={props.rootDir}
            sessionFile={props.currentFile}
            connected={props.connected}
            send={props.send}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * The way back in when the panel is closed.
 *
 * The harness puts its expand button in the conversation header's corner seat
 * and mirrors the sidebar's own collapse glyph (`transform: scaleX(-1)`), so
 * open and close read as one control seen from two sides. This is that button,
 * exported for whichever seat the shell gives it.
 */
export function RightbarOpenButton({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={css.openButton}
      aria-label={RIGHTBAR_COPY['panel.open']}
      title={RIGHTBAR_COPY['panel.open']}
      onClick={onOpen}
    >
      <PanelIcon className={css.openGlyph} />
    </button>
  );
}
