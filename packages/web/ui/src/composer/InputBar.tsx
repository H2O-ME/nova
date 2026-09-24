/**
 * The composer card: the harness's `conversation.composer.bar` body
 * (`ui-conversation/src/client/skeleton/InputBar.tsx`, MIT), ported to this
 * surface's wire.
 *
 * Layout, in the harness's own order: a 22px-radius capsule with the soft
 * elevation stroke (`--dsw-elevation-soft`, stroke rebound to `border-l2`), the
 * draft scrollport capped at 14 × 24px lines (`DraftSurface`), then one toolbar
 * row (`InputToolbar`) whose left group carries the `+` control and the two mode
 * chips and whose trailing group carries the model seat, the context meter's
 * seat, and the 34px primary circle — Stop while a turn runs with an empty
 * draft, Send otherwise. The mode chips live HERE, not in a top bar: a control
 * sits on the thing it governs.
 *
 * The `/` menu is this component's, not the frame's: it is driven by the draft
 * (typing `/` opens it, a query filters it, a pick writes back into the draft),
 * and the draft is component state. `command-menu.ts` holds the rules as pure
 * functions; this file only routes keys and events to them.
 *
 * What the port is missing is missing because the wire is: no attachment intake
 * (no attachment frames), no `@` reference catalog, and no continuable-child or
 * steer transport (so the harness's second Stop seat has no state to read). The
 * seats that remain are the harness's own props, so each of those lands as
 * wiring, not as a rewrite.
 *
 * The draft is component state: nothing in a session log corresponds to an
 * unsent draft, so the bar owns it and hands the kernel only what was sent.
 * Keys route through `composer-keys.ts` (the harness keymap's decision order);
 * this file owns the key routing and the two gestures (send, stop) — nothing
 * else.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { COMPOSING_GRACE_MS, composerKey } from '../composer-keys.js';
import { ComposerMenu, type ComposerMenuItem } from './ComposerMenu.js';
import { commandDraft, commandItems, draftFrame, menuSettlesOnEnter, slashQuery } from './command-menu.js';
import { DraftSurface } from './DraftSurface.js';
import { InputToolbar } from './InputToolbar.js';
import { chainsWheelToConversation } from './composer-measure.js';
import { placeholderFor, primarySeat } from './composer-text.js';
import { cx } from './cx.js';
import css from './InputBar.module.css';
import type { ModelCatalog } from '../state.js';
import type { ApprovalMode, ClientFrame, CommandSummary, PtcMode } from '../types.js';

export interface InputBarProps {
  /** Put one frame on the socket (prompt / abort / mode switches). */
  send: (frame: ClientFrame) => void;
  /** No socket, or an approval is pending: the bar takes no input. */
  disabled: boolean;
  /** A turn is in flight: the primary seat becomes Stop while the draft is empty. */
  running: boolean;
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  /** The model id in force (`state.model`) — the seat's check mark. */
  model: string;
  /** The host's display name for it (the seat's label); null → the id. */
  modelName: string | null;
  /** Whether this kernel can switch models (the seat renders inert when not). */
  modelSwitching: boolean;
  /** The catalog: null until the menu is opened, then rows or a reason. */
  catalog: ModelCatalog | null;
  /** The kernel's commands (`ready.commands`) — what the `/` menu lists. */
  commands: readonly CommandSummary[];
  /**
   * The context meter's seat. The harness puts `ContextMeter` in the toolbar's
   * trailing group, between the model seat and the send circle — the meter
   * belongs to the composer, not the session header.
   */
  meter?: ReactNode;
  /** Owner placeholder (a hero or session-unavailable state wins over it). */
  placeholder?: string;
  /**
   * The composer dock: what sits under the card, inside this root. The
   * harness renders its `conversation.composer.dock` slot in exactly that
   * place, which is what lets `.root:has([data-composer-stats])` tighten the
   * bottom clearance while the stats row is mounted.
   */
  dock?: ReactNode;
  variant?: 'composer' | 'hero';
}

export function InputBar({
  send,
  disabled,
  running,
  approvalMode,
  codeMode,
  model,
  modelName,
  modelSwitching,
  catalog,
  commands,
  meter,
  placeholder,
  dock,
  variant = 'composer',
}: InputBarProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  // The `/` menu: opened by the draft (a leading `/`), by the `+` control, or
  // not at all — dismissal is remembered until the query changes, so Escape
  // while typing does not reopen it on the next keystroke.
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeItem, setActiveItem] = useState(0);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Composition watch: true while composing and for a beat after
  // `compositionend` (Safari closes the composition with a later keydown).
  const composingUntilRef = useRef(0);
  // Unlock (mount / approval resolved / reconnect) hands the caret back to the
  // box. `preventScroll` keeps the transcript where the reader left it.
  useEffect(() => {
    if (disabled) return;
    boxRef.current?.focus({ preventScroll: true });
  }, [disabled]);
  // Wheel chaining on the draft scrollport, armed once: it is never unmounted,
  // so the listener reads live numbers. A hero mount has no host and keeps
  // native wheel scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const onWheel = (event: WheelEvent): void => {
      const host = el.closest('[data-conversation-scroll]');
      if (!(host instanceof HTMLElement)) return;
      const chain = chainsWheelToConversation({
        deltaY: event.deltaY,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      });
      if (!chain) return;
      event.preventDefault();
      host.scrollTop += event.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel) };
  }, []);
  // The menu's own state, derived: a leading `/` opens it while the command word
// is still being typed, the `+` control pins it open (that is the browsing
// gesture), and a dismissal lasts until the next edit.
  const query = slashQuery(draft);
  const menuOpen = !disabled && commands.length > 0 && (pinned || (query !== null && !dismissed));
  const items = commandItems(commands, menuOpen ? query ?? '' : '');
  const active = Math.min(activeItem, Math.max(0, items.length - 1));
  const setMenu = (open: boolean): void => {
    setPinned(open);
    setDismissed(!open);
    setActiveItem(0);
  };
  const edit = (next: string): void => {
    setDraft(next);
    // An edited draft is a new question: whatever was dismissed or highlighted
    // belonged to the previous query.
    setDismissed(false);
    setPinned(false);
    setActiveItem(0);
  };
  const pick = (item: ComposerMenuItem): void => {
    edit(commandDraft(item.id));
    boxRef.current?.focus();
  };
  const submit = (): void => {
    const text = draft.trim();
    if (text === '') return;
    // One place decides what a draft MEANS: a known `/command` becomes a
    // command frame, everything else a prompt (see `command-menu.ts`).
    send(draftFrame(draft, commands));
    setDraft('');
    setPinned(false);
    setDismissed(false);
    boxRef.current?.focus();
  };
  const seat = primarySeat({ running, disabled, draft });
  const placeholderText = placeholderFor({ disabled, hero: variant === 'hero', override: placeholder });
  // Arrows walk the menu and Enter/Tab settle it (the combobox pattern the
  // harness's editor layer implements); everything else is the keymap's.
  const menuKey = (key: string): boolean => {
    if (!menuOpen || items.length === 0) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      setActiveItem((current) => (current + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return true;
    }
    const settled = items[active];
    if (settled === undefined) return false;
    if (key === 'Enter' || key === 'Tab') {
      // A pinned menu over prose is browsing, not completion: letting it settle
      // would overwrite the draft and swallow the send (see the rule).
      if (!menuSettlesOnEnter(draft)) return false;
      pick(settled);
      return true;
    }
    return false;
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menuKey(event.key)) {
      event.preventDefault();
      return;
    }
    const action = composerKey({
      key: event.key,
      shiftKey: event.shiftKey,
      keyCode: event.keyCode,
      isComposing: event.nativeEvent.isComposing,
      repeat: event.repeat,
      recentlyComposing: Date.now() < composingUntilRef.current,
      overlayOpen: menuOpen,
      canSubmit: !disabled,
    });
    if (action === 'default') return;
    event.preventDefault();
    if (action === 'submit') submit();
    if (action === 'dismiss') setMenu(false);
  };
  // Stop goes first: while a run holds an empty draft the same seat is the way
  // out of it (the harness's `primaryStops`).
  const onPrimary = (): void => {
    if (seat.kind === 'stop') send({ type: 'abort' });
    else if (!seat.disabled) submit();
  };
  return (
    <div className={cx(css.root, variant === 'hero' && css.hero)}>
      <div className={css.card} data-composer-card="">
        {/* A closed menu renders null; the anchor stays mounted (the harness's
            overlay slot contract), which is what seats the menu above the card. */}
        <div className={css.overlayAnchor}>
          {menuOpen && (
            <ComposerMenu
              items={items.map((item, index) => (index === active ? { ...item, active: true } : item))}
              groupTitle="命令"
              ariaLabel="命令"
              onPick={pick}
              onHover={(item) => {
                const at = items.findIndex((candidate) => candidate.id === item.id);
                if (at >= 0) setActiveItem(at);
              }}
            />
          )}
        </div>
        <DraftSurface
          value={draft}
          disabled={disabled}
          placeholder={placeholderText}
          composing={composing}
          boxRef={boxRef}
          scrollRef={scrollRef}
          onChange={edit}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composingUntilRef.current = 0; setComposing(true) }}
          onCompositionEnd={() => {
            composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS;
            setComposing(false);
          }}
        />
        <InputToolbar
          disabled={disabled}
          approvalMode={approvalMode}
          codeMode={codeMode}
          model={model}
          modelName={modelName}
          modelSwitching={modelSwitching}
          catalog={catalog}
          meter={meter}
          menuOpen={menuOpen}
          onMenu={setMenu}
          seat={seat}
          onPrimary={onPrimary}
          send={send}
        />
      </div>
      {/* The dock slot, outside the card but inside the root: the stats row's
          own 4px top pad plus the root's tightened 4px bottom pad keep the
          drawn B8 rhythm below the capsule. */}
      {dock}
    </div>
  );
}