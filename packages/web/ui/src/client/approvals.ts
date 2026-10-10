/**
 * The approvals domain: the two blocking cards (tool approval, model question)
 * and their three ends. A request arrives as an event and leaves either by the
 * USER's answer (the card just closes — the tool row carries the verdict) or by
 * the KERNEL closing the ask itself (abort, session close), which must say so:
 * a card that vanished silently reads like a lost click.
 */
import type { KernelEvent } from '../types.js';
import type { UiState } from '../state.js';
import { hint } from './messages.js';

/** The approval/question events, as one slice for the switch below. */
export type ApprovalEvent = Extract<
  KernelEvent,
  { type: 'approval_request' | 'approval_resolved' | 'question_request' | 'question_resolved' }
>;

export function isApprovalEvent(event: KernelEvent): event is ApprovalEvent {
  return (
    event.type === 'approval_request' ||
    event.type === 'approval_resolved' ||
    event.type === 'question_request' ||
    event.type === 'question_resolved'
  );
}

export function reduceApprovalEvent(state: UiState, event: ApprovalEvent): UiState {
  switch (event.type) {
    case 'approval_request':
      return { ...state, pendingApproval: event.request };
    case 'approval_resolved':
      return resolveApproval(state, event.id, event.resolution);
    case 'question_request':
      return { ...state, pendingQuestion: event.request };
    case 'question_resolved':
      return resolveQuestion(state, event.id, event.resolution);
  }
}

/**
 * A vanished dialog must say why. When the USER answered, the tool row carries
 * the verdict and a hint would be noise; when the kernel closed the ask itself
 * (abort, session close) the fail-closed denial is invisible otherwise — the
 * tool result is synthesized inside the loop and the call never runs.
 */
function resolveApproval(state: UiState, id: string, resolution: { source: 'user' | 'aborted' | 'closed' }): UiState {
  const wasOpen = state.pendingApproval?.id === id;
  const cleared = wasOpen ? { ...state, pendingApproval: null } : state;
  if (!wasOpen || resolution.source === 'user') return cleared;
  const cause = resolution.source === 'aborted' ? '本轮中断' : '会话关闭';
  return hint(cleared, `${cause}，未回答的审批按拒绝处理`, 'warn');
}

/**
 * The question card's counterpart to {@link resolveApproval}: the card only
 * closes for the request it is actually showing (a late resolution for an ask
 * the user already replaced must not clear the current one), and the three
 * ends that are NOT the user's own answer have to say so — the run continues
 * either way, and a card that vanished silently reads like a lost click.
 */
function resolveQuestion(
  state: UiState,
  id: string,
  resolution: { source: 'user' | 'cancelled' | 'aborted' | 'closed' },
): UiState {
  const wasOpen = state.pendingQuestion?.id === id;
  const cleared = wasOpen ? { ...state, pendingQuestion: null } : state;
  if (!wasOpen || resolution.source === 'user') return cleared;
  if (resolution.source === 'cancelled') return hint(cleared, '已放弃这组问题，模型会收到取消结果', 'info');
  const cause = resolution.source === 'aborted' ? '本轮中断' : '会话关闭';
  return hint(cleared, `${cause}，未回答的问题已取消`, 'warn');
}
