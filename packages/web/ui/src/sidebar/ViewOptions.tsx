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
import { SIDEBAR_COPY } from './view.js';
import { MenuCard, MenuGroup, MenuOption } from '../shell/MenuCard.js';

/** The modes in menu order: the timeline view first (the reference's default). */
const MODE_ROWS: readonly { mode: GroupMode; label: string }[] = [
  { mode: 'timeline', label: LIST_COPY['groupBy.timeline'] },
  { mode: 'workspace', label: LIST_COPY['groupBy.workspace'] },
  { mode: 'flat', label: LIST_COPY['groupBy.flat'] },
];

export interface ViewOptionsProps {
  /** The grouping in force. */
  mode: GroupMode;
  /** Called with the picked mode; the owner persists it. */
  onPick: (mode: GroupMode) => void;
  /** Re-ask the host for the session list (the reload row, see below). */
  onReload: () => void;
  /** The trigger's class, composed by the header that lays the control out. */
  triggerClassName?: string | undefined;
}

/**
 * Render the trigger and its anchored menu.
 *
 * The reload row lives here (2026-11-14): the reference's header carries only
 * search + filter — its list is host-pushed, so it has no reload to offer —
 * and this surface's own ask-again control rode the header as a third icon
 * that read as clutter beside the two. The action is real (the list is
 * pulled, not pushed), so it keeps a seat: the view menu's tail.
 *
 * @param props - see ViewOptionsProps.
 * @returns the control element tree.
 */
export function ViewOptions({ mode, onPick, onReload, triggerClassName }: ViewOptionsProps): JSX.Element {
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
          <MenuGroup title={SIDEBAR_COPY['list.reload']}>
            <MenuOption
              label={SIDEBAR_COPY['list.reload']}
              onClick={() => {
                close();
                onReload();
              }}
            />
          </MenuGroup>
        </MenuCard>,
        document.body,
      )}
    </>
  );
}