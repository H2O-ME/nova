/**
 * Façade: reasoning view lives in `@nova-agent/tui-view` (M7.0).
 * New code should import tui-view directly.
 */
export {
  reasoningDetailRows,
  reasoningRows,
  REASONING_INDENT_COLS,
  REASONING_MAX_LINES,
  summaryRow,
} from '@nova-agent/tui-view';
export type { ReasoningView } from '@nova-agent/tui-view';
