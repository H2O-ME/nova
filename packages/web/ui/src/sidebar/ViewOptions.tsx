/**
 * The section header's view-options control: the harness `ui-workspace`
 * ViewOptionsMenu (`IconPersonalizationOutline16` trigger → the `Menu`'s
 * 分组方式 section, `WorkspaceBrowser.tsx`) with the one axis this product has.
 *
 * The reference's menu carries two axes — grouping (by workspace / one list)
 * and ordering (manual / last updated). Ordering is not ported because it is
 * not ours to offer: rows are the kernel's session index, ordered newest-first
 * at the source, and a client-side re-sort would be a second ordering
 * authority over the same list. The grouping axis is real here (`list-view.ts`
 * holds its rule), so the menu is one section wide.
 */
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersIcon } from '../icons.js';
import { useAnchoredPopover } from '../shell/anchored-popover.js';
import { useEscapeToClose } from '../shell/use-escape.js';
import { LIST_COPY, type GroupMode } from './list-view.js';
import { MenuCard, MenuGroup, MenuOption } from '../shell/MenuCard.js';

/** The two modes in menu order: the reference's `groupBy` rows. */
const MODE_ROWS: readonly { mode: GroupMode; label: string }[] = [
  { mode: 'workspace', label: LIST_COPY['groupBy.workspace'] },
  { mode: 'flat', label: LIST_COPY['groupBy.flat'] },
];

export interface ViewOptionsProps {
  /** The grouping in force. */
  mode: GroupMode;
  /** Called with the picked mode; the owner persists it. */
  onPick: (mode: GroupMode) => void;
  /** The trigger's class, composed by the header that lays the control out. */
  triggerClassName?: string | undefined;
}

/**
 * Render the trigger and its anchored menu.
 * @param props - see ViewOptionsProps.
 * @returns the control element tree.
 */
export function ViewOptions({ mode, onPick, triggerClassName }: ViewOptionsProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const close = (): void => { setOpen(false); };
  useEscapeToClose([close]);
  const { cardRef, style } = useAnchoredPopover(triggerRef, {
    open,
    onDismiss: close,
    // Under the trigger: it sits in the sidebar's header, above the list it
    // governs, and right-aligned so the card never leaves the column.
    placement: 'below',
    align: 'end',
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={LIST_COPY['viewOptions.label']}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={LIST_COPY['viewOptions.label']}
        onClick={() => { setOpen(!open); }}
      >
        <SlidersIcon />
      </button>
      {open && createPortal(
        <MenuCard cardRef={cardRef} style={style} label={LIST_COPY['viewOptions.label']} data={{ 'data-sidebar-view-options': '' }}>
          <MenuGroup title={LIST_COPY['groupBy.label']}>
            {MODE_ROWS.map((row) => (
              <MenuOption
                key={row.mode}
                label={row.label}
                selected={row.mode === mode}
                onClick={() => {
                  close();
                  if (row.mode !== mode) onPick(row.mode);
                }}
              />
            ))}
          </MenuGroup>
        </MenuCard>,
        document.body,
      )}
    </>
  );
}