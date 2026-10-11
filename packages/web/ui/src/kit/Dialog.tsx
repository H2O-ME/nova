/**
 * The standard dialog skeleton: one full-viewport overlay, the shared mask
 * material, and one centered raised card. Every modal composes this so the
 * family reads as one surface — overlay geometry, mask tokens, the arrival
 * animation and its reduced-motion clamp are declared here exactly once
 * (four dialogs used to carry four identical copies).
 *
 * The panel is content-agnostic: callers render their own rows with the
 * shared part classes (`title` / `body` / `footer` from this module's CSS)
 * and own their buttons (`kit/Button`). Keyboard ownership — Escape, Tab
 * trapping, autofocus, focus return — is the modal layer's
 * (`shell/modal-layer.ts`): callers register their panelRef through
 * `useModalLayer` and pass the same ref here.
 */
import type { ReactNode, Ref } from 'react';
import css from './Dialog.module.css';

export interface DialogProps {
  /** The panel element, shared with the modal layer's focus/Escape ownership. */
  panelRef?: Ref<HTMLDivElement>;
  /** Dismiss (a mask click; Escape belongs to the modal layer). */
  onClose: () => void;
  /** The panel's ARIA role; confirmations use `alertdialog`. */
  role?: 'dialog' | 'alertdialog';
  /** id of the element naming the dialog, wired to `aria-labelledby`. */
  labelledBy?: string;
  /** Card width in px, viewport-capped (the family: 400 confirms, 520 pickers). */
  width?: number;
  /** Card height cap in px, viewport-capped (pickers scroll their overflow). */
  maxHeight?: number;
  /** Card padding in px (20 confirms, 16 pickers). */
  padding?: number;
  /** Overlay stacking order above the app chrome. */
  z?: number;
  children: ReactNode;
}

/** Render the dialog skeleton. */
export function Dialog({
  panelRef,
  onClose,
  role = 'dialog',
  labelledBy,
  width,
  maxHeight,
  padding = 20,
  z = 1200,
  children,
}: DialogProps): JSX.Element {
  return (
    <div className={css.overlay} role="presentation" style={{ zIndex: z }}>
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{
          ...(width === undefined ? {} : { width, maxWidth: 'calc(100vw - 48px)' }),
          ...(maxHeight === undefined ? {} : { maxHeight: `min(${maxHeight}px, calc(100vh - 48px))` }),
          padding,
        }}
      >
        {children}
      </div>
    </div>
  );
}
