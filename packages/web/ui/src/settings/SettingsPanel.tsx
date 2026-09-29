/**
 * The settings modal: full-viewport mask + centered 800×800 panel with the
 * section nav rail. Ported from deepseek-harness `ui-settings-general/src/
 * client/SettingsRoot.tsx` (the `SettingsPanel` composition) +
 * `SettingsRoot.module.css`, (c) 2026 DeepSeek — MIT License.
 *
 * The shell decides nothing about the sections: each caller passes its real
 * ones (label + icon + content), and the rail renders whatever it is given — a
 * caller registers several today (通用设置 / 模型 / 内置插件 in `App.tsx`), and
 * adding another is a row, not a redesign.
 *
 * Close paths are the reference's three: the header button, a mask click, and
 * Escape. The Escape/Tab/focus lifetime is the reference's `useModalLayer`
 * (`shell/modal-layer.ts`): the dialog registers on the document's modal
 * stack, so only the top layer closes on Escape — a menu open inside the
 * dialog handles the same press during capture first and `preventDefault`s
 * it, which this layer reads as the menu's — Tab cycles inside the panel
 * (portaled menus keep their own traversal), focus enters on the active nav
 * row without a ring and returns to the invoker on unmount.
 */
import { useState, useId, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import { CloseIcon } from '../icons.js';
import { cls } from '../sidebar/view.js';
import a11yCss from '../chat/accessibility.module.css';
import css from './SettingsPanel.module.css';

/** One nav row and its content: a section this product actually registers. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: JSX.Element;
  content: JSX.Element;
}

export interface SettingsDialogProps {
  /** The dialog's name, rendered as the nav title (`设置`). */
  title: string;
  /** The close button's accessible name (`关闭`). */
  closeLabel: string;
  sections: readonly SettingsSection[];
  /** The nav row the dialog is on (undefined falls back to the first). */
  activeId?: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** The dialog element, for the wrapper's focus and Escape lifetime. */
  panelRef?: MutableRefObject<HTMLDivElement | null> | undefined;
}

/**
 * The dialog markup, portal-free so the static lane can walk it without a
 * document.
 * @param props - see SettingsDialogProps.
 * @returns the dialog element tree.
 */
export function SettingsDialog({
  title,
  closeLabel,
  sections,
  activeId,
  onSelect,
  onClose,
  panelRef,
}: SettingsDialogProps): JSX.Element {
  const active = sections.find((section) => section.id === activeId) ?? sections[0];
  const titleId = useId();
  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <nav className={css.nav} aria-label={title}>
          <div className={css.navTitle} id={titleId} tabIndex={-1}>{title}</div>
          <div className={css.navList}>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={cls(css.navCell, section.id === active?.id && css.active)}
                aria-current={section.id === active?.id ? 'true' : undefined}
                // The modal layer's entry focus lands here (the reference's
                // `data-modal-autofocus` on the active nav row).
                data-modal-autofocus={section.id === active?.id ? '' : undefined}
                onClick={() => { onSelect(section.id); }}
              >
                {section.icon}
                <span className={css.navLabel}>{section.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            {/* The actions seat rides the header even with no section actions:
                it carries `margin-left: auto`, which is what pushes the close
                control to the right edge under `justify-content: space-between`.
                Without it the button is the header's only child and lands at
                the START edge. */}
            <div className={css.actions} />
            <button type="button" className={css.close} onClick={onClose}>
              <CloseIcon />
              <span className={a11yCss.visuallyHidden}>{closeLabel}</span>
            </button>
          </div>
          <div className={css.options}>{active?.content}</div>
        </div>
      </div>
    </div>
  );
}

export interface SettingsPanelProps {
  /** The dialog's name, rendered as the nav title (`设置`). */
  title: string;
  /** The close button's accessible name (`关闭`). */
  closeLabel: string;
  sections: readonly SettingsSection[];
  onClose: () => void;
}

/**
 * Render the settings dialog.
 * @param props - see SettingsPanelProps.
 * @returns the portaled overlay tree.
 */
export function SettingsPanel({ title, closeLabel, sections, onClose }: SettingsPanelProps): JSX.Element {
  const [activeId, setActiveId] = useState<string | undefined>(sections[0]?.id);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The modal layer's lifetime runs ONCE per mount: entry focus without a
  // ring, top-layer Escape and Tab ownership, and the focus return to the
  // invoker on unmount. The caller's onClose is read through the layer's own
  // ref, so a fresh callback per shell render does not re-bind anything.
  useModalLayer(panelRef, true, onClose);

  return createPortal(
    <SettingsDialog
      title={title}
      closeLabel={closeLabel}
      sections={sections}
      activeId={activeId}
      onSelect={setActiveId}
      onClose={onClose}
      panelRef={panelRef}
    />,
    document.body,
  );
}
