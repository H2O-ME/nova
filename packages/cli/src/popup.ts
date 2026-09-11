/**
 * Façade: popup builders live in `@nova-agent/tui-view` (M7.0).
 * New code should import tui-view directly.
 */
export {
  APPROVAL_OPTIONS,
  buildApprovalPopup,
  buildCommandPopup,
  buildModelPopup,
  buildSessionPopup,
  MODEL_PICKER_WINDOW,
  SESSION_PICKER_WINDOW,
} from '@nova-agent/tui-view';
export type {
  ApprovalPopupView,
  CommandPopupView,
  ModelPopupItem,
  ModelPopupView,
  SessionPopupItem,
  SessionPopupView,
} from '@nova-agent/tui-view';
