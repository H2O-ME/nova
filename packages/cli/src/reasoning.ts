/**
 * Façade: reasoning view lives in `@nova-agent/tui-view` (M7.0).
 * New code should import tui-view directly.
 */
export {
  extractReasoningHeader,
  reasoningDetailRows,
  reasoningLiveRow,
  reasoningRows,
  REASONING_INDENT_COLS,
  REASONING_LIVE_MAX_ROWS,
  REASONING_MAX_LINES,
  summaryRow,
} from '@nova-agent/tui-view';
export type { ReasoningView } from '@nova-agent/tui-view';
