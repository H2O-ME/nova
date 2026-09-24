/**
 * The way back into the detail panel: the harness's right-sidebar expand
 * control (`ui-sidebar-right/src/client/shell/ExpandButton.tsx`, MIT) in this
 * surface's vocabulary.
 *
 * The source's contract, kept whole: it lives in the conversation header's
 * CORNER seat (past the utilities, so it never joins their row), it renders
 * only while the panel is collapsed, and it is a 28px circle around a 15px
 * mirrored panel glyph. `onOpen` is the product's answer to that seat's
 * question: the harness keeps one persistent right sidebar, so its button
 * reveals the surface already there; ours is a per-call detail panel, so the
 * button re-opens the newest tool call's detail — the panel it would have shown.
 *
 * That is why the caller renders it only when there IS such a call: a control
 * that opened an empty panel would promise a surface nothing backs.
 */
import { PanelIcon } from '../icons.js';
import css from './PanelExpandButton.module.css';

export interface PanelExpandButtonProps {
  /** The newest tool call's id — what the panel would show. */
  callId: string;
  onOpen: (callId: string) => void;
}

export function PanelExpandButton({ callId, onOpen }: PanelExpandButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={css.button}
      data-detail-expand=""
      aria-label="展开详情板"
      title="展开详情板"
      onClick={() => { onOpen(callId); }}
    >
      <PanelIcon className={css.icon} />
    </button>
  );
}