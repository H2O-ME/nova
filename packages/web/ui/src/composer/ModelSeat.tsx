/**
 * The model seat: the harness's model trigger chrome and menu card
 * (`ui-model-selection/src/client/ModelSelect.tsx` + `ModelSelect.module.css`,
 * MIT) in its trailing-group position — the first control of the composer's
 * trailing cluster, left of the context meter and the send seat.
 *
 * Two deliberate reductions of the source, both because this product has no
 * data behind them:
 *  - **No effort axis.** The harness's root menu is a two-level dropdown
 *    (Model / Effort rows) fed by per-model reasoning metadata from its host;
 *    an OpenAI-compatible endpoint reports model ids and nothing else, so the
 *    menu is the model list directly. The harness itself hides the Effort row
 *    when the adapter publishes no reasoning metadata — this is that case.
 *  - **One group.** This product configures one endpoint, so the catalog has a
 *    single heading (the gateway label) rather than one group per provider. The
 *    heading is still rendered: it is what tells the reader where these models
 *    come from.
 *
 * Everything else is the source's: fetched when the menu opens (never at
 * attach), a loading row, an error strip with Retry, the sticky group heading,
 * the trailing check on the row in force, the portaled card placed above the
 * trigger with right edges aligned, Escape/arrow handling (the walk itself is
 * the shared `shell/menu-nav.ts` arithmetic, not a local copy), and a
 * pick that lands only when the host says so (the trigger follows
 * `state.model`, not the click).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ModelCatalog } from '../state.js';
import type { ClientFrame, ModelOption } from '../types.js';
import { modelLabel } from './composer-text.js';
import { isOptionIndex, stepOptionIndex } from '../shell/menu-nav.js';
import { useAnchoredPopover } from '../shell/anchored-popover.js';
import { MenuCard, MenuEmpty, MenuError, MenuGroup, MenuOption, MenuStatus } from '../shell/MenuCard.js';
import { ChevronDownOutline14, DataOutline16 } from './Icons.js';
import { cx } from './cx.js';
import css from './ModelSeat.module.css';

export interface ModelSeatProps {
  /** The model id in force (`state.model`) — what a pick compares against. */
  model: string;
  /** The catalog's name for it; null falls back to the id (see `modelLabel`). */
  modelName: string | null;
  /** Whether this kernel can switch models at all (inert text when false). */
  switching: boolean;
  /** The catalog: null until the menu is opened, then rows or a reason. */
  catalog: ModelCatalog | null;
  /** No socket, or an approval is pending: the trigger refuses. */
  disabled: boolean;
  send: (frame: ClientFrame) => void;
}

export function ModelSeat({ model, modelName, switching, catalog, disabled, send }: ModelSeatProps): JSX.Element {
  const label = modelLabel(modelName ?? model);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const loading = catalog?.loading === true;

  const close = useCallback((returnFocus = false): void => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => { triggerRef.current?.focus(); });
  }, []);
  const dismiss = useCallback((): void => { close(); }, [close]);

  // Portaled placement (the source's measure-and-clamp rules): above the
  // trigger, right edges aligned, kept inside the viewport; re-measured when
  // the async catalog resizes the card (shared with the sidebar's menu).
  const { cardRef: menuRef, style: menuStyle } = useAnchoredPopover(triggerRef, {
    open,
    onDismiss: dismiss,
    placement: 'above',
    align: 'end',
    remeasure: catalog,
  });

  const show = (): void => {
    setOpen(true);
    // On demand, every time: the endpoint is the authority on what it serves,
    // and a menu fed from a cached list could offer a model it retired.
    send({ type: 'list_models' });
  };

  // Escape closes; arrows walk the rows. Bound on the document while open so a
  // pointer landing anywhere still reaches us (the card is portaled). The
  // outside-pointerdown half is the popover hook's.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close(true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
      if (items.length === 0) return;
      event.preventDefault();
      // `findIndex` is -1 while nothing is focused, and the walk must land on
      // the first row then — the old local arithmetic did `Math.max(from, 0)`
      // first, which turned an unfocused ArrowDown into index 1 (row 0 skipped)
      // and an unfocused ArrowUp into the last row.
      const from = items.findIndex((item) => item === document.activeElement);
      const next = stepOptionIndex(from, items.length, event.key === 'ArrowDown' ? 1 : -1);
      if (isOptionIndex(next, items.length)) items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [open, close]);

  const pick = (option: ModelOption): void => {
    close(true);
    if (option.id !== model) send({ type: 'set_model', model: option.id });
  };

  itemRefs.current = [];
  let itemIndex = 0;
  const itemRef = (): ((node: HTMLButtonElement | null) => void) => {
    const at = itemIndex++;
    return (node) => { itemRefs.current[at] = node; };
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show();
  };

  if (!switching) {
    // The kernel cannot retarget (or was given no catalog): a control that
    // opened onto nothing would lie about what this surface can do, so the
    // seat keeps the chip's geometry and ink and promises nothing.
    return (
      <span className={css.root}>
        <span className={cx(css.trigger, css.readonly)} data-model-seat="" title={label}>
          <DataOutline16 className={css.triggerIcon} />
          <span className={css.triggerLabel}>{label}</span>
        </span>
      </span>
    );
  }

  const groups = catalog?.groups ?? [];
  const hasRows = groups.some((group) => group.models.length > 0);

  return (
    <span ref={rootRef} className={css.root}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-model-seat=""
        aria-label={`模型，当前：${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={label}
        disabled={disabled}
        onClick={() => { if (open) close(); else show(); }}
        onKeyDown={onTriggerKeyDown}
      >
        <DataOutline16 className={css.triggerIcon} />
        <span className={css.triggerLabel}>{label}</span>
        <span className={open ? cx(css.chevron, css.chevronOpen) : css.chevron} aria-hidden="true">
          <ChevronDownOutline14 />
        </span>
      </button>
      {/* Portaled so the composer card and the column's overflow clips cannot
          crop the list; placement still follows the trigger. The card itself is
          the shell's shared menu (`shell/MenuCard.tsx`). */}
      {open && createPortal(
        <MenuCard
          cardRef={menuRef}
          style={menuStyle}
          label="选择模型"
          busy={loading}
          data={{ 'data-model-menu': '', id: `${id}-menu` }}
        >
          {loading && <MenuStatus>正在读取站点模型目录…</MenuStatus>}
          {catalog?.error !== undefined && (
            <MenuError
              message={catalog.error}
              retryLabel="重试"
              onRetry={() => { send({ type: 'list_models' }); }}
            />
          )}
          {groups.map((group) => (
            <MenuGroup key={group.id} title={group.name}>
              {group.models.map((option) => (
                <MenuOption
                  key={option.id}
                  buttonRef={itemRef()}
                  label={option.name}
                  title={option.id}
                  selected={option.id === model}
                  onClick={() => { pick(option); }}
                />
              ))}
            </MenuGroup>
          ))}
          {!loading && !hasRows && catalog?.error === undefined && (
            <MenuEmpty>站点未公布模型目录（可继续使用当前模型）</MenuEmpty>
          )}
        </MenuCard>,
        document.body,
      )}
    </span>
  );
}