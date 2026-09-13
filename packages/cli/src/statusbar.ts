/**
 * Façade: status-bar computation lives in `@nova-agent/tui-view` (M7.0).
 * New code should import tui-view directly.
 */
export {
  approvalChip,
  CODE_MODE_HINT,
  codeModeLabel,
  contextBreakdown,
  contextGaugeForms,
  contextLegend,
  gaugeCacheKey,
  modelTail,
  padBetween,
  segmentBar,
  sparkline,
  statusBar,
  allocateCells,
  planContextSegments,
} from '@nova-agent/tui-view';
export type {
  ContextBreakdownView,
  ContextGaugeView,
  ContextSegment,
  StatusTier,
  StatusView,
} from '@nova-agent/tui-view';
export { padDisplay } from '@nova-agent/tui-view';
