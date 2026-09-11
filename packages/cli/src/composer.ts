/**
 * Façade: composer view lives in `@nova-agent/tui-view` (M7.0).
 * New code should import tui-view directly.
 */
export {
  COMPOSER_PREFIX,
  COMPOSER_PREFIX_WIDTH,
  composerWrapBudget,
  composerZone,
  cursorAfterVerticalMove,
  cursorPosition,
  layoutComposer,
  renderComposerRow,
  wrapComposer,
} from '@nova-agent/tui-view';
export type {
  ComposerLayout,
  ComposerRow,
  ComposerWrap,
  GenPhase,
} from '@nova-agent/tui-view';
export type { ComposerZoneView } from '@nova-agent/tui-view';
