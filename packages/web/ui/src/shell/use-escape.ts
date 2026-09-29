/**
 * Escape closes the topmost floating layer, one press per layer (ported from
 * the pre-port shell's `app-hooks.ts`). Text fields are skipped: inside one,
 * Escape belongs to that field (the composer aborts the run, the approval
 * dialog clears its reason text), never to the chrome.
 *
 * This is the LAYER SHELF's own listener, not the modal layer's
 * (`shell/modal-layer.ts`): every consumer here sits OUTSIDE a dialog (the
 * stats pills, the view options, the detail panel), so its text fields are
 * only the ones whose owners are already written to consume the key. The modal
 * layer instead requires an explicit `data-modal-escape-owner`, because a
 * dialog's field that ignores Escape would otherwise be a dead key.
 *
 * The handler list is held in a ref and refreshed every render, so a layer
 * that appears later does not need the listener re-bound.
 */
import { useEffect, useRef } from 'react';

export function useEscapeToClose(layers: readonly (() => void)[]): void {
  const latest = useRef(layers);
  useEffect(() => {
    latest.current = layers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      latest.current[0]?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}