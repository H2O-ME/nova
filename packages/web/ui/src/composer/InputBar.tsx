/**
 * The composer card: the harness's `conversation.composer.bar` body
 * (`ui-conversation/src/client/skeleton/InputBar.tsx`, MIT), ported to this
 * surface's wire.
 *
 * Layout, in the harness's own order: a 22px-radius capsule with the soft
 * elevation stroke (`--dsw-elevation-soft`, stroke rebound to `border-l2`), the
 * draft scrollport capped at 14 × 24px lines (`DraftSurface`), then one toolbar
 * row (`InputToolbar`) whose left group carries the `+` control (and, in the
 * hero, the two mode chips) and whose trailing group carries the model seat and
 * the 34px primary circle — Stop while a turn runs with an empty draft, Send
 * otherwise. Under the card, the dock row holds the session's readings (stats
 * pills and the context meter) — the harness seats both there, not in the
 * toolbar.
 *
 * The mode chips are `variant`-gated: a tier and an execution mode are defaults
 * for a session that has not run yet, so the hero carries them and a started
 * session reaches them through 设置 instead (see `InputToolbar`).
 *
 * The `/` menu is this component's, not the frame's: it is driven by the draft
 * (typing `/` opens it, a query filters it, a pick writes back into the draft),
 * and the draft is component state. `command-menu.ts` holds the rules as pure
 * functions; this file only routes keys and events to them.
 *
 * The intake and the `@` catalog ARE here: `attachments.ts` wires the three
 * routes in (document drop, paste, the hidden picker) and `list_files` backs the
 * reference menu. What the port is missing is missing because the wire is: there
 * is no attachment FRAME, so a landed upload cannot be a structured payload —
 * instead its stored absolute path rides the prompt as a plain `@path` mention
 * (`attachmentMentions`), which is the same text a hand-typed reference is and
 * which `read_file` resolves out of the uploads trusted-read root. The
 * continuable-child and steer transports are absent too (so the harness's second
 * Stop seat has no state to read). The seats that remain are the harness's own
 * props, so each of those lands as wiring, not as a rewrite.
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
import { ADD_FILE_ITEM, actionItems, commandDraft, commandItems, draftFrame, menuKeyDecision, slashQuery } from './command-menu.js';
import { claimHint } from './claim-hint.js';
import { atQuery, atSpan, referenceDraft, referenceItems } from './reference-menu.js';
import { referenceCrumbs } from './reference-crumbs.js';
import type { ReferenceCrumb } from './reference-crumbs.js';
import { attachmentMentions, useAttachments } from './attachments.js';
import { readyImageRefs } from './image-draft.js';
import { ComposerAttachments } from './ComposerAttachments.js';
import { DropOverlay } from './DropOverlay.js';
import { DraftSurface } from './DraftSurface.js';
import { InputToolbar } from './InputToolbar.js';
import { chainsWheelToConversation } from './composer-measure.js';
import { DROP_BLOCKED, DROP_TITLE, placeholderFor, primarySeat } from './composer-text.js';
import { cx } from './cx.js';
import css from './InputBar.module.css';
import type { ModelCatalog } from '../state.js';
import type { ApprovalMode, ClientFrame, CommandSummary, PtcMode, WireFileEntry } from '../types.js';

/**
 * How long typing in an `@` query settles before the host is asked. The walk
 * costs a filesystem pass, so a burst of keystrokes must collapse into one
 * request; short enough that the menu feels live.
 */
const FILE_QUERY_DEBOUNCE_MS = 120;

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
   * Whether a goal is already in force (`state.goal !== null`).
   *
   * It is the composer's own disambiguation input, and the reason `/goal` gets
   * two different ghost lines: with no goal the reader is told to describe the
   * objective, and with one they are told which control words the command
   * accepts (`claim-hint.ts`). Without it the bar would invite an objective the
   * command refuses.
   */
  hasGoal: boolean;
  /**
   * The `@` menu's candidate files, as the host last answered. Empty while no
   * listing has landed (the menu shows its loading row instead of "no files").
   */
  fileItems: readonly WireFileEntry[];
  /** Whether that listing was cut short by the host's walk cap. */
  filesTruncated: boolean;
  /** A `list_files` request is in flight for the query now being typed. */
  filesPending: boolean;
  /**
   * Open the HOST's file picker (the `+` menu's 引用本地文件 row).
   *
   * The picker is not here because it is not a browser control: a `File` from an
   * `<input type=file>` carries no real path, so only the host's own enumeration
   * can produce one. The dialog belongs to whoever opens it, which is why this
   * is a callback out rather than local state.
   */
  onReferenceFile: () => void;
  /**
   * A file the host's picker just named, on its way into the rail. `seq` (not
   * the path) is what makes a re-pick of the same file a new event.
   */
  pickedFile?: { path: string; name: string; seq: number } | null;
  /** Tell the owner the pending pick has been taken (so it is not re-added). */
  onPickedFileConsumed?: () => void;
  /** Owner placeholder (a hero or session-unavailable state wins over it). */
  placeholder?: string;
  /**
   * The composer dock: what sits under the card, inside this root. The
   * harness renders its `conversation.composer.dock` slot in exactly that
   * place — the stats pills and the context meter share one centered row
   * there. Each reading renders nothing until it has numbers, so an early
   * session's dock is empty and hides itself (`.dock:empty`), which is what
   * keeps the hero optically centered before the first run lands.
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
  hasGoal,
  fileItems,
  filesTruncated,
  filesPending,
  onReferenceFile,
  pickedFile,
  onPickedFileConsumed,
  placeholder,
  dock,
  variant = 'composer',
}: InputBarProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  // The caret, which trigger detection is relative to (see `commandSpan` /
  // `atQuery`): a token stops being live the moment the caret leaves it, so
  // moving the caret back into prose must close the menu it opened. Kept as
  // state rather than read off the DOM at decision time because the derivations
  // below run during render, and the reference tracks the same value in its
  // editor projection.
  const [caret, setCaret] = useState(0);
  // The `/` menu: opened by the draft (a leading `/`), by the `+` control, or
  // not at all — dismissal is remembered until the query changes, so Escape
  // while typing does not reopen it on the next keystroke.
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeItem, setActiveItem] = useState(0);
  // A refused intake (a dropped folder) is announced the same way a failed
  // upload is: the card says what happened, and the drop never silently
  // vanishes.
  const [intakeError, setIntakeError] = useState<string | null>(null);
  // Attachments: the document-level drop/paste intake plus the hidden picker.
  // While the composer is disabled (no connection, or a run owns it) an intake
  // attempt is ignored rather than posted to a socket that cannot carry it. The
  // sink is what lets the drop and paste listeners — bound inside the hook —
  // publish a refusal, since they have no caller to return it to.
  const attachments = useAttachments(disabled, setIntakeError);
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
  // The menu's own state, derived: a `/` token ending at the caret opens it
  // while the command word is still being typed, the `+` control pins it open
  // (that is the browsing gesture), and a dismissal lasts until the next edit.
  const query = slashQuery(draft, caret);
  // One menu, two sources. Which one is showing decides what a pick writes and
  // what the rows are: a `/` runs a command, an `@` writes a reference token.
  // A draft cannot be both at once (they are distinct leading tokens), so the
  // `@` source claims the menu whenever its query is live.
  const refQuery = atQuery(draft, caret);
  const refSource = refQuery !== null;
  // The trail a drill owes, keyed by the query the drill produced: only that
  // exact query shows the breadcrumb header (a drill replaced the text the
  // user was reading and owes them the way back), and any other edit — typing,
  // a settling pick — clears it, because the draft again carries its own
  // context. This is the harness's `drilled` request flag, re-derived.
  const drilledQuery = useRef<string | null>(null);
  const refCrumbs = refQuery !== null && refSource
    ? referenceCrumbs(refQuery, refQuery === drilledQuery.current)
    : null;
  // A crumb press drills back to that step: the root rewrites the token to a
  // bare `@` (the listing it reopens is the workspace itself), any deeper step
  // keeps the quote-open directory form a drill pick writes. Both keep the
  // menu open — a crumb is navigation, not a settling pick.
  const drillToCrumb = (crumb: ReferenceCrumb): void => {
    const span = atSpan(draft, caret);
    if (span === null) return;
    drilledQuery.current = crumb.path === '' ? null : `${crumb.path}/`;
    edit(crumb.path === ''
      ? `${draft.slice(0, span.start)}@${draft.slice(span.end)}`
      : referenceDraft(draft, crumb.path, true, caret));
    boxRef.current?.focus();
  };
  const menuOpen = !disabled && (refSource || (commands.length > 0 && (pinned || (query !== null && !dismissed))));
  // The composer's own action rows ride the menu only while it was opened as a
  // browser (`pinned`): they belong to this surface, not to the kernel's
  // catalog, so a typed `/query` — a question about that catalog — does not see
  // them. See `actionItems()`.
  const items = refSource
    ? referenceItems(fileItems, refCrumbs === null)
    : [...(pinned ? actionItems() : []), ...commandItems(commands, menuOpen ? query ?? '' : '')];
  const active = Math.min(activeItem, Math.max(0, items.length - 1));
  const setMenu = (open: boolean): void => {
    setPinned(open);
    setDismissed(!open);
    setActiveItem(0);
  };
  const edit = (next: string, nextCaret: number = next.length): void => {
    setDraft(next);
    setCaret(nextCaret);
    // An edited draft is a new question: whatever was dismissed or highlighted
    // belonged to the previous query.
    setDismissed(false);
    setPinned(false);
    setActiveItem(0);
  };
  const pick = (item: ComposerMenuItem): void => {
    // The local action rows act instead of writing text: a pick opens the
    // picker, and the draft is left exactly as it was (a file is an addition to
    // the message, not a replacement for it).
    if (item.id === ADD_FILE_ITEM) {
      setMenu(false);
      onReferenceFile();
      return;
    }
    // A reference pick writes a mention token into the draft and keeps the
    // caret; a command pick writes the command word. Both rewrite the live
    // token's own span, so a command or mention typed mid-draft leaves its
    // surroundings alone. Both leave the menu's own state reset through `edit`.
    if (refSource) {
      // A drill keeps the token live (`@src/`), so the next listing is the
      // directory's own children and the trail names it; a settling pick ends
      // the reference and the trail with it.
      drilledQuery.current = item.drill === true ? `${item.id}/` : null;
      edit(referenceDraft(draft, item.id, item.drill === true, caret));
    } else {
      edit(commandDraft(draft, item.id, caret));
    }
    boxRef.current?.focus();
  };
  const submit = (): void => {
    const text = draft.trim();
    // An image-only prompt is legitimate (paste a screenshot and hit send), so
    // the emptiness gate is text OR a ready image — but never an image still
    // uploading, whose reference does not exist yet.
    const imageRefs = readyImageRefs(attachments.images);
    const stillUploading = attachments.images.some((image) => image.status === 'uploading');
    if (text === '' && imageRefs.length === 0) return;
    if (stillUploading) return;
    // Files become mention tokens in the prompt; images ride the frame as
    // references. Two routes on purpose: a path is text the model resolves with
    // `read_file`, while image bytes have no path and must be content.
    const mentions = attachmentMentions(attachments.files);
    // One place decides what a draft MEANS: a known `/command` becomes a
    // command frame, everything else a prompt (see `command-menu.ts`). A command
    // never takes attachments, so the mentions ride only the prompt path —
    // narrowed on `'prompt'` rather than `!== 'command'` so the text field is
    // proven present rather than assumed.
    const frame = draftFrame(draft, commands);
    if (frame.type === 'prompt') {
      const body = mentions === '' ? frame.text : `${frame.text}\n\n${mentions}`;
      send(imageRefs.length === 0
        ? { type: 'prompt', text: body }
        : { type: 'prompt', text: body, images: imageRefs });
    } else {
      send(frame);
    }
    attachments.clear();
    setDraft('');
    setCaret(0);
    setPinned(false);
    setDismissed(false);
    boxRef.current?.focus();
  };
  const seat = primarySeat({
    running,
    disabled,
    draft,
    // A named reference is ready the moment the host returns it (nothing is
    // copied or transferred), so no intake state gates the key.
    uploading: false,
  });
  // The `@` listing is asked per query, debounced: the host walks the workspace
  // on every ask, so typing `@src/main` must not start five walks. The timer
  // keeps the menu responsive (the answer for the previous query stays on
  // screen) while collapsing a burst of keystrokes into one request.
  const listedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!refSource || refQuery === null || disabled) return;
    // A query the host has already answered (or is answering) is not re-asked:
    // reopening the menu over unchanged text must not re-walk the workspace.
    if (listedQuery.current === refQuery) return;
    const timer = setTimeout(() => {
      listedQuery.current = refQuery;
      send({ type: 'list_files', query: refQuery });
    }, FILE_QUERY_DEBOUNCE_MS);
    return () => { clearTimeout(timer); };
  }, [refQuery, refSource, disabled, send]);
  // The claim's ghost hint: what the command at the draft's head offers next.
  // The reference keys it by command name, with a `.active` variant for `/goal`
  // while a goal is in force (`claim-hint.ts`); a draft the registry does not
  // claim gets none, because that draft is sent as an ordinary prompt.
  const hint = claimHint(draft, commands, hasGoal);
  const placeholderText = placeholderFor({ disabled, hero: variant === 'hero', override: placeholder });
  // Take a file the host's picker named. Keyed on `seq`, not the path: picking
  // the same file again after removing it must add it again, and a bare path
  // would be indistinguishable from the first pick.
  useEffect(() => {
    if (pickedFile === undefined || pickedFile === null) return;
    attachments.add(pickedFile.path, pickedFile.name);
    onPickedFileConsumed?.();
  }, [pickedFile, attachments, onPickedFileConsumed]);
  // Arrows walk the menu and Enter/Tab settle it (the combobox pattern the
  // harness's editor layer implements); everything else is the keymap's. The
  // arbitration itself is pure (`command-menu.ts`) so it can be asserted without
  // a DOM — see the caret note on `menuKeyDecision`.
  const menuKey = (key: string): boolean => {
    if (!menuOpen || items.length === 0) return false;
    const decision = menuKeyDecision(key, draft, caret, items[active], refSource);
    if (decision.kind === 'move') {
      setActiveItem((current) => (current + decision.delta + items.length) % items.length);
      return true;
    }
    if (decision.kind === 'pick') {
      const settled = items[active];
      if (settled === undefined) return false;
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
      // Enter obeys the SAME decision the primary button shows, so the two can
      // never disagree: an upload in flight consumes the key instead of sending
      // a prompt that would name a file not yet on disk (dsh refuses this in
      // `view-binding.ts:128` for the same reason).
      canSubmit: seat.kind === 'send' && !seat.disabled,
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
      {/* Document-level drop target: the intake hook binds the listeners; this
          is the page-wide layer that says the drop will land somewhere (the
          harness's `DropOverlay`, a body portal rather than a ring around the
          composer — the drop target IS the document). */}
      {attachments.dragging && (
        <DropOverlay disabled={disabled} labels={{ title: disabled ? DROP_BLOCKED : DROP_TITLE }} />
      )}
      <div className={css.card} data-composer-card="">
        {/* The overlay anchor is the card's FIRST child (the harness's own
            order): it is out of flow, so being first lets it anchor a menu to
            the card's top edge without consuming one of the card's flex-gap
            slots. */}
        <div className={css.overlayAnchor}>
          {menuOpen && (
            <ComposerMenu
              items={items.map((item, index) => (index === active ? { ...item, active: true } : item))}
              // Reference rows carry their own section heading (`文件`); the
              // command catalog has no per-row sections, so the group heading
              // names it.
              groupTitle={refSource ? undefined : '命令'}
              ariaLabel={refSource ? '文件引用' : '命令'}
              // Names the list and gives its rows ids, so the armed row is
              // announced as `aria-activedescendant` even though focus stays in
              // the draft below (the combobox pattern).
              listboxId="composer-trigger-menu"
              // A pending `@` listing shows the reference's skeleton rows; an
              // empty command catalog has nothing pending to wait for.
              pending={refSource && filesPending && items.length === 0}
              // Only a drill carries the trail: the header IS the way back.
              crumbs={refCrumbs ?? undefined}
              onCrumb={drillToCrumb}
              onPick={pick}
              // The chevron's click. Without this the control rendered, was
              // focusable, carried `进入目录` and did nothing — and because its
              // handler stops propagation, the click did not even settle the row.
              onDrill={pick}
              onDismiss={() => { setMenu(false); }}
              onHover={(item) => {
                const at = items.findIndex((candidate) => candidate.id === item.id);
                if (at >= 0) setActiveItem(at);
              }}
            />
          )}
          {/* The listing's own state, under the menu's rows: an empty `@` menu
              must say whether nothing matched or the walk is still running,
              which are different answers a reader acts on differently. The
              running answer is the skeleton above, so only the finished-and-
              empty one reaches this line. */}
          {refSource && menuOpen && !filesPending && (items.length === 0
            ? (
              <div className={css.menuStatus} role="status">
                没有匹配的文件
              </div>
            )
            : filesTruncated
              ? (
                <div className={css.menuStatus} role="status">
                  结果已截断，继续输入以缩小范围
                </div>
              )
              : null)}
        </div>
        {/* No `<input type=file>`: a browser `File` carries no real path, so it
            cannot become an `@` reference. The `+` menu's 引用本地文件 opens the
            HOST's picker (`list_directory` with `files: true`) instead. */}
        {/* Staged references, above the draft: the harness's attachment RAIL
            (`ui-attachment/AttachmentRail`), whose cards are 240 × 64 and whose
            overflow pans sideways under edge arrows — several files never grow
            the card vertically. Empty while nothing is staged, so the card's
            flex gap spends nothing on the row. */}
        <ComposerAttachments
          files={attachments.files}
          images={attachments.images}
          onRemove={attachments.remove}
          onRemoveImage={attachments.removeImage}
        />
        <DraftSurface
          value={draft}
          disabled={disabled}
          placeholder={placeholderText}
          hint={hint}
          composing={composing}
          boxRef={boxRef}
          scrollRef={scrollRef}
          onChange={edit}
          onCaret={setCaret}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composingUntilRef.current = 0; setComposing(true) }}
          onCompositionEnd={() => {
            composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS;
            setComposing(false);
          }}
        />
        <InputToolbar
          disabled={disabled}
          running={running}
          variant={variant}
          approvalMode={approvalMode}
          codeMode={codeMode}
          model={model}
          modelName={modelName}
          modelSwitching={modelSwitching}
          catalog={catalog}
          menuOpen={menuOpen}
          onMenu={setMenu}
          seat={seat}
          onPrimary={onPrimary}
          send={send}
        />
      </div>
      {/* A refused intake (a dropped folder) reads under the card, not inside
          it: it is about the gesture, not about a file that got staged. */}
      {intakeError !== null && (
        <div className={css.intakeError} role="status">
          {intakeError}
        </div>
      )}
      {/* The dock row, outside the card but inside the root: the stats pills
          and the context meter share one centered line there (the harness's
          `.dock`). It renders at every phase and hides itself when empty — the
          readings arrive mid-session, and the hero's own rule (`.hero
          .dock:empty`) is what keeps a reading-less hero optically centered. */}
      <div className={css.dock}>{dock}</div>
    </div>
  );
}