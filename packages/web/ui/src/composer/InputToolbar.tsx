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
 * **The access chip rides the composer in EVERY variant** — the tier is a
 * session-wide fact, and the input bar is where the reference keeps it: its own
 * bar renders `conversation.input.permission` for every session
 * (`sessionId !== undefined ? … : null`), not only while the session is blank.
 * Carrying it only in the hero is what pushed this product into bolting the tier
 * onto the session header, where it read as a control that had floated away from
 * the box it belongs to.
 *
 * The access tier is the one mode control here, and it stays pickable while a run
 * is in flight: it is read fresh at the NEXT approval and is not part of the
 * cached prefix. A control that re-rosters the tool table would be refused
 * mid-run, which is exactly why no such control lives in this bar.
 */
import { PermissionSelect } from '../conversation/PermissionSelect.js';
import { PlusOutline16, SendArrowIcon, StopSquareIcon } from './Icons.js';
import { ModelSeat } from './ModelSeat.js';
import { COMMANDS_LABEL, type PrimarySeat } from './composer-text.js';
import css from './InputBar.module.css';
import type { ModelCatalog } from '../state.js';
import type { ApprovalMode, ClientFrame } from '../types.js';

export interface InputToolbarProps {
  /** No socket, or an approval is pending: the bar's controls refuse. */
  disabled: boolean;

  /**
   * `hero` = a session that has not started, `composer` = one that has. The
   * access tier rides both; the data attribute keeps the two variants' spacing
   * distinct.
   */
  variant: 'hero' | 'composer';
  approvalMode: ApprovalMode;
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
  variant,
  approvalMode,
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
          {/* The EXECUTION mode has no chip here. Which execution modes exist is
              decided by the plugin that provides one, so that plugin renders its
              own control on its own settings page — a chip here would mean the
              host keeping a vocabulary (and a frame) for a plugin it is not
              supposed to know. */}
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