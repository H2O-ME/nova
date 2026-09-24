/**
 * Project the selected session's title into the browser title, ported from
 * deepseek-harness `ui-layout/src/client/DocumentTitle.tsx` (MIT): the product
 * title is the floor, a session title prefixes it, and unmount restores it.
 */
import { useEffect } from 'react';

export interface DocumentTitleProps {
  /** The active session's title (derived from its first user message). */
  title: string;
  /** Build-selected product title. */
  productTitle?: string;
}

export function DocumentTitle({ title, productTitle = 'Nova' }: DocumentTitleProps): null {
  useEffect(() => {
    document.title = title === '' ? productTitle : `${title} — ${productTitle}`;
    return () => {
      document.title = productTitle;
    };
  }, [productTitle, title]);
  return null;
}