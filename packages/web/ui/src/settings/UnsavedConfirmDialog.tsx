/**
 * The unsaved-edit confirmation for the settings panel.
 *
 * Switching sections (or closing the panel) unmounts the section on screen,
 * and a section holding unsaved edits loses them with the mount. The panel
 * therefore asks before it lets go — the same shape as the session-delete
 * confirm, for the same reason: the gesture that starts the loss (a nav row
 * click, Escape, a mask click) is one click the reader may not have aimed at
 * their own draft.
 *
 * The dialog hands the DECISION back and closes; the panel owns what the
 * decision does. Split body/wrapper like `SettingsDialog`/`SettingsPanel` so
 * the static test lane can walk the markup without a portal.
 */
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import css from './UnsavedConfirmDialog.module.css';

export interface UnsavedConfirmProps {
  /** The nav label of the section holding the edits, named in the body. */
  section: string;
  /** Leave anyway (the edits are lost with the unmount). */
  onConfirm: () => void;
  /** Stay (cancel, Escape, or a backdrop click). */
  onClose: () => void;
}

/**
 * The dialog markup, portal-free so the static lane can walk it.
 * @param props - see UnsavedConfirmProps.
 * @returns the dialog element tree.
 */
export function UnsavedConfirmDialogBody({ section, onConfirm, onClose }: UnsavedConfirmProps): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalLayer(panelRef, true, onClose);
  return (
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
        <div className={css.title} id={titleId}>未保存的修改</div>
        <p className={css.body}>
          「{section}」还有未保存的修改，离开就会丢失。
        </p>
        <div className={css.footer}>
          {/* Staying takes the autofocus mark: the safe choice is the one a
              stray Enter lands on. */}
          <button type="button" className={css.stay} data-modal-autofocus="" onClick={onClose}>
            留在本页
          </button>
          <button type="button" className={css.discard} onClick={onConfirm}>
            放弃修改并离开
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Render the confirmation dialog over the app.
 * @param props - see UnsavedConfirmProps.
 * @returns the portaled overlay tree.
 */
export function UnsavedConfirmDialog(props: UnsavedConfirmProps): JSX.Element {
  return createPortal(<UnsavedConfirmDialogBody {...props} />, document.body);
}
