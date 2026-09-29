/**
 * Untrusted assistant Markdown → React elements. Port of the harness
 * `ui-primitives/src/markdown/MarkdownText.tsx`, with the two arms that port
 * needs: `parse.ts` (block grammar) → `blocks.tsx` (elements) → `inline.ts`
 * (inline grammar) → `inline-view.tsx` (phrasing elements).
 *
 * The sanitizer IS this architecture: text becomes an element tree with string
 * children, so there is no HTML-string path and provider output has no
 * execution path. Link and image destinations pass a protocol allowlist
 * (`inline.ts`); raw HTML in the source renders as literal text.
 *
 * The harness's streaming arm freezes settled blocks as cached elements and
 * re-parses only the tail; this port re-parses the body per render and leans on
 * memoization at the call site instead (the transcript memoizes a message on
 * its text, so a delta re-parses one growing message, not the transcript).
 * `streaming` therefore only rides through as a DOM hook: on the root, and on
 * the fence a growing body may still be inside.
 */
import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { renderMarkdownBlocks } from './blocks.js';
import { defaultMarkdownLabels } from './labels.js';
import type { MarkdownLabels } from './labels.js';
import { parseMarkdown } from './parse.js';
import css from './MarkdownText.module.css';

export type { MarkdownCodeLabels, MarkdownCodeToolbarLabels, MarkdownLabels } from './labels.js';
export { defaultMarkdownLabels } from './labels.js';

export interface MarkdownTextProps {
  /** Markdown source, exactly as the session projection preserved it. */
  text: string;
  /** The body is still growing (a streaming reply). */
  streaming?: boolean | undefined;
  /**
   * Localized chrome. Pass a REFERENCE-STABLE object (a module constant or a
   * memoized per-locale value): a new identity discards the memo mid-message.
   */
  labels?: MarkdownLabels | undefined;
  /**
   * `body` keeps the full document typography; `compact` drops to the
   * secondary text tier with uniform bold headings and tight block spacing
   * (the folded reasoning body).
   */
  variant?: 'body' | 'compact' | undefined;
}

export const MarkdownText = memo(function MarkdownText({
  text,
  streaming = false,
  labels = defaultMarkdownLabels,
  variant = 'body',
}: MarkdownTextProps): JSX.Element {
  const children = useMemo<ReactNode[]>(
    () => renderMarkdownBlocks(parseMarkdown(text), { labels, streaming }),
    [text, streaming, labels],
  );
  const compact = variant === 'compact';
  return (
    <div
      className={compact ? `${css.markdown} ${css.compact}` : css.markdown}
      data-markdown-variant={compact ? variant : undefined}
      data-streaming={streaming ? '' : undefined}
    >
      {children}
    </div>
  );
});