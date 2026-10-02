/**
 * The frame's view model — everything the shell reads about the session,
 * derived in one pure function. The shell then composes fields instead of
 * deciding, which keeps two things honest: the rules below are asserted in
 * tests rather than inferred from JSX, and the components stay projections.
 */
import type { PtcMode, TurnPhase, ApprovalMode } from './types.js';
import type { Block, UiState } from './state.js';

export interface ChromeView {
  /** The workspace root (the title crumb's tooltip; '' before `ready`). */
  rootDir: string;
  /** The hero chip's label: {@link workspaceLabel} of the root ('' before `ready`). */
  workspace: string;
  /** First real user prompt; '' when the session has none yet. */
  title: string;
  idle: boolean;
  /**
   * A turn is in flight. Waiting on an approval counts: the kernel is holding
   * the loop inside the ask, so the abort control must stay reachable —
   * an approval is never a trap with no exit.
   */
  running: boolean;
  /** What the composer reflects: an approval supersedes the reported phase. */
  phase: TurnPhase | 'disconnected';
  approvalMode: ApprovalMode;
  codeMode: PtcMode;
  canCompact: boolean;
  compactBusy: boolean;
  /** Baseline blocks the host holds that this browser has not loaded yet. */
  hidden: number;
  /** The tool call the detail panel is open on (undefined = panel closed). */
  detail: Extract<Block, { kind: 'tool' }> | undefined;
}

/**
 * Is no turn in flight? An outstanding ask means the kernel is suspended inside
 * it, whatever the last reported phase said — a surface that reattached
 * mid-approval reads `phase: 'idle'` from the baseline, and trusting that would
 * hide the abort control for a run that is very much in flight. A question is the
 * same situation one door over. Exported because {@link modeControlsLocked} needs
 * the same answer without building a whole view model.
 * @param state - the reducer state.
 * @returns whether the session has no turn in flight.
 */
export function isIdle(state: UiState): boolean {
  return state.pendingApproval === null
    && state.pendingQuestion === null
    && (state.phase === 'idle' || state.phase === 'disconnected');
}

/**
 * Is the `ptc` plugin switched off in the live roster?
 *
 * Only an EXPLICIT `enabled: false` counts: the rows are absent until a
 * `roster`/`plugins` frame lands, and an unknown row must not hide a control
 * (the same `?? true` reading `PluginRow` draws its switch from and the settings
 * nav derives its pages by).
 * @param state - the reducer state.
 * @returns whether the manager shows the PTC plugin as off.
 */
export function ptcPluginOff(state: UiState): boolean {
  const rows = state.plugins?.entries ?? state.roster?.entries ?? [];
  return rows.some((row) => row.name === 'ptc' && row.enabled === false);
}

/**
 * The execution mode actually IN FORCE, as every surface must publish it.
 *
 * With the `ptc` plugin off there is no `run_code` tool to expose, and the
 * kernel refuses a non-`native` pick (`runtime-facade.ts`). The live
 * `state.codeMode` can nevertheless still name one — the plugin manager's own
 * switch writes `disable`, and a mode picked earlier survives it. Reading the raw
 * field therefore published a mode the kernel would not run, and it did so on
 * ONE surface only: the settings page projected it while the composer chip did
 * not, so a switched-off plugin left the chip offering PTC.
 *
 * It lives here, once, because both surfaces read it — two call sites deriving
 * "which mode is in force" independently is exactly how those two came to
 * disagree.
 * @param state - the reducer state.
 * @returns the mode to display and to pre-select in the picker.
 */
export function effectiveCodeMode(state: UiState): PtcMode {
  return ptcPluginOff(state) ? 'native' : state.codeMode;
}

export function chromeView(state: UiState, openCallId: string | null): ChromeView {
  const idle = isIdle(state);
  const firstUser = state.blocks.find((b) => b.kind === 'user');
  return {
    rootDir: state.meta?.rootDir ?? '',
    workspace: workspaceLabel(state.meta?.rootDir ?? ''),
    title: firstUser?.kind === 'user' ? firstUser.text : '',
    idle,
    running: !idle,
    phase: state.pendingApproval !== null
      ? 'waiting_approval'
      : state.pendingQuestion !== null ? 'waiting_question' : state.phase,
    approvalMode: state.approvalMode,
    codeMode: effectiveCodeMode(state),
    canCompact: state.connected,
    compactBusy: state.phase === 'compacting',
    hidden: Math.max(0, state.historyTotal - state.historyLoaded),
    detail:
      openCallId === null
        ? undefined
        : state.blocks.find((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool' && b.callId === openCallId),
  };
}

/** The composer is disabled while no socket is open or an ask is pending. */
export function composerDisabled(state: UiState): boolean {
  return !state.connected || state.pendingApproval !== null || state.pendingQuestion !== null;
}

/**
 * Are the mode controls (access tier, execution mode) locked?
 *
 * A run LOCKS both, everywhere they appear. The server refuses the frame, so an
 * enabled control is a click that can only produce a refusal the reader may not
 * even be looking at (the error lands as a transcript hint, not in the panel).
 * The rule is separate from {@link composerDisabled} because it is strictly
 * stronger and has a different reason: `composerDisabled` says "this surface
 * cannot accept input", this one says "changing a mode mid-run would split one
 * turn into two contracts" — the execution mode picks the toolset, which is part
 * of the cached prefix.
 *
 * It lives here, once, because the composer seat and the settings panel both
 * read it: two call sites deriving "locked" independently is how the settings
 * rows came to be the only place the refusal was invisible.
 * @param state - the reducer state.
 * @returns whether a mode pick must be refused.
 */
export function modeControlsLocked(state: UiState): boolean {
  return composerDisabled(state) || !isIdle(state);
}

/**
 * Whether the APPROVAL tier pick must be refused — deliberately NOT
 * {@link modeControlsLocked}.
 *
 * The two picks are locked by different things, and conflating them was a real
 * defect: the operator asked to change the approval tier *while a run was going*,
 * and `!isIdle` made the settings row inert exactly then, so the request was
 * unsatisfiable from the only surface still showing it.
 *
 * The honest rule follows what the host actually does:
 *  - approval tier → allowed mid-run. `PermissionService.setMode` writes one field
 *    that `autoAllows` reads fresh on every call; it is not part of the cached
 *    prompt prefix, it does not re-roster, and it cannot un-gate a call that was
 *    already decided. Tightening applies to the next call immediately, which is
 *    the whole point of asking.
 *  - execution mode → still locked mid-run (`modeControlsLocked`): it picks the
 *    toolset, which IS part of the cached prefix, and the host refuses it.
 *
 * Only `composerDisabled` blocks the tier, because that condition means there is
 * no session to apply it to at all.
 * @param state - the reducer state.
 * @returns whether an approval-tier pick must be refused.
 */
export function approvalControlLocked(state: UiState): boolean {
  return composerDisabled(state);
}

/**
 * Basename label for the hero's workspace chip — the shared derivation the
 * harness's `workspaceTitleOf` performs (MIT): the last non-empty path
 * segment on either separator; a separator-only path echoes the raw cwd.
 */
export function workspaceLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0);
  const base = parts[parts.length - 1];
  return base !== undefined ? base : cwd;
}