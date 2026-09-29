/**
 * The session-delete confirmation.
 *
 * The reference (`ui-workspace/session-actions/ArchiveSession.tsx`) puts a
 * `shell.overlay` dialog between the row button and the destructive call, for
 * the reason a confirm exists at all: deleting a session log is not undoable,
 * and the hover button that starts it is one 16px glyph inside a scrolling
 * list. The rest of the reference's dialog lists the work that will be stopped;
 * that half is a fact this host does not have (a session log carries no live
 * job registry), so the body states what deletion means instead of inventing a
 * list.
 *
 * The confirm hands the file back and closes: the wire is fire-and-forget
 * (`delete_session` answers with a fresh list, or an `error` frame the shell
 * renders), so a dialog that stayed open "waiting" would be showing a state the
 * host never reports.
 *
 * The modal layer owns focus, Escape and Tab; this component owns the two
 * buttons.
 */
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import css from './DeleteSessionDialog.module.css';

export interface DeleteSessionDialogProps {
  /** The session's display title, named in the body so the target is unambiguous. */
  title: string;
  /** Send the delete; the host's answer is a fresh list or an error frame. */
  onConfirm: () => void;
  /** Dismiss (cancel, Escape, or a backdrop click). */
  onClose: () => void;
}

/**
 * Render the confirmation dialog.
 * @param props - see DeleteSessionDialogProps.
 * @returns the portaled overlay tree.
 */
export function DeleteSessionDialog({ title, onConfirm, onClose }: DeleteSessionDialogProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalLayer(panelRef, true, onClose);

  return createPortal(
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={css.title} id={titleId}>删除会话</div>
        <p className={css.body}>
          确定删除「{title}」吗？该会话的日志文件会被移除，此操作无法撤销。
        </p>
        <div className={css.footer}>
          {/* Cancel takes the autofocus mark: the safe choice is the one a stray
              Enter lands on. */}
          <button type="button" className={css.cancel} data-modal-autofocus="" onClick={onClose}>
            取消
          </button>
          <button type="button" className={css.danger} onClick={onConfirm}>
            删除
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
