/**
 * The copy affordance the card chrome shares (diff / terminal / read / search
 * banners), matching the harness's `useCopyFeedback`: the clipboard write is
 * best-effort — a non-secure context (plain http) or an unfocused document has
 * no clipboard, and the card's text is still selectable, so failure is silent.
 *
 * The write itself lives in `src/clipboard.ts`: one host-capability helper for
 * every copy control in this surface.
 */
import { useCallback, useState } from 'react';
import { writeClipboard } from '../clipboard.js';

export interface CopyFeedback {
  copied: boolean;
  copy: () => void;
}

export function useCopy(text: string): CopyFeedback {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((): void => {
    if (copied) return;
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_000);
    });
  }, [copied, text]);
  return { copied, copy };
}

/** Copy-button labels, harness verbatim (`copy` / `copied`). */
export const COPY_LABELS = { copy: '复制', copied: '复制成功' } as const;