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
  /**
   * The newest tool call in the transcript — what the header corner's expand
   * control re-opens. Undefined when the session has no tool call at all, in
   * which case there is nothing for that control to show and it is not rendered.
   */
  lastToolCallId: string | undefined;
}

export function chromeView(state: UiState, openCallId: string | null): ChromeView {
  // An outstanding ask means the kernel is suspended inside it, whatever the
  // last reported phase said — a surface that reattached mid-approval reads
  // `phase: 'idle'` from the baseline, and trusting that would hide the abort
  // control for a run that is very much in flight.
  const idle = state.pendingApproval === null && (state.phase === 'idle' || state.phase === 'disconnected');
  const firstUser = state.blocks.find((b) => b.kind === 'user');
  // Newest first: the target lib predates `findLast`, and the loop reads the
  // same either way.
  let lastTool: Extract<Block, { kind: 'tool' }> | undefined;
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index];
    if (block?.kind === 'tool') { lastTool = block; break; }
  }
  return {
    rootDir: state.meta?.rootDir ?? '',
    title: firstUser?.kind === 'user' ? firstUser.text : '',
    idle,
    running: !idle,
    phase: state.pendingApproval !== null ? 'waiting_approval' : state.phase,
    approvalMode: state.approvalMode,
    codeMode: state.codeMode,
    canCompact: state.connected,
    compactBusy: state.phase === 'compacting',
    hidden: Math.max(0, state.historyTotal - state.historyLoaded),
    detail:
      openCallId === null
        ? undefined
        : state.blocks.find((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool' && b.callId === openCallId),
    lastToolCallId: lastTool?.callId,
  };
}

/** The composer is disabled while no socket is open or an approval is pending. */
export function composerDisabled(state: UiState): boolean {
  return !state.connected || state.pendingApproval !== null;
}