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
 * the static test lane can walk the markup without a portal. The skeleton and
 * the buttons are the kit's.
 */
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import { Dialog } from '../kit/Dialog.js';
import { Button } from '../kit/Button.js';
import kitCss from '../kit/Dialog.module.css';

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
    <Dialog role="alertdialog" labelledBy={titleId} width={400} z={1300} panelRef={panelRef} onClose={onClose}>
      <div className={kitCss.title} id={titleId}>未保存的修改</div>
      <p className={kitCss.body}>
        「{section}」还有未保存的修改，离开就会丢失。
      </p>
      <div className={kitCss.footer}>
        {/* Staying takes the autofocus mark and the primary fill: the dialog
            exists to protect the draft, so the recommended action is the one a
            stray Enter lands on. Discarding reads as danger without a solid
            fill — solid-on-solid made both buttons look equally committed. */}
        <Button variant="primary" data-modal-autofocus="" onClick={onClose}>
          留在本页
        </Button>
        <Button variant="dangerOutline" onClick={onConfirm}>
          放弃修改并离开
        </Button>
      </div>
    </Dialog>
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
