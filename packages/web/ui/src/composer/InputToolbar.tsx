/**
 * The composer card's toolbar row (harness InputBar `.row`): the `+` control
 * and the two mode chips on the left, the model seat and the 34px primary
 * circle on the right. (The context meter is NOT here: the harness seats it in
 * the dock row under the card, beside the stats pills — see `InputBar`.)
 *
 * Split out of `InputBar.tsx` by responsibility, not by file size: this row is
 * the card's control chrome (what the harness's `.row` / `.tools` / `.modes` /
 * `.trailing` groups hold), while the bar owns the draft and the run state the
 * seats read. Its styles stay in `InputBar.module.css` because that is the
 * sheet the harness ships for the card and its row together.
 *
 * **Both mode chips ride the composer in EVERY variant** — the access tier and
 * the execution mode are session-wide facts, and the input bar is where the
 * reference keeps them: its own bar renders `conversation.input.permission` for
 * every session (`sessionId !== undefined ? … : null`), not only while the
 * session is blank. Carrying them only in the hero is what pushed this product
 * into bolting the tier onto the session header, where it read as a control that
 * had floated away from the box it belongs to.
 *
 * The two locks are deliberately different, because the host's answers differ:
 * the tier is readable at the NEXT approval and is not part of the cached
 * prefix, so it stays pickable while a run is in flight; the execution mode
 * re-rosters the tool table the running request was built on, so the server
 * refuses it mid-run and the chip says so before the click.
 */
import { PermissionSelect, CodeModeSelect } from '../conversation/PermissionSelect.js';
import { PlusOutline16, SendArrowIcon, StopSquareIcon } from './Icons.js';
import { ModelSeat } from './ModelSeat.js';
import { COMMANDS_LABEL, type PrimarySeat } from './composer-text.js';
import css from './InputBar.module.css';
import type { ModelCatalog } from '../state.js';
import type { ApprovalMode, ClientFrame, PtcMode } from '../types.js';

export interface InputToolbarProps {
  /** No socket, or an approval is pending: the bar's controls refuse. */
  disabled: boolean;
  /** A turn is in flight: the hero's execution-mode chip locks (the server refuses it). */
  running: boolean;
  /**
   * `hero` = a session that has not started, `composer` = one that has. The
   * execution-mode chip renders in the hero ONLY: it picks the toolset, so once a
   * transcript exists the mode is settled for that session, and the hero is the
   * last seat where the pick is still meaningful. The access tier rides both.
   */
  variant: 'hero' | 'composer';
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
  /** Whether the trigger menu is open (the `+` control's `aria-expanded`). */
  menuOpen: boolean;
  /** The `+` control: `true` opens the menu, `false` closes it. */
  onMenu?: (open: boolean) => void;
  /** What the primary circle is showing (send vs. stop, and its label). */
  seat: PrimarySeat;
  onPrimary: () => void;
  send: (frame: ClientFrame) => void;
}

export function InputToolbar({
  disabled,
  running,
  variant,
  approvalMode,
  codeMode,
  model,
  modelName,
  modelSwitching,
  catalog,
  menuOpen,
  onMenu,
  seat,
  onPrimary,
  send,
}: InputToolbarProps): JSX.Element {
  // Button presses would steal focus from the draft; suppressing at mousedown
  // keeps typing everywhere (the harness's `keepFocus`).
  const keepFocus = (event: { preventDefault: () => void }): void => { event.preventDefault(); };
  return (
    <div className={css.row}>
      <div className={css.tools}>
        <button
          type="button"
          className={css.add}
          aria-label={COMMANDS_LABEL}
          title={COMMANDS_LABEL}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          disabled={disabled || onMenu === undefined}
          onMouseDown={keepFocus}
          onClick={() => { onMenu?.(!menuOpen) }}
        >
          <PlusOutline16 />
        </button>
        {/* The access tier rides every variant: it is read fresh at the NEXT
            approval, so it stays live mid-run by design, and the settings page
            owns its "default for later sessions" half.
            `data-mode-controls` is the static lane's hook: it carries the
            variant, so the lane reads which phase the row is in without matching
            on copy or class names. */}
        <div className={css.modes} data-mode-controls={variant}>
          <PermissionSelect
            value={approvalMode}
            disabled={disabled}
            onPick={(mode) => { send({ type: 'set_approval_mode', mode }) }}
          />
          {/* The execution mode belongs to the HERO only — the seat of a session
              that has not started. It picks the TOOLSET, which is part of the
              cached prefix, so once a transcript exists the mode is settled for
              that session; an always-visible chip offered a control the server
              refuses mid-run, and it published a value the plugin manager could
              already have contradicted. The settings page holds the
              "default for the next session" half. */}
          {variant === 'hero' && (
            <CodeModeSelect
              value={codeMode}
              disabled={disabled || running}
              onPick={(mode) => { send({ type: 'set_code_mode', mode }) }}
            />
          )}
        </div>
      </div>
      <div className={css.trailing}>
        <ModelSeat model={model} modelName={modelName} switching={modelSwitching} catalog={catalog} disabled={disabled} send={send} />
        <button
          type="button"
          className={css.primary}
          aria-label={seat.label}
          title={seat.label}
          disabled={seat.disabled}
          onMouseDown={keepFocus}
          onClick={onPrimary}
        >
          {seat.kind === 'stop' ? <StopSquareIcon /> : <SendArrowIcon />}
        </button>
      </div>
    </div>
  );
}