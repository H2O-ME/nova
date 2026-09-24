/**
 * The composer card's toolbar row (harness InputBar `.row`): the `+` control
 * and the two mode chips on the left, the model seat, the context meter's seat
 * and the 34px primary circle on the right.
 *
 * Split out of `InputBar.tsx` by responsibility, not by file size: this row is
 * the card's control chrome (what the harness's `.row` / `.tools` / `.modes` /
 * `.trailing` groups hold), while the bar owns the draft and the run state the
 * seats read. Its styles stay in `InputBar.module.css` because that is the
 * sheet the harness ships for the card and its row together.
 */
import type { ReactNode } from 'react';
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
  /** The context meter's seat (the harness seats it left of the send circle). */
  meter?: ReactNode;
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
  approvalMode,
  codeMode,
  model,
  modelName,
  modelSwitching,
  catalog,
  meter,
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
        <div className={css.modes}>
          {/* The two mode chips are the conversation group's own port of the
              harness access seat (`conversation/PermissionSelect.tsx`): the
              control and its vocabulary stay one file, and this row only seats
              them where the harness seats them — on the run they govern. */}
          <PermissionSelect
            value={approvalMode}
            disabled={disabled}
            onPick={(mode) => { send({ type: 'set_approval_mode', mode }) }}
          />
          <CodeModeSelect
            value={codeMode}
            disabled={disabled}
            onPick={(mode) => { send({ type: 'set_code_mode', mode }) }}
          />
        </div>
      </div>
      <div className={css.trailing}>
        <ModelSeat model={model} modelName={modelName} switching={modelSwitching} catalog={catalog} disabled={disabled} send={send} />
        {meter}
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