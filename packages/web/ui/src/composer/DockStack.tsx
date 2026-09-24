/**
 * The composer dock stack, ported from deepseek-harness
 * `ui-conversation/src/client/skeleton/ConversationRoot.module.css`
 * `.composerStack` (MIT): one rhythm for the cards that stand above the input
 * card, so a dock card (the queue strip, a todo strip) and the card read as one
 * stack rather than two boxes that happen to be near each other.
 *
 * Mount the dock cards and the input card as this stack's children, in the
 * harness's order: dock cards FIRST (their own sheets tuck them 3px under the
 * card, which is what makes a queue panel read as attached), the card LAST.
 * The horizontal axis — the card cap, the side clearance, the dock inset —
 * belongs to the conversation root, not to this wrapper.
 */
import type { ReactNode } from 'react';
import css from './DockStack.module.css';

export function DockStack({ children }: { children?: ReactNode }): JSX.Element {
  return <div className={css.stack}>{children}</div>;
}